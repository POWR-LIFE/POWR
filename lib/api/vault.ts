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
}

/**
 * The two admin levers the deposits themselves cannot express.
 *
 * A deposit row says when it vests; it cannot say that unclaimed POWR
 * auto-releases `graceDays` later, nor that an admin has scheduled a Vault Day
 * that will pull it forward. Both are read through get_my_vault_outlook()
 * (SECURITY DEFINER — vault_unlock_events is admin-only under RLS).
 */
export interface VaultOutlook {
    /** Days after maturing before the cron auto-credits an unclaimed deposit. */
    graceDays: number;
    /** When the earliest matured deposit auto-releases. Null when none is ready. */
    autoReleaseAt: string | null;
    /**
     * Soonest scheduled unlock aimed at this user, or null. Only ever set for
     * events an admin marked `notify` — an unannounced event stays a surprise.
     */
    nextUnlockAt: string | null;
    /** The admin's label for that event, e.g. "Vault Day". */
    nextUnlockNote: string | null;
    /**
     * Level floor before anything can leave the Vault
     * (`vault_unlock_min_level`). 1 = off.
     */
    minLevel: number;
    /** The user's level on the same lifetime basis the gate uses. */
    currentLevel: number;
}

/**
 * Sealed by the level floor: deposits keep banking and vesting, but neither
 * the press-and-hold unlock nor the grace auto-release will pay out until the
 * user reaches `minLevel`. Vaulted POWR still counts toward level, so a gated
 * user's own sealed balance carries them toward the level that frees it.
 */
export function isVaultGated(o: VaultOutlook | null | undefined): boolean {
    return !!o && o.minLevel > 1 && o.currentLevel < o.minLevel;
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

/**
 * PENDING ONLY. The screen lists what is still in the vault — released
 * deposits have left it and live in the points ledger — so the second query
 * that used to fetch them was work nobody read.
 */
export async function fetchVaultContents(): Promise<VaultContents> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { pending: [] };

    const { data, error } = await supabase
        .from('vault_deposits')
        .select('id, amount, source, description, level, created_at, vests_at, released_at')
        .eq('user_id', session.user.id)
        .is('released_at', null)
        .order('vests_at', { ascending: true })
        .limit(200);
    if (error) throw error;

    return { pending: (data ?? []) as VaultDeposit[] };
}

/**
 * Is this user in the Vault rollout (`vault_rollout`)?
 *
 * SURFACE ONLY — a `false` here hides the Vault, it does not stop POWR banking.
 * Someone outside the rollout keeps accruing deposits they cannot see, so
 * switching them on later hands over the lot.
 *
 * Defaults to TRUE on any failure. The flag exists to stage a rollout, not to
 * protect anything, so a transient RPC error must not blank the Vault for
 * someone who already has it — that would read as lost POWR.
 */
export async function fetchVaultAccess(): Promise<boolean> {
    const { data, error } = await supabase.rpc('get_my_vault_access');
    if (error) return true;
    return data !== false;
}

/**
 * Grace window + any scheduled unlock aimed at this user. Never throws: the
 * outlook only ever ADDS context to a screen that already works without it, so
 * a failure here degrades to the plain vesting view rather than an error state.
 */
export async function fetchVaultOutlook(): Promise<VaultOutlook | null> {
    const { data, error } = await supabase.rpc('get_my_vault_outlook');
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
        graceDays: Number(row.grace_days ?? 7),
        autoReleaseAt: row.auto_release_at ?? null,
        nextUnlockAt: row.next_unlock_at ?? null,
        nextUnlockNote: row.next_unlock_note ?? null,
        minLevel: Number(row.min_level ?? 1),
        currentLevel: Number(row.current_level ?? 1),
    };
}
