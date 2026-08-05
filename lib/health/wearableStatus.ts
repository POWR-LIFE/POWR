/**
 * Wearable freshness — "is the watch still feeding us?"
 *
 * Terra exposes no battery level on any data model (checked against Terra's
 * data-model reference: device_data carries activation_timestamp, data_provided,
 * hardware_version, last_upload_date, manufacturer, name, serial_number,
 * software_version, other_devices — and nothing else). Nor does HealthKit expose
 * watch battery. So freshness IS the health signal, and it's the better one
 * anyway: a battery reading goes green during exactly the failures that have
 * actually hurt us — the June 2026 Whoop trimmed-scope outage, where connections
 * stayed authorised and delivered zero sleep for five weeks while every screen
 * showed them connected.
 *
 * Deliberately reads `last_upload_at`, NOT `last_event_at`: the latter is
 * terra-poll scheduling state and excludes 'daily' payloads on purpose, so it
 * runs stale for providers with no sleep/activity data.
 *
 * Pure module — no I/O, no React. Fetching lives in hooks/useWearableStatus.ts.
 */

/** Past this, the chip goes amber. Sized to clear a normal off-wrist night. */
export const WEARABLE_STALE_HOURS = 24;

/**
 * Past this, the home banner speaks up. 48h rather than 24h because we cannot
 * distinguish "the connection is broken" from "they didn't wear it this
 * weekend", and a rest day must never trigger a reconnect nag.
 */
export const WEARABLE_SILENT_HOURS = 48;

/**
 * Grace period after a connection is created, before "never delivered" is
 * allowed to read as 'silent'.
 *
 * Nothing arrives at auth time: handleAuth only records the connection, and the
 * first data lands either on Terra's auto-push or the next terra-poll tick (30
 * min, and Whoop never auto-pushes `daily` at all). Without this window a user
 * who has just reconnected is immediately told "hasn't sent POWR any data since
 * you connected it — reconnecting usually fixes this", i.e. told to redo the
 * thing they are standing in the middle of doing.
 *
 * Sized at four poll cycles: long enough that a healthy connection always
 * delivers inside it, short enough that a genuinely dead one still surfaces the
 * same morning. The outage shape this whole module exists for (authorised,
 * delivering nothing, for weeks) is untouched — it just has to wait 2h.
 */
export const WEARABLE_CONNECTING_HOURS = 2;

export type WearableFreshness =
    | 'none'      // no live wearable — render nothing
    | 'fresh'     // delivered within WEARABLE_STALE_HOURS
    | 'stale'     // quiet a while; chip goes amber, no banner
    | 'silent';   // quiet long enough to be worth interrupting for

export type WearableStatusInput = {
    /** A non-deauthed terra_connections row exists. */
    connected: boolean;
    /** terra_connections.last_upload_at, or null if it has never delivered. */
    lastUploadAt: string | null;
    /**
     * terra_connections.created_at — when this connection was authorised. Only
     * consulted when the connection has never delivered, to tell "just
     * connected, still settling" apart from "authorised and dead". Omit or pass
     * null to keep the old behaviour (never-delivered ⇒ silent immediately).
     */
    connectedAt?: string | null;
    /** Injected for testability; defaults to now at call time. */
    now?: Date;
};

/**
 * Hours since the wearable last delivered. null when never, or unparseable.
 * Clamped at 0 so a provider clock slightly ahead of ours can't read negative.
 */
export function hoursSinceUpload(lastUploadAt: string | null, now: Date = new Date()): number | null {
    if (!lastUploadAt) return null;
    const then = Date.parse(lastUploadAt);
    if (Number.isNaN(then)) return null;
    return Math.max(0, (now.getTime() - then) / 3_600_000);
}

export function wearableFreshness(input: WearableStatusInput): WearableFreshness {
    if (!input.connected) return 'none';

    const hours = hoursSinceUpload(input.lastUploadAt, input.now ?? new Date());

    // Never delivered. Treated as 'silent' rather than 'none' precisely because
    // this is the auth-succeeded-but-no-data shape of both real outages we've
    // hit: the user believes they're connected and nothing is coming through.
    // The one exception is a connection young enough that no delivery is due
    // yet — see WEARABLE_CONNECTING_HOURS.
    if (hours === null) {
        const sinceConnect = hoursSinceUpload(input.connectedAt ?? null, input.now ?? new Date());
        if (sinceConnect !== null && sinceConnect < WEARABLE_CONNECTING_HOURS) return 'fresh';
        return 'silent';
    }

    if (hours >= WEARABLE_SILENT_HOURS) return 'silent';
    if (hours >= WEARABLE_STALE_HOURS) return 'stale';
    return 'fresh';
}

/**
 * Short relative time for the chip subtitle. Intentionally coarse — we're
 * conveying "recent / not recent", not a precise clock.
 */
export function formatSyncAge(hours: number | null): string {
    if (hours === null) return 'no data yet';
    if (hours < 1) return 'synced just now';
    if (hours < 2) return 'synced 1h ago';
    if (hours < 24) return `synced ${Math.floor(hours)}h ago`;
    const days = Math.floor(hours / 24);
    return days === 1 ? 'synced yesterday' : `synced ${days}d ago`;
}

/**
 * Banner copy for a silent wearable.
 *
 * Wording rule: state the OBSERVATION ("hasn't sent data"), never the inference
 * ("disconnected"). We genuinely cannot tell a broken grant from an unworn
 * watch, and the observation is true either way — while "disconnected" is a
 * claim we'd be wrong about every time someone takes a rest day.
 */
export function wearableSilentCopy(
    providerName: string,
    hours: number | null,
): { title: string; body: string; cta: string } {
    const since = hours === null
        ? `${providerName} hasn’t sent POWR any data since you connected it.`
        : `${providerName} hasn’t sent POWR any data in ${Math.floor(hours / 24)} days.`;
    return {
        title: `Check your ${providerName} connection`,
        body: `${since} If you’ve been wearing it, reconnecting usually fixes this.`,
        cta: 'Check connection',
    };
}
