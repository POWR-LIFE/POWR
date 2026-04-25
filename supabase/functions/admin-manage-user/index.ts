// @ts-nocheck — Deno runtime
// Admin-only edge function: create or delete a user.
// Caller must be in the admin_roles table.

import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // ── Auth: verify caller is a logged-in admin ──────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const adminClient = createClient(
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
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Check admin_roles
  const { data: adminRow } = await adminClient
    .from('admin_roles')
    .select('user_id')
    .eq('user_id', user.id)
    .single();

  if (!adminRow) {
    return new Response(JSON.stringify({ error: 'Forbidden: admin access required' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── Parse body ────────────────────────────────────────────────
  let body: { action: string; [key: string]: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── Action: create ────────────────────────────────────────────
  if (body.action === 'create') {
    const { email, password, display_name, username, is_pro } = body as {
      email: string; password: string;
      display_name?: string; username?: string; is_pro?: boolean;
    };

    if (!email || !password) {
      return new Response(JSON.stringify({ error: 'email and password are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: display_name ?? '' },
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const newUserId = data.user.id;

    // Update profile with extra fields (trigger creates the base row)
    const profileUpdate: Record<string, unknown> = {};
    if (display_name) profileUpdate.display_name = display_name;
    if (username)     profileUpdate.username      = username;
    if (is_pro)       profileUpdate.is_pro        = true;

    if (Object.keys(profileUpdate).length > 0) {
      await adminClient.from('profiles').update(profileUpdate).eq('id', newUserId);
    }

    // Audit log
    await adminClient.from('admin_audit_log').insert({
      admin_id: user.id, action: 'create_user',
      target_type: 'user', target_id: newUserId,
      metadata: { email, display_name, username, is_pro: !!is_pro },
    });

    return new Response(JSON.stringify({ user_id: newUserId }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── Action: delete ────────────────────────────────────────────
  if (body.action === 'delete') {
    const { user_id } = body as { user_id: string };

    if (!user_id) {
      return new Response(JSON.stringify({ error: 'user_id is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Prevent self-deletion
    if (user_id === user.id) {
      return new Response(JSON.stringify({ error: 'Cannot delete your own account' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Audit log before deletion (after deletion the record is gone)
    const { data: target } = await adminClient
      .from('profiles')
      .select('display_name, username')
      .eq('id', user_id)
      .single();

    await adminClient.from('admin_audit_log').insert({
      admin_id: user.id, action: 'delete_user',
      target_type: 'user', target_id: user_id,
      metadata: { display_name: target?.display_name, username: target?.username },
    });

    const { error } = await adminClient.auth.admin.deleteUser(user_id);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ deleted: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), {
    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
