// @ts-nocheck — Deno runtime, not Node. Fires a push by invoking the
// send-push-notification edge function service-to-service (service-role bearer),
// reusing its copy + per-user preference gate. Best-effort: a failed push never
// breaks the calling flow. Mirrors the inline pattern in claim-points.
export async function notifyPush(
  targetUserId: string,
  type: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    await fetch(`${url}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ target_user_id: targetUserId, type, payload }),
    });
  } catch (err) {
    console.warn('[notifyPush] failed:', type, err);
  }
}
