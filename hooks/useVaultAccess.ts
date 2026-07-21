import { useQuery } from '@tanstack/react-query';

import { fetchVaultAccess } from '@/lib/api/vault';

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
