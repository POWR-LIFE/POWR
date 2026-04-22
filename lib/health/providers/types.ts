import type {
    CalorieSummary,
    DayHealthSummary,
    HealthActivity,
    HeartRateSummary,
    SleepSession,
    VerifyResult,
} from '@/hooks/useHealthData';

export type HealthProviderId =
    | 'apple-health'
    | 'health-connect'
    | 'fitbit'
    | 'whoop'
    | 'garmin';

export type ConnectResult = 'connected' | 'pending' | 'failed';

export type HealthProviderCapability =
    | 'steps'
    | 'activities'
    | 'sleep'
    | 'heart-rate'
    | 'calories';

export type HealthProviderMeta = {
    id: HealthProviderId;
    name: string;
    /** Which OS values this provider can run on (omit = all). */
    platforms?: ('ios' | 'android' | 'web')[];
    /** Backed by the OS health platform (HealthKit / Health Connect). */
    native: boolean;
    capabilities: HealthProviderCapability[];
};

/**
 * Uniform surface for any health-data source. Implementations wrap a specific
 * backend (HealthKit, Health Connect, Fitbit Web API, ...). The active provider
 * is read from `profiles.active_health_provider`; sync code should never import
 * a provider directly.
 */
export interface HealthProvider {
    readonly meta: HealthProviderMeta;

    /** True when the host platform can support this provider at all. */
    isAvailable(): Promise<boolean>;
    /** True when the user has granted permission / completed OAuth. */
    isConnected(): Promise<boolean>;

    /**
     * Trigger the connect flow.
     *   - `'connected'`: provider is fully connected (native permission granted,
     *     or OAuth tokens stored). Safe for the caller to mark connected in the DB.
     *   - `'pending'`: flow is handed off to an external surface (browser / OS prompt)
     *     and will complete asynchronously via a callback route. Caller MUST NOT
     *     write connected state yet — the callback is the source of truth.
     *   - `'failed'`: flow errored or the user denied it.
     */
    connect(): Promise<ConnectResult>;
    /** Revoke tokens / clear local connection state. */
    disconnect(): Promise<void>;

    getStepsToday(): Promise<number>;
    getActivitiesToday(): Promise<HealthActivity[]>;
    getLastNightSleep(): Promise<SleepSession | null>;
    getHeartRateToday(): Promise<HeartRateSummary | null>;
    getCaloriesToday(): Promise<CalorieSummary | null>;
    getWeekHistory(): Promise<DayHealthSummary[]>;

    verifyWalking(claimedSteps: number): Promise<VerifyResult>;
    verifyWorkout(activityType: string, durationMinutes: number): Promise<VerifyResult>;
}

export class HealthProviderNotImplementedError extends Error {
    constructor(providerId: HealthProviderId, op: string) {
        super(`Health provider "${providerId}" does not implement ${op} yet.`);
        this.name = 'HealthProviderNotImplementedError';
    }
}

/**
 * Thrown when an OAuth provider's refresh token has expired or been revoked.
 * The provider should clear its local tokens before throwing this.
 * Callers should auto-disconnect and prompt the user to reconnect.
 */
export class ProviderAuthExpiredError extends Error {
    readonly providerId: HealthProviderId;
    constructor(providerId: HealthProviderId, detail?: string) {
        super(`${providerId} connection expired${detail ? `: ${detail}` : ''}`);
        this.name = 'ProviderAuthExpiredError';
        this.providerId = providerId;
    }
}
