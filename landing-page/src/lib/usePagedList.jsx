// Server-paged lists for admin detail pages.
//
// The alternative these replace — fetch a fixed N, render fewer than N, label the section
// with the length of what you fetched — lies twice: the count is the fetch size rather than
// the real total, and everything past N is unreachable. A per-user health log can run to
// four figures, so the page has to come from the server with a real count beside it.

import React, { useEffect, useRef, useState } from 'react';

/**
 * Holds one page of a query in memory alongside the server's exact total.
 *
 * `build` must return a fresh PostgREST builder each call, selecting with
 * `{ count: 'exact' }` so the total comes back; `.range()` is applied here.
 *
 * Order by something unique, or end on a unique tiebreak. Paging a non-unique sort lets
 * the server order tied rows differently per page, which shows some rows twice and hides
 * others completely — and it does so silently, because every page still looks full.
 *
 *   const log = usePagedList(
 *       () => supabase.from('push_send_log').select('*', { count: 'exact' }).eq('user_id', userId),
 *       [userId],
 *       { pageSize: 25 });
 *
 * `deps` behaves like an effect dependency list: change it and the query re-runs from
 * page 0.
 *
 * Returns `reload()` to refetch the current page — use it after anything that changes
 * which rows exist, since the total and the page boundaries both move — and `setRows()`
 * to patch a row in place, for edits that leave the row where it is.
 */
export function usePagedList(build, deps = [], { pageSize = 25 } = {}) {
    const [page, setPage] = useState(0);
    const [reloadTick, setReloadTick] = useState(0);
    const [state, setState] = useState({ rows: [], total: 0, loading: true, error: null });

    // `build` closes over render-scope values and is a new function every render, so it
    // can't be an effect dependency without refetching in a loop. Track the latest one and
    // let the caller's `deps` decide when the query has actually changed.
    const buildRef = useRef(build);
    buildRef.current = build;

    // A dependency change (different user, different filter) invalidates the position —
    // page 4 of the old list is not page 4 of the new one, and may not exist at all.
    useEffect(() => { setPage(0); }, deps); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        let cancelled = false;
        setState(prev => ({ ...prev, loading: true }));
        (async () => {
            const { data, error, count } = await buildRef.current()
                .range(page * pageSize, (page + 1) * pageSize - 1);
            // A slower earlier page must not overwrite a newer one.
            if (cancelled) return;
            setState({ rows: data ?? [], total: count ?? 0, loading: false, error: error ?? null });
        })();
        return () => { cancelled = true; };
    }, [page, pageSize, reloadTick, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

    const pageCount = Math.max(1, Math.ceil(state.total / pageSize));

    return {
        ...state,
        page,
        pageSize,
        pageCount,
        // Clamped so a stale click can't strand the view on an empty page.
        goTo: next => setPage(Math.min(Math.max(0, next), pageCount - 1)),
        reload: () => setReloadTick(t => t + 1),
        setRows: update => setState(s => ({
            ...s,
            rows: typeof update === 'function' ? update(s.rows) : update,
        })),
    };
}

/** Prev/next control showing the real position in the real total. Renders nothing on a single page. */
export function Pager({ page, pageSize, total, goTo, className = '' }) {
    if (total <= pageSize) return null;
    const first = page * pageSize + 1;
    const last = Math.min((page + 1) * pageSize, total);
    const btn = 'h-9 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[10px] uppercase tracking-[0.3em] text-[#888888] hover:text-[#333333] disabled:opacity-30 font-black transition-all';
    return (
        <div className={`p-6 border-t border-[#E6E6E1] bg-[#F4F4F1] flex items-center justify-between ${className}`}>
            <span className="text-[10px] uppercase tracking-[0.3em] text-[#999999] font-black">
                {first}–{last} of {total.toLocaleString()}
            </span>
            <div className="flex gap-2">
                <button type="button" disabled={page === 0} onClick={() => goTo(page - 1)} className={btn}>← Prev</button>
                <button type="button" disabled={last >= total} onClick={() => goTo(page + 1)} className={btn}>Next →</button>
            </div>
        </div>
    );
}
