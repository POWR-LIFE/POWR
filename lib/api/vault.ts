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
    source: 'level_up' | 'cap_overflow';
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
