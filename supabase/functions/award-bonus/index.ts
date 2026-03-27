// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
import { createClient } from '@supabase/supabase-js';

const ALLOWED_BONUSES: Record<string, { amount: number; description: string }> = {
  location_permission: { amount: 20, description: 'Location permission granted' },
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body: { bonus_type: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const bonus = ALLOWED_BONUSES[body.bonus_type];
  if (!bonus) {
    return new Response(JSON.stringify({ error: 'Unknown bonus type' }), { status: 400 });
  }

  // Idempotency — only award each bonus once per user
  const { count: existing } = await supabase
    .from('point_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('type', 'bonus')
    .eq('description', bonus.description);

  if ((existing ?? 0) > 0) {
    return new Response(JSON.stringify({ error: 'Bonus already awarded' }), { status: 409 });
  }

  const { data: tx, error: txError } = await supabase
    .from('point_transactions')
    .insert({
      user_id: user.id,
      amount: bonus.amount,
      type: 'bonus',
      description: bonus.description,
      multiplier: 1.0,
    })
    .select()
    .single();

  if (txError) {
    console.error('Transaction insert failed:', txError);
    return new Response(JSON.stringify({ error: 'Failed to record transaction' }), { status: 500 });
  }

  return new Response(
    JSON.stringify({ ok: true, earned: bonus.amount, transaction_id: tx.id }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
