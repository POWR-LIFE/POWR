// The fake backend behind every docs screenshot. Every request to Supabase is
// answered here from fixtures, so the portals render a made-up gym or brand
// and nothing ever reaches the real database.
//
// A fixture value is either plain JSON or a function of the request:
//   rest[table](ctx)  → rows (an array) or one row
//   rpc[name](args)   → whatever the SQL function returns
//   fn[name](body)    → what the edge function returns (body has `action`)
// A function may also return reply(status, body) for an error.
// ctx = { url, params, method, body, single }.

const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*',
    'access-control-expose-headers': 'content-range',
};

export const SUPABASE_HOST = 'wjvvujnicwkruaeibttt.supabase.co';
export const AUTH_STORAGE_KEY = 'sb-wjvvujnicwkruaeibttt-auth-token';

const REPLY = Symbol('reply');
/** An explicit status and body, for a fixture that should fail. */
export const reply = (status, body) => ({ [REPLY]: true, status, body });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** A signed-in session supabase-js accepts without a network call. */
export function fakeSession({ id, email, metadata = {} }) {
    const now = Math.floor(Date.now() / 1000);
    const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: id, email, role: 'authenticated', aud: 'authenticated', exp: now + 86400 })}.c2ln`;
    const user = {
        id, email, aud: 'authenticated', role: 'authenticated',
        app_metadata: { provider: 'email' }, user_metadata: metadata,
        created_at: '2026-06-01T09:00:00Z', last_sign_in_at: new Date().toISOString(),
    };
    return { user, session: { access_token: jwt, token_type: 'bearer', expires_in: 86400, expires_at: now + 86400, refresh_token: 'docs-fake', user } };
}

/** Deep-ish merge: fixture groups (rest/rpc/fn/http) merge key by key, later wins. */
export function mergeFixtures(...list) {
    const out = { rest: {}, rpc: {}, fn: {}, http: {} };
    for (const f of list) {
        if (!f) continue;
        for (const group of Object.keys(out)) Object.assign(out[group], f[group] ?? {});
    }
    return out;
}

// Enough PostgREST filtering for portal reads: eq, neq, in, is, ilike, gt(e), lt(e).
export function filterRows(rows, params) {
    let out = rows;
    for (const [key, raw] of params) {
        if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(key)) continue;
        const m = /^(not\.)?(eq|neq|in|is|ilike|like|gt|gte|lt|lte)\.(.*)$/s.exec(raw);
        if (!m) continue;
        const [, not, op, val] = m;
        const test = (row) => {
            const v = row[key];
            switch (op) {
                case 'eq': return String(v) === val;
                case 'neq': return String(v) !== val;
                case 'in': return val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')).includes(String(v));
                case 'is': return val === 'null' ? v == null : String(v) === val;
                case 'ilike': case 'like': {
                    const re = new RegExp(`^${val.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*')}$`, 'i');
                    return re.test(String(v ?? ''));
                }
                case 'gt': return v > val;
                case 'gte': return v >= val;
                case 'lt': return v < val;
                case 'lte': return v <= val;
                default: return true;
            }
        };
        out = out.filter((r) => (not ? !test(r) : test(r)));
    }
    return out;
}

// order=col.desc,other.asc (nullsfirst/nullslast ignored).
function orderRows(rows, order) {
    if (!order) return rows;
    const keys = order.split(',').map((part) => { const [col, dir] = part.split('.'); return { col, desc: dir === 'desc' }; });
    return [...rows].sort((a, b) => {
        for (const { col, desc } of keys) {
            const x = a[col]; const y = b[col];
            if (x === y) continue;
            if (x == null) return 1;
            if (y == null) return -1;
            return (x < y ? -1 : 1) * (desc ? -1 : 1);
        }
        return 0;
    });
}

/**
 * Returns a puppeteer request handler. `unknown` collects calls no fixture
 * answered, so a capture run can say exactly which data a screen still needs.
 */
export function makeResponder({ fixtures, user, session, assets = {}, unknown = new Set() }) {
    return async (req) => {
        const url = new URL(req.url());
        const method = req.method();
        const send = (status, body, extra = {}) => req.respond({
            status,
            headers: { ...CORS, ...extra.headers },
            contentType: extra.contentType ?? 'application/json',
            body: typeof body === 'string' ? body : JSON.stringify(body ?? null),
        });

        // Local stand-ins for artwork (fictional logos), served from scripts/docs-shots/assets.
        if (url.hostname === 'docs-assets.invalid') {
            const file = assets[url.pathname.slice(1)];
            if (!file) return req.respond({ status: 404, headers: CORS, body: '' });
            return req.respond({ status: 200, headers: CORS, contentType: file.type, body: file.data });
        }
        // Analytics and error reporting never leave the machine.
        if (/sentry|posthog|google-analytics|googletagmanager|vercel-insights|vitals\.vercel/.test(url.hostname)) return req.abort();
        if (url.hostname !== SUPABASE_HOST) return req.continue();
        if (method === 'OPTIONS') return req.respond({ status: 204, headers: CORS });

        const path = url.pathname;
        let body = null;
        try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = req.postData(); }
        const single = (req.headers().accept || '').includes('vnd.pgrst.object');
        const ctx = { url, params: url.searchParams, method, body, single };

        const resolve = async (value, arg) => (typeof value === 'function' ? value(arg) : value);
        const finish = (value, okHeaders = {}) => {
            if (value && value[REPLY]) return send(value.status, value.body);
            return send(200, value, { headers: okHeaders });
        };

        if (path.startsWith('/auth/v1/user')) return send(200, user);
        if (path.startsWith('/auth/v1/token')) return send(200, session);
        if (path.startsWith('/auth/v1/')) return send(200, {});

        if (path.startsWith('/rest/v1/rpc/')) {
            const name = path.slice('/rest/v1/rpc/'.length);
            if (name in fixtures.rpc) return finish(await resolve(fixtures.rpc[name], body ?? {}));
            unknown.add(`rpc ${name}`);
            return send(400, { code: 'XX000', message: `docs-shots: no fixture for rpc ${name}` });
        }

        if (path.startsWith('/rest/v1/')) {
            const table = path.slice('/rest/v1/'.length);
            const isWrite = method !== 'GET' && method !== 'HEAD';
            if (!(table in fixtures.rest)) {
                if (!isWrite) unknown.add(`rest ${table}`);
                if (method === 'HEAD') return req.respond({ status: 200, headers: { ...CORS, 'content-range': '*/0' }, body: '' });
                if (single) return send(406, { code: 'PGRST116', message: 'no rows' });
                return send(200, [], { headers: { 'content-range': '*/0' } });
            }
            let value = await resolve(fixtures.rest[table], ctx);
            if (value && value[REPLY]) return finish(value);
            // Writes echo what was sent, so a save in a capture step "works".
            if (isWrite && value === undefined) value = body;
            const all = Array.isArray(value) ? orderRows(filterRows(value, ctx.params), ctx.params.get('order')) : value == null ? [] : [value];
            // Pages: ?offset & ?limit (what .range() sends) or a Range header; the
            // total in content-range is everything that matched, as PostgREST reports it.
            let from = Number(ctx.params.get('offset')) || 0;
            let to = ctx.params.get('limit') ? from + Number(ctx.params.get('limit')) - 1 : all.length - 1;
            const header = /^(\d+)-(\d+)?$/.exec(req.headers().range || '');
            if (header) { from = Number(header[1]); if (header[2]) to = Number(header[2]); }
            const rows = all.slice(from, to + 1);
            const range = rows.length ? `${from}-${from + rows.length - 1}/${all.length}` : `*/${all.length}`;
            if (method === 'HEAD') return req.respond({ status: 200, headers: { ...CORS, 'content-range': range }, body: '' });
            if (single) return rows.length ? send(200, rows[0], { contentType: 'application/vnd.pgrst.object+json' }) : send(406, { code: 'PGRST116', message: 'no rows' });
            return send(200, rows, { headers: { 'content-range': range } });
        }

        if (path.startsWith('/functions/v1/')) {
            const name = path.slice('/functions/v1/'.length).split('/')[0];
            if (name in fixtures.fn) return finish(await resolve(fixtures.fn[name], { ...(typeof body === 'object' ? body : {}), query: Object.fromEntries(url.searchParams) }));
            unknown.add(`fn ${name}${body?.action ? `:${body.action}` : ''}`);
            return send(200, { ok: true });
        }

        if (path.startsWith('/storage/v1/')) {
            for (const [needle, value] of Object.entries(fixtures.http)) {
                if (path.includes(needle)) return finish(await resolve(value, ctx));
            }
            return req.respond({ status: 404, headers: CORS, body: '' });
        }

        unknown.add(`other ${method} ${path}`);
        return send(200, {});
    };
}
