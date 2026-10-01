import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { accountStatus, cancelPost, connectAccount, disconnectAccount, fmtLondon, KIND_LABEL, listPosts, retryPost } from './store';

/**
 * Studio → Instagram: the posts made from the Studio (scheduled, published,
 * failed) and the account they go to. Admin only, POWR's own account.
 */
const STATUS = {
    scheduled: 'bg-[#EEF3FF] text-[#2F55C8]',
    publishing: 'bg-[#FFF6D6] text-[#8A6A00]',
    published: 'bg-[#E6F6EC] text-[#1C7A43]',
    failed: 'bg-[#FDECEA] text-[#B3261E]',
    cancelled: 'bg-[#EEE] text-[#777]',
};

export default function InstagramPosts({ intro = null, refreshKey = 0 }) {
    const [posts, setPosts] = useState(null);
    const [account, setAccount] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(null);

    const load = useCallback(async () => {
        setError(null);
        try { setPosts(await listPosts()); } catch (e) { setError(e.message); setPosts([]); }
        accountStatus().then(setAccount, (e) => setAccount({ error: e.message }));
    }, []);
    useEffect(() => { load(); }, [load, refreshKey]);

    const act = async (id, fn) => {
        setBusy(id);
        setError(null);
        try { await fn(id); } catch (e) { setError(e.message); }
        setBusy(null);
        load();
    };

    return (
        <div className="mx-auto max-w-5xl space-y-6 pb-16">
            {intro}
            <ConnectCard account={account} onChanged={load} />

            <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-base font-semibold text-[#111]">Posts</h2>
                    <button type="button" onClick={load} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-[#666] hover:bg-[#F2F2EE]"><RefreshCw size={14} /> Refresh</button>
                </div>
                {error && <p className="mb-3 rounded-lg bg-[#FDECEA] p-3 text-sm text-[#B3261E]">{error}</p>}
                {posts == null ? (
                    <div className="flex items-center gap-2 text-sm text-[#777]"><Loader2 size={14} className="animate-spin" /> Loading…</div>
                ) : !posts.length ? (
                    <p className="text-sm text-[#777]">Nothing yet. In “One post”, use Post to Instagram next to Download.</p>
                ) : (
                    <ul className="divide-y divide-black/5">
                        {posts.map((p) => (
                            <li key={p.id} className="flex gap-4 py-3">
                                <div className="h-20 w-16 shrink-0 overflow-hidden rounded-md bg-[#EAEAE5]">
                                    {p.thumbUrl && <img src={p.thumbUrl} alt="" className="h-full w-full object-cover" />}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2 text-xs">
                                        <span className={`rounded-full px-2 py-0.5 font-semibold capitalize ${STATUS[p.status]}`}>{p.status}</span>
                                        <span className="font-medium text-[#444]">{KIND_LABEL[p.kind]}{p.media?.length > 1 ? ` · ${p.media.length}` : ''}</span>
                                        <span className="text-[#888]">
                                            {p.status === 'published' ? `Posted ${fmtLondon(p.published_at)}` : p.status === 'scheduled' ? `Due ${fmtLondon(p.scheduled_at)}` : fmtLondon(p.scheduled_at)}
                                        </span>
                                    </div>
                                    <p className="mt-1 line-clamp-2 text-sm text-[#222]">{p.caption || <span className="text-[#999]">No caption</span>}</p>
                                    {p.error && <p className="mt-1 text-xs text-[#B3261E]">{p.error}</p>}
                                    {p.note && <details className="mt-1 text-xs text-[#8A6A00]"><summary className="cursor-pointer">{p.note.split('\n')[0]}</summary><pre className="mt-1 whitespace-pre-wrap break-all text-[11px] text-[#666]">{p.note.split('\n').slice(1).join('\n')}</pre></details>}
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-1.5">
                                    {p.permalink && <a href={p.permalink} target="_blank" rel="noreferrer" style={{ color: "#2F55C8" }} className="flex items-center gap-1 text-sm hover:underline">Open <ExternalLink size={12} /></a>}
                                    {p.status === 'scheduled' && (
                                        <button type="button" disabled={busy === p.id} onClick={() => act(p.id, cancelPost)} className="rounded-lg border border-black/10 px-2.5 py-1 text-sm text-[#444] hover:bg-[#F2F2EE] disabled:opacity-50">Cancel</button>
                                    )}
                                    {p.status === 'failed' && (
                                        <button type="button" disabled={busy === p.id || p.attempts >= 3} onClick={() => act(p.id, retryPost)}
                                            title={p.attempts >= 3 ? 'Three attempts used — make it again from the Studio' : 'Try again now'}
                                            className="rounded-lg border border-black/10 px-2.5 py-1 text-sm text-[#444] hover:bg-[#F2F2EE] disabled:opacity-50">
                                            {busy === p.id ? <Loader2 size={14} className="animate-spin" /> : 'Retry'}
                                        </button>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}

function ConnectCard({ account, onChanged }) {
    const [token, setToken] = useState('');
    const [userId, setUserId] = useState('');
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    const connect = async () => {
        setBusy(true);
        setError(null);
        try {
            await connectAccount({ accessToken: token.trim(), igUserId: userId.trim() });
            setToken(''); setUserId(''); setOpen(false);
            onChanged();
        } catch (e) { setError(e.message); }
        setBusy(false);
    };

    const showForm = open || (account && !account.error && !account.connected);
    return (
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-base font-semibold text-[#111]">Account</h2>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                        {!account ? <span className="text-[#777]">Checking…</span>
                            : account.error ? <span className="text-[#B3261E]">{account.error}</span>
                                : account.connected ? <>
                                    <span className="rounded-full bg-[#E6F6EC] px-2.5 py-0.5 text-xs font-semibold text-[#1C7A43]">Connected · @{account.username}</span>
                                    {account.token_expires_at && <span className="text-xs text-[#888]">token renews itself; expires {fmtLondon(account.token_expires_at)}</span>}
                                </>
                                    : <span className="rounded-full bg-[#EEE] px-2.5 py-0.5 text-xs font-semibold text-[#666]">Not connected</span>}
                        {account?.dry_run && <span className="rounded-full bg-[#FFF6D6] px-2.5 py-0.5 text-xs font-semibold text-[#8A6A00]">Dry run — nothing posts until DRY_RUN=false</span>}
                    </div>
                </div>
                {account?.connected && !open && (
                    <div className="flex gap-2">
                        <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-black/10 px-3 py-1.5 text-sm text-[#444] hover:bg-[#F2F2EE]">Replace token</button>
                        <button type="button" onClick={async () => { if (window.confirm('Disconnect Instagram? Scheduled posts will fail until it’s connected again.')) { await disconnectAccount().catch((e) => setError(e.message)); onChanged(); } }}
                            className="rounded-lg px-3 py-1.5 text-sm text-[#B3261E] hover:bg-[#FDECEA]">Disconnect</button>
                    </div>
                )}
            </div>
            {showForm && (
                <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
                    <label className="text-sm">
                        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#777]">Long-lived access token</span>
                        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" placeholder="IGAA…"
                            className="w-full rounded-lg border border-black/10 px-3 py-2 font-mono text-[13px]" />
                    </label>
                    <label className="text-sm">
                        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#777]">Instagram user id</span>
                        <input value={userId} onChange={(e) => setUserId(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="1784…"
                            className="w-full rounded-lg border border-black/10 px-3 py-2 font-mono text-[13px]" />
                    </label>
                    <button type="button" disabled={busy || !token.trim() || !userId} onClick={connect}
                        className="flex h-[38px] items-center justify-center gap-1.5 rounded-lg bg-[#111] px-4 text-sm font-semibold text-white disabled:opacity-40">
                        {busy && <Loader2 size={14} className="animate-spin" />} Check and connect
                    </button>
                    <p className="text-xs text-[#888] sm:col-span-3">From Meta’s app dashboard (Instagram → API setup with Instagram login → Generate token). It’s checked against Instagram, then stored server-side; the Studio never sees it again.</p>
                </div>
            )}
            {error && <p className="mt-3 rounded-lg bg-[#FDECEA] p-3 text-sm text-[#B3261E]">{error}</p>}
        </section>
    );
}
