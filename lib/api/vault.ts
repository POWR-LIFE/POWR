import { supabase } from '@/lib/supabase';

/**
 * The Vault: bonus POWR (level-up bonuses + merit clamped by the daily cap)
 * that vests over time. Deposits live outside point_transactions until they
 * vest — the release sweep credits them as a 'bonus' ledger row. Read-only
 * from the client (RLS: own rows, select only).
 */
export interface VaultDeposit {
    id: string;
    amount: number;
    source: 'level_up' | 'cap_overflow' | 'admin_grant';
    description: string | null;
    /** Set for level_up deposits — the level whose bonus this is. */
    level: number | null;
    created_at: string;
    vests_at: string;
    released_at: string | null;
}

export interface VaultContents {
    /** Still-vesting deposits, soonest unlock first. */
    pending: VaultDeposit[];
    /** Recently released deposits, newest first. */
    released: VaultDeposit[];
}

/**
 * Release every matured deposit for the signed-in user (the press-and-hold
 * unlock). Atomic + user-locked server-side; racing the cron sweep or a
 * double invocation can never double-credit. Returns what was released —
 * {points: 0} when nothing was due.
 */
export async function claimVaultDeposits(): Promise<{ points: number; deposits: number }> {
    const { data, error } = await supabase.rpc('claim_my_vault_deposits');
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return {
        points: Number(row?.points ?? 0),
        deposits: Number(row?.deposits ?? 0),
    };
}

export async function fetchVaultContents(): Promise<VaultContents> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { pending: [], released: [] };

    const base = () => supabase
        .from('vault_deposits')
        .select('id, amount, source, description, level, created_at, vests_at, released_at')
        .eq('user_id', session.user.id);

    const [pendingRes, releasedRes] = await Promise.all([
        base().is('released_at', null).order('vests_at', { ascending: true }).limit(200),
        base().not('released_at', 'is', null).order('released_at', { ascending: false }).limit(50),
    ]);
    if (pendingRes.error) throw pendingRes.error;
    if (releasedRes.error) throw releasedRes.error;

    return {
        pending: (pendingRes.data ?? []) as VaultDeposit[],
        released: (releasedRes.data ?? []) as VaultDeposit[],
    };
}
