// Reading a whole table from the client.
//
// PostgREST caps every response at db-max-rows (1000 on prod) and raises no error for it —
// an unbounded .select() simply comes back short with HTTP 206, so "fetch everything" looks
// like it worked while returning an arbitrary subset. Anything that aggregates over a full
// table (KPI dashboards, leaderboards) has to page explicitly instead.

// Comfortably under the server cap, so a short page is unambiguous proof we hit the end.
// If a page ever arrives full, there may be more.
const PAGE_SIZE = 500;

// Backstop against a server that never returns a short page. 200 pages is 100k rows — far
// past any admin table, so reaching it means something is wrong and we should say so rather
// than spin forever.
const MAX_PAGES = 200;

// `.in()` encodes every id into the query string, so a long list can overrun the URL limit.
const ID_CHUNK = 200;

/**
 * Reads every row matching a query, one page at a time.
 *
 * `build` must return a *fresh* PostgREST builder each call — builders are single-use, so
 * handing the same one to every page throws.
 *
 *   const sessions = await fetchAllRows(() =>
 *       supabase.from('activity_sessions').select('id, user_id, duration_sec'));
 *
 * Rows come back ordered by `orderBy` (default `id`) only to make paging stable: without a
 * total order the server may repeat or skip rows across pages. Sort for display yourself.
 *
 * Throws on a query error, unlike the `data || []` pattern that quietly yields an empty set.
 */
export async function fetchAllRows(build, { orderBy = 'id', pageSize = PAGE_SIZE } = {}) {
    const rows = [];
    for (let page = 0; page < MAX_PAGES; page++) {
        const from = page * pageSize;
        const { data, error } = await build()
            .order(orderBy, { ascending: true })
            .range(from, from + pageSize - 1);
        if (error) throw error;
        rows.push(...(data ?? []));
        if ((data?.length ?? 0) < pageSize) return rows;
    }
    throw new Error(
        `fetchAllRows: still full after ${MAX_PAGES} pages (${MAX_PAGES * pageSize} rows) — refusing to page further`
    );
}

/**
 * Reads every row whose `column` matches one of `ids`, chunking so the query string stays
 * within limits. Ids are de-duplicated; an empty list costs no request.
 *
 *   const venues = await fetchRowsByIds(
 *       () => supabase.from('partners').select('id, name'), partnerIds);
 */
export async function fetchRowsByIds(build, ids, { column = 'id', ...opts } = {}) {
    const unique = [...new Set(ids)].filter(Boolean);
    const rows = [];
    for (let i = 0; i < unique.length; i += ID_CHUNK) {
        const chunk = unique.slice(i, i + ID_CHUNK);
        rows.push(...await fetchAllRows(() => build().in(column, chunk), opts));
    }
    return rows;
}
