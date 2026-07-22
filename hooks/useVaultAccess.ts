import { useQuery } from '@tanstack/react-query';

import { fetchVaultAccess, fetchVaultLaunchAt } from '@/lib/api/vault';

/**
 * Is this user in the Vault rollout?
 *
 * Gates the whole Vault SURFACE — the Rewards widget and the /vault route —
 * while the economy underneath keeps running for everyone. A user outside the
 * rollout still banks cap-overflow and level bonuses; they just can't see them,
 * so switching them on later hands over everything already accrued.
 *
 * Defaults to `true` while loading and on failure. The flag stages a rollout,
 * it does not protect anything, so the failure mode that matters is the wrong
 * one: momentarily hiding the Vault from someone who has it reads as POWR going
 * missing, whereas a beat of visibility for someone who shouldn't have it yet
 * costs nothing. Both callers sit behind auth already, so there is no pre-auth
 * gate to carry here.
 */
export function useVaultAccess(): boolean {
    const { data } = useQuery({
        queryKey: ['vault', 'access'],
        queryFn: fetchVaultAccess,
        // The rollout changes at admin pace, not user pace. Long cache keeps it
        // off the hot path; a switched-on user picks it up next app open.
        staleTime: 30 * 60 * 1000,
    });
    return data !== false;
}

/**
 * The scheduled launch (`vault_launch_at`), for users useVaultAccess says no
 * to: an upcoming date turns the hard-hide into a COMING SOON countdown on
 * both vault surfaces.
 *
 * `isPending` is exposed because the two queries race: access can resolve
 * false while this one is still in flight, and the /vault route guard must
 * not bounce a user it might be about to show the countdown to.
 */
export function useVaultLaunch(): { launchAt: string | null; isPending: boolean } {
    const { data, isPending } = useQuery({
        queryKey: ['vault', 'launch'],
        queryFn: fetchVaultLaunchAt,
        // Admin-pace, same as the rollout — but not longer: on launch morning
        // a rescheduled date should reach an open app within the quarter hour.
        staleTime: 15 * 60 * 1000,
    });
    return { launchAt: data ?? null, isPending };
}
