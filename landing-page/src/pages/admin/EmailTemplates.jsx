import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle, Check, Code2, Copy, FileText, FlaskConical, History, ImageUp, Loader2, Mail,
    Monitor, Moon, Plus, RefreshCw, Save, Send, Smartphone, Trash2,
} from 'lucide-react';
import { useAuth } from '../../App';
import { supabase } from '../../lib/supabase';
import { invokeFn } from '../../lib/invokeFn';
import { useToast } from '../../lib/toast';
import AudienceSelector, { audienceLabel } from '../../components/AudienceSelector';

// Email templates: write the HTML here, see it rendered the way a member will
// (the admin-send-email function renders it with YOUR merge data), send a test
// to an admin inbox, then send to an audience. The audience picker is the one
// the push Broadcast uses, so "Everyone" / a segment / a live event means the
// same people in both tools; mail just has no device filters.

// Mirrors MERGE_TAGS in supabase/functions/_shared/emails/admin-template.ts.
const MERGE_TAGS = [
    { tag: 'first_name',    label: 'First name',   hint: "From their display name; 'there' when unknown" },
    { tag: 'name',          label: 'Full name',    hint: 'Their display name' },
    { tag: 'username',      label: 'Username',     hint: 'Without the @' },
    { tag: 'email',         label: 'Email',        hint: 'The address this is sent to' },
    { tag: 'referral_code', label: 'POWR ID',      hint: 'Their referral code' },
    { tag: 'balance',       label: 'POWR balance', hint: 'Points they can spend right now' },
];

// What a new template starts from: a body fragment the POWR shell wraps, with
// inline styles (mail clients ignore most stylesheets) and two merge tags.
const STARTER_HTML = `<p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#8F8203;">POWR</p>
<h1 style="margin:0 0 18px;font-size:34px;font-weight:200;line-height:1.15;color:#F2F2F2;">Hey {{first_name}},<br><em style="font-style:italic;color:#E8D200;">here's the news.</em></h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#BBBBBB;">Write your email here. Paragraphs, images and buttons all work. Merge tags like {{balance}} are filled in per person.</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px auto 0;">
  <tr>
    <td style="border-radius:24px;background-color:#E8D200;">
      <a href="https://powr.life/app" style="display:inline-block;padding:14px 32px;font-size:13px;font-weight:700;color:#080808;text-decoration:none;letter-spacing:1.5px;text-transform:uppercase;">Open POWR</a>
    </td>
  </tr>
</table>`;

// Same limits as the admin-send-email function. Gmail clips HTML over 102 KB.
const HTML_MAX_CHARS = 2_000_000;
const GMAIL_CLIP_BYTES = 102 * 1024;
const DATA_IMAGE_RE = /data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/gi;
const formatKB = (bytes) => `${Math.round(bytes / 1024).toLocaleString('en-GB')} KB`;

// Unique base64 images in the HTML and their decoded weight.
function embeddedImages(html) {
    const seen = new Set();
    let bytes = 0;
    for (const m of html.matchAll(DATA_IMAGE_RE)) {
        if (seen.has(m[0])) continue;
        seen.add(m[0]);
        const b64 = m[2];
        bytes += Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
    }
    return { count: seen.size, bytes };
}

const STATUS = {
    sending: { label: 'Sending',  className: 'bg-[#DBEAFE] text-[#1D4ED8]' },
    paused:  { label: 'Paused',   className: 'bg-[#FEF3C7] text-[#92400E]' },
    sent:    { label: 'Sent',     className: 'bg-[#DCFCE7] text-[#166534]' },
    failed:  { label: 'Failed',   className: 'bg-[#FEE2E2] text-[#991B1B]' },
};

const fieldClass = 'w-full rounded-xl border border-[#E6E6E1] bg-[#FAFAF8] px-4 py-2.5 text-[#111] text-sm focus:outline-none focus:border-[#E8D200]';
const labelClass = 'block text-xs font-semibold text-[#888] mb-1.5 uppercase tracking-wide';

const timeAgo = (dateStr) => {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};

// Plain-text twin of the HTML, built from the parsed document (never by
// regex-stripping tags). Links keep their URL so the text version still works.
function htmlToText(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, head, title').forEach((el) => el.remove());
    const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr', 'table', 'blockquote', 'section', 'header', 'footer', 'ul', 'ol', 'pre']);
    const out = [];
    const walk = (node) => {
        if (node.nodeType === 3) { out.push(node.nodeValue.replace(/\s+/g, ' ')); return; }
        if (node.nodeType !== 1) return;
        const tag = node.tagName.toLowerCase();
        if (tag === 'br') { out.push('\n'); return; }
        if (BLOCK.has(tag)) out.push('\n');
        if (tag === 'a') {
            const href = node.getAttribute('href');
            const label = node.textContent.replace(/\s+/g, ' ').trim();
            out.push(href && href !== label ? `${label} (${href})` : label);
            return;
        }
        if (tag === 'img') { const alt = node.getAttribute('alt'); if (alt) out.push(`[${alt}]`); return; }
        node.childNodes.forEach(walk);
        if (BLOCK.has(tag)) out.push('\n');
    };
    walk(doc.body);
    return out.join('').split('\n').map((l) => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function blankTemplate() {
    return {
        id: null,
        name: 'Untitled email',
        subject: '',
        preheader: '',
        html: STARTER_HTML,
        text: '',
        use_shell: true,
        reply_to: 'support@powr.life',
        last_sent_at: null,
        updated_at: null,
    };
}

const templatePayload = (t) => ({
    subject: t.subject ?? '',
    preheader: t.preheader ?? '',
    html: t.html ?? '',
    text: t.text ?? '',
    use_shell: t.use_shell !== false,
});

const callEmail = (body) => invokeFn('admin-send-email', body);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Addresses tests were sent to from this browser. A convenience only: the list lives in
// localStorage (which can be blocked or empty), and the server accepts any valid address.
const RECENT_TESTS_KEY = 'powr.admin.email.recentTests';
function readRecentTests() {
    try {
        const parsed = JSON.parse(localStorage.getItem(RECENT_TESTS_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter((e) => typeof e === 'string').slice(0, 5) : [];
    } catch {
        return [];
    }
}
function rememberTestAddress(address) {
    const next = [address, ...readRecentTests().filter((e) => e !== address)].slice(0, 5);
    try { localStorage.setItem(RECENT_TESTS_KEY, JSON.stringify(next)); } catch { /* private window: skip */ }
    return next;
}

// Gmail on iPhone recolours every email in dark mode: a full lightness inversion that leaves
// images alone and also leaves blocks that paint a background image (the renderer gives
// image-only blocks a same-colour gradient so they keep their colour). A CSS filter on the
// preview reproduces it closely: against colours Gmail really produced it lands within 5/255
// on large surfaces and within about 8/255 on a gold accent. Images and gradient blocks get
// the exact inverse filter so they come out unchanged. An approximation, not Gmail itself.
const GMAIL_DARK_FILTER = 'invert(1) hue-rotate(180deg) saturate(.65)';
const GMAIL_DARK_UNDO = 'saturate(1.5385) hue-rotate(180deg) invert(1)';
const GMAIL_DARK_CSS = `<style>img,picture,video,svg,[style*="linear-gradient"]{filter:${GMAIL_DARK_UNDO}}[style*="linear-gradient"] img{filter:none}</style>`;

const card = 'rounded-2xl border border-[#E6E6E1] bg-white overflow-hidden';

/** One header style for every card on the page: step chip, uppercase title, actions on the right. */
function CardHeader({ step, icon: Icon, title, children }) {
    return (
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-[#F0F0EC] min-h-[52px]">
            <div className="flex items-center gap-2.5 text-xs font-semibold text-[#888] uppercase tracking-wide shrink-0">
                {step && <span className="w-5 h-5 rounded-full bg-[#111] text-[#E8D200] text-[10px] font-bold flex items-center justify-center tracking-normal">{step}</span>}
                {Icon && <Icon size={14} className="text-[#999]" />}
                {title}
            </div>
            {children && <div className="flex items-center gap-2 min-w-0">{children}</div>}
        </div>
    );
}

function StatusBadge({ status }) {
    const meta = STATUS[status] ?? STATUS.paused;
    return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${meta.className}`}>{meta.label}</span>;
}

export default function EmailTemplates() {
    const toast = useToast();
    const { user } = useAuth();

    const [templates, setTemplates] = useState(null);
    const [draft, setDraft] = useState(null);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [tab, setTab] = useState('html');
    const editorRef = useRef(null);

    const [preview, setPreview] = useState(null);
    const [previewError, setPreviewError] = useState(null);
    const [rendering, setRendering] = useState(false);
    const [previewWidth, setPreviewWidth] = useState('desktop');
    const [gmailDark, setGmailDark] = useState(false);   // preview as Gmail on iPhone shows it in dark mode

    const [testTo, setTestTo] = useState('');
    const [testing, setTesting] = useState(false);
    const [recentTests, setRecentTests] = useState(readRecentTests);   // addresses tests went to from this browser
    const [extracting, setExtracting] = useState(false);

    const [audience, setAudience] = useState({ mode: 'all' });
    const [audienceCount, setAudienceCount] = useState(null);
    const [audienceStats, setAudienceStats] = useState(null);
    const [confirm, setConfirm] = useState(false);
    const [sending, setSending] = useState(false);
    const [progress, setProgress] = useState(null);

    const [history, setHistory] = useState([]);
    const [openSend, setOpenSend] = useState(null);     // expanded history row id
    const [failures, setFailures] = useState([]);

    useEffect(() => { if (user?.email && !testTo) setTestTo(user.email); }, [user?.email]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Data ────────────────────────────────────────────────────────────────
    const loadTemplates = useCallback(async (preferredId) => {
        const { data, error } = await supabase
            .from('email_templates')
            .select('*')
            .order('updated_at', { ascending: false });
        if (error) { toast.error(error.message); return; }
        const rows = data ?? [];
        setTemplates(rows);
        setDraft((current) => {
            const wanted = preferredId ?? current?.id;
            if (wanted) return rows.find((t) => t.id === wanted) ?? current;
            return current ?? rows[0] ?? blankTemplate();
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const loadHistory = useCallback(async () => {
        const { data } = await supabase
            .from('email_sends')
            .select('id, template_id, template_name, subject, audience, status, recipient_count, sent_count, failed_count, opted_out_count, created_at, updated_at, completed_at')
            .order('created_at', { ascending: false })
            .limit(20);
        setHistory(data ?? []);
    }, []);

    useEffect(() => { loadTemplates(); loadHistory(); }, [loadTemplates, loadHistory]);

    useEffect(() => {
        if (!openSend) { setFailures([]); return; }
        supabase.from('email_send_deliveries')
            .select('email, error, sent_at')
            .eq('send_id', openSend)
            .eq('status', 'failed')
            .order('email')
            .then(({ data }) => setFailures(data ?? []));
    }, [openSend]);

    // ── Preview: the server renders the draft with the caller's own data ────
    useEffect(() => {
        if (!draft) return;
        if ((draft.html ?? '').length > HTML_MAX_CHARS) {
            setRendering(false);
            setPreviewError(`the HTML is ${draft.html.length.toLocaleString('en-GB')} characters, over the ${HTML_MAX_CHARS.toLocaleString('en-GB')} limit. Upload its embedded images to storage first (button above the editor).`);
            return;
        }
        let cancelled = false;
        setRendering(true);
        const t = setTimeout(async () => {
            try {
                const r = await callEmail({ action: 'render', template: templatePayload(draft) });
                if (!cancelled) { setPreview(r); setPreviewError(null); }
            } catch (e) {
                if (!cancelled) setPreviewError(e.message || 'Preview failed');
            } finally {
                if (!cancelled) setRendering(false);
            }
        }, 600);
        return () => { cancelled = true; clearTimeout(t); };
    }, [draft?.html, draft?.subject, draft?.preheader, draft?.use_shell, draft?.text]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Draft editing ───────────────────────────────────────────────────────
    const update = (patch) => { setDraft((d) => ({ ...d, ...patch })); setDirty(true); };

    const chooseTemplate = (t) => {
        if (dirty && !window.confirm('Discard unsaved changes?')) return;
        setDraft(t); setDirty(false); setProgress(null);
    };
    const startNew = () => {
        if (dirty && !window.confirm('Discard unsaved changes?')) return;
        setDraft(blankTemplate()); setDirty(true); setTab('html'); setProgress(null);
    };
    const duplicate = () => {
        if (!draft) return;
        if (dirty && !window.confirm('Discard unsaved changes?')) return;
        setDraft({ ...draft, id: null, name: `${draft.name} (copy)`, last_sent_at: null, updated_at: null });
        setDirty(true); setProgress(null);
    };

    const saveDraft = async (silent = false) => {
        if (!draft) return null;
        const name = draft.name.trim();
        if (!name) { toast.error('Give the template a name'); return null; }
        setSaving(true);
        const payload = {
            name,
            subject: draft.subject.trim(),
            preheader: draft.preheader.trim(),
            html: draft.html,
            // Blank plain text = generate it from the HTML now, so every send
            // carries a text part. Edited text is kept as written.
            text: draft.text.trim() ? draft.text : htmlToText(draft.html),
            use_shell: draft.use_shell !== false,
            reply_to: draft.reply_to.trim() || 'support@powr.life',
            updated_by: user?.id ?? null,
        };
        const result = draft.id
            ? await supabase.from('email_templates').update(payload).eq('id', draft.id).select('*').single()
            : await supabase.from('email_templates').insert({ ...payload, created_by: user?.id ?? null }).select('*').single();
        setSaving(false);
        if (result.error) {
            toast.error(result.error.code === '23514'
                ? 'The HTML is longer than the database allows — upload its embedded images to storage or trim it'
                : result.error.message);
            return null;
        }
        setDraft(result.data); setDirty(false);
        await loadTemplates(result.data.id);
        if (!silent) toast.success('Template saved');
        return result.data;
    };

    const deleteTemplate = async () => {
        if (!draft?.id) { setDraft(templates?.[0] ?? blankTemplate()); setDirty(false); return; }
        if (!window.confirm(`Delete "${draft.name}"? Past sends keep their own copy of the email.`)) return;
        const { error } = await supabase.from('email_templates').delete().eq('id', draft.id);
        if (error) { toast.error(error.message); return; }
        toast.success('Template deleted');
        setDraft(null); setDirty(false);
        await loadTemplates();
    };

    // Insert a merge tag where the caret is, in whichever editor is open.
    const insertTag = (tag) => {
        const field = tab === 'text' ? 'text' : 'html';
        const token = `{{${tag}}}`;
        const el = editorRef.current;
        const value = draft?.[field] ?? '';
        const s = el?.selectionStart ?? value.length;
        const e = el?.selectionEnd ?? s;
        update({ [field]: value.slice(0, s) + token + value.slice(e) });
        requestAnimationFrame(() => {
            if (!el) return;
            el.focus();
            el.setSelectionRange(s + token.length, s + token.length);
        });
    };

    const onEditorKeyDown = (e) => {
        if (e.key !== 'Tab') return;
        e.preventDefault();
        const el = e.target;
        const field = tab === 'text' ? 'text' : 'html';
        const value = draft?.[field] ?? '';
        const s = el.selectionStart, end = el.selectionEnd;
        update({ [field]: `${value.slice(0, s)}  ${value.slice(end)}` });
        requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
    };

    // Upload every base64 image to storage and point the HTML at the URLs.
    const extractImages = async () => {
        if (!draft) return;
        setExtracting(true);
        try {
            const r = await callEmail({ action: 'extract_images', html: draft.html, template_id: draft.id ?? undefined });
            update({ html: r.html });
            const n = r.images?.length ?? 0;
            toast.success(`${n} image${n === 1 ? '' : 's'} uploaded · HTML ${formatKB(r.before_chars)} → ${formatKB(r.after_chars)}`);
            if (r.failed?.length) toast.error(`${r.failed.length} image${r.failed.length === 1 ? '' : 's'} could not be uploaded: ${r.failed[0].error}`);
        } catch (e) {
            toast.error(e.message || 'Upload failed');
        } finally {
            setExtracting(false);
        }
    };

    // ── Test + send ─────────────────────────────────────────────────────────
    const sendTest = async () => {
        if (!draft) return;
        setTesting(true);
        try {
            const r = await callEmail({
                action: 'test',
                template: templatePayload(draft),
                template_id: draft.id ?? undefined,
                reply_to: draft.reply_to,
                to: testTo.trim() || undefined,
            });
            toast.success(`Test sent to ${r.sent_to}`);
            setRecentTests(rememberTestAddress(r.sent_to));
        } catch (e) {
            toast.error(e.message || 'Test failed');
        } finally {
            setTesting(false);
        }
    };

    const onAudienceChange = useCallback(({ audience, count }) => {
        setAudience(audience);
        setAudienceCount(count);
    }, []);

    const emailCounter = useCallback(async (aud) => {
        const r = await callEmail({ action: 'count', audience: aud });
        setAudienceStats({ opted_out: r.opted_out ?? 0, with_email: r.with_email ?? 0 });
        return r.recipients;
    }, []);

    // Runs a send (or a resume) to completion: the function works in ~90 s
    // slices and the panel keeps calling resume until every row is done.
    const runSend = async (first) => {
        setSending(true);
        try {
            let r = await first;
            setProgress(r);
            while (!r.done && !r.stalled) {
                r = await callEmail({ action: 'resume', send_id: r.send_id });
                setProgress(r);
            }
            if (r.done) {
                toast.success(`Sent to ${r.sent} of ${r.recipients}${r.failed ? ` · ${r.failed} failed` : ''}`);
            } else {
                toast.info(`${r.queued} recipient${r.queued === 1 ? ' is' : 's are'} held by an interrupted run — resume again in 10 minutes`);
            }
            loadTemplates();
        } catch (e) {
            toast.error(e.message || 'Send failed');
        } finally {
            setSending(false);
            loadHistory();
        }
    };

    const send = () => {
        setConfirm(false);
        runSend(callEmail({ action: 'send', template_id: draft.id, audience }));
    };
    const resume = (sendId) => runSend(callEmail({ action: 'resume', send_id: sendId }));

    const testBlocker = !draft?.subject?.trim() ? 'Add a subject to send a test'
        : !draft?.html?.trim() ? 'Add some HTML to send a test'
        : testTo.trim() && !EMAIL_RE.test(testTo.trim()) ? 'That is not an email address'
        : null;
    const canSend = Boolean(draft?.id) && !dirty && draft?.subject?.trim() && draft?.html?.trim() && audienceCount > 0 && !sending;
    const sendBlocker = !draft?.id || dirty ? 'Save the template first'
        : !draft?.subject?.trim() ? 'Add a subject'
        : !draft?.html?.trim() ? 'Add some HTML'
        : audienceCount === 0 ? 'Nobody in this audience can be emailed'
        : null;

    const warnings = preview?.warnings ?? [];
    const embedded = useMemo(() => embeddedImages(draft?.html ?? ''), [draft?.html]);
    const renderedKB = preview?.size_bytes ? formatKB(preview.size_bytes) : null;
    const overClip = (preview?.size_bytes ?? 0) > GMAIL_CLIP_BYTES;
    const shownWarnings = embedded.count > 0 ? warnings.filter((w) => !/base64/i.test(w)) : warnings;
    const editorValue = tab === 'text' ? (draft?.text ?? '') : (draft?.html ?? '');
    const editorField = tab === 'text' ? 'text' : 'html';
    const sortedTemplates = useMemo(() => templates ?? [], [templates]);

    const Tab = ({ value, icon: Icon, children }) => (
        <button
            type="button"
            onClick={() => setTab(value)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === value ? 'bg-white text-[#111] shadow-sm' : 'text-[#777] hover:text-[#333]'
            }`}
        >
            <Icon size={13} />{children}
        </button>
    );

    if (!draft) {
        return (
            <div className="max-w-5xl mx-auto px-4 py-6 text-sm text-[#999]">
                {templates === null ? 'Loading…' : (
                    <button onClick={startNew} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#E8D200] text-[#080808] text-sm font-semibold hover:brightness-95">
                        <Plus size={15} /> New template
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className="max-w-[1520px] mx-auto px-4 py-6">
            <div className="flex items-start justify-between gap-4 mb-5">
                <div className="min-w-0 max-w-3xl">
                    <div className="flex items-center gap-3">
                        <Mail size={22} className="text-[#E8D200]" />
                        <h1 className="text-xl font-bold text-[#111]">Email</h1>
                    </div>
                    <p className="text-sm text-[#777] mt-1">
                        Write it, check the preview, test it in an inbox, then choose who gets it.
                        Sent through Mailgun as <span className="text-[#333]">POWR &lt;hello@powr.life&gt;</span>; anyone who turned Product news off is left out.
                    </p>
                </div>
                <button onClick={startNew} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E6E6E1] bg-white text-sm font-medium text-[#333] hover:border-[#CFCFCF] shrink-0">
                    <Plus size={15} /> New template
                </button>
            </div>

            <div className="grid grid-cols-1 min-[1280px]:grid-cols-[minmax(0,1fr)_400px] min-[1560px]:grid-cols-[256px_minmax(0,1fr)_440px] gap-4 items-start">
                {/* Rail: templates + what has gone out */}
                <aside className="grid grid-cols-1 md:grid-cols-2 min-[1560px]:grid-cols-1 gap-4 items-start col-span-full min-[1560px]:col-span-1 min-[1560px]:sticky min-[1560px]:top-20">
                    <section className={card}>
                        <CardHeader icon={FileText} title={`Templates${sortedTemplates.length ? ` · ${sortedTemplates.length}` : ''}`} />
                        <div className="divide-y divide-[#F0F0EC] max-h-[46vh] overflow-y-auto">
                            {draft && !draft.id && (
                                <div className="px-4 py-3 border-l-2 border-[#E8D200] bg-[#FFFBE6]">
                                    <div className="text-sm font-semibold text-[#111] truncate">{draft.name || 'Untitled email'}</div>
                                    <div className="text-[11px] text-[#B59B00]">Unsaved</div>
                                </div>
                            )}
                            {sortedTemplates.map((t) => {
                                const active = draft?.id === t.id;
                                return (
                                    <button
                                        key={t.id}
                                        type="button"
                                        onClick={() => chooseTemplate(t)}
                                        className={`w-full text-left px-4 py-3 border-l-2 transition-colors ${active ? 'border-[#E8D200] bg-[#FFFDF0]' : 'border-transparent hover:bg-[#FAFAF8]'}`}
                                    >
                                        <div className="text-sm font-semibold text-[#111] truncate">{t.name}</div>
                                        <div className="text-xs text-[#888] truncate">{t.subject || 'No subject yet'}</div>
                                        <div className="text-[11px] text-[#AAA] mt-0.5">
                                            {t.last_sent_at ? `Sent ${timeAgo(t.last_sent_at)}` : `Edited ${timeAgo(t.updated_at)}`}
                                        </div>
                                    </button>
                                );
                            })}
                            {sortedTemplates.length === 0 && templates !== null && !(draft && !draft.id) && (
                                <div className="px-4 py-6 text-sm text-[#AAA] text-center">No templates yet.</div>
                            )}
                        </div>
                    </section>

                    <section className={card}>
                        <CardHeader icon={History} title="Recent sends" />
                        <div className="divide-y divide-[#F0F0EC] max-h-[38vh] overflow-y-auto">
                            {history.length === 0 && <div className="px-4 py-6 text-sm text-[#AAA] text-center">Nothing sent yet.</div>}
                            {history.map((h) => {
                                const resumable = h.status === 'paused' || (h.status === 'sending' && Date.now() - new Date(h.updated_at).getTime() > 2 * 60_000);
                                const open = openSend === h.id;
                                return (
                                    <div key={h.id} className="px-4 py-3">
                                        <button type="button" onClick={() => setOpenSend(open ? null : h.id)} className="w-full min-w-0 text-left">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-sm font-semibold text-[#111] truncate">{h.template_name}</span>
                                                <StatusBadge status={h.status} />
                                            </div>
                                            <div className="text-xs text-[#888] truncate">{h.subject}</div>
                                            <div className="flex items-center justify-between gap-2 text-[11px] mt-1">
                                                <span className="text-[#B59B00] truncate">→ {audienceLabel(h.audience)}</span>
                                                <span className="text-[#AAA] shrink-0">{h.sent_count}/{h.recipient_count} · {timeAgo(h.created_at)}</span>
                                            </div>
                                        </button>
                                        {(h.failed_count > 0 || h.opted_out_count > 0 || resumable) && (
                                            <div className="flex items-center justify-between gap-2 text-[11px] mt-1">
                                                <span className="text-[#AAA]">
                                                    {h.failed_count ? <span className="text-[#B91C1C]">{h.failed_count} failed</span> : null}
                                                    {h.failed_count && h.opted_out_count ? ' · ' : ''}
                                                    {h.opted_out_count ? `${h.opted_out_count} opted out` : ''}
                                                </span>
                                                {resumable && (
                                                    <button onClick={() => resume(h.id)} disabled={sending} className="font-semibold text-[#8a7600] hover:underline disabled:opacity-40">Resume</button>
                                                )}
                                            </div>
                                        )}
                                        {open && h.failed_count > 0 && (
                                            <div className="mt-2 rounded-lg bg-[#FEF2F2] px-3 py-2 text-xs text-[#991B1B] space-y-1">
                                                {failures.length === 0 ? 'Loading…' : failures.map((f) => (
                                                    <div key={f.email} className="flex gap-2"><span className="font-medium shrink-0">{f.email}</span><span className="text-[#B91C1C]/80 truncate">{f.error}</span></div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                </aside>

                {/* Editor column: one card per step */}
                <div className="space-y-4 min-w-0">
                    {/* 01 Content */}
                    <section className={card}>
                        <CardHeader step="1" title="Content">
                            <button onClick={duplicate} title="Duplicate" className="p-2 rounded-lg border border-[#E6E6E1] text-[#666] hover:border-[#CFCFCF]"><Copy size={14} /></button>
                            <button onClick={deleteTemplate} title="Delete" className="p-2 rounded-lg border border-[#E6E6E1] text-[#666] hover:border-[#F43F5E] hover:text-[#F43F5E]"><Trash2 size={14} /></button>
                            <button
                                onClick={() => saveDraft()}
                                disabled={saving || !dirty}
                                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#111] text-white text-xs font-semibold hover:bg-[#333] disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                <Save size={13} />{saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
                            </button>
                        </CardHeader>
                        <div className="px-5 py-4 space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className={labelClass}>Template name</label>
                                    <input value={draft.name} maxLength={120} onChange={(e) => update({ name: e.target.value })} className={fieldClass} placeholder="e.g. November Series launch" />
                                </div>
                                <div>
                                    <label className={labelClass}>Replies go to</label>
                                    <input value={draft.reply_to} maxLength={320} onChange={(e) => update({ reply_to: e.target.value })} className={fieldClass} placeholder="support@powr.life" />
                                </div>
                            </div>
                            <div>
                                <label className={labelClass}>Subject</label>
                                <input value={draft.subject} maxLength={200} onChange={(e) => update({ subject: e.target.value })} className={fieldClass} placeholder="e.g. {{first_name}}, the Series starts Saturday" />
                            </div>
                            <div>
                                <label className={labelClass}>Preheader <span className="normal-case font-normal text-[#AAA]">— the grey line after the subject in the inbox</span></label>
                                <input value={draft.preheader} maxLength={300} onChange={(e) => update({ preheader: e.target.value })} className={fieldClass} placeholder="One line that makes them open it" />
                            </div>
                            <label className="flex items-center gap-3 cursor-pointer select-none rounded-xl border border-[#F0F0EC] bg-[#FAFAF8] px-4 py-3">
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={draft.use_shell !== false}
                                    onClick={() => update({ use_shell: draft.use_shell === false })}
                                    className={`relative w-10 h-6 shrink-0 rounded-full transition-colors ${draft.use_shell !== false ? 'bg-[#E8D200]' : 'bg-[#DDD]'}`}
                                >
                                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${draft.use_shell !== false ? 'left-[18px]' : 'left-0.5'}`} />
                                </button>
                                <span className="min-w-0">
                                    <span className="block text-sm font-medium text-[#111]">POWR shell</span>
                                    <span className="block text-xs text-[#999]">Logo header and footer with the unsubscribe link around your HTML. Off = your HTML is sent exactly as written.</span>
                                </span>
                            </label>
                        </div>
                    </section>

                    {/* 02 HTML */}
                    <section className={card}>
                        <CardHeader step="2" title="Body">
                            <div className="flex gap-1 p-1 rounded-lg bg-[#F4F4F1]">
                                <Tab value="html" icon={Code2}>HTML</Tab>
                                <Tab value="text" icon={FileText}>Plain text</Tab>
                            </div>
                        </CardHeader>
                        <div className="px-5 py-4 space-y-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-[11px] text-[#999] mr-1">Insert</span>
                                {MERGE_TAGS.map((m) => (
                                    <button
                                        key={m.tag}
                                        type="button"
                                        title={m.hint}
                                        onClick={() => insertTag(m.tag)}
                                        className="px-2 py-1 rounded-md border border-[#E6E6E1] bg-white text-[11px] font-mono text-[#555] hover:border-[#E8D200] hover:text-[#111]"
                                    >
                                        {`{{${m.tag}}}`}
                                    </button>
                                ))}
                            </div>
                            {tab === 'text' && (
                                <div className="flex items-center justify-between gap-3 text-xs text-[#999]">
                                    <span>Sent alongside the HTML for clients that only show text. Blank = generated from the HTML when you save.</span>
                                    <button type="button" onClick={() => update({ text: htmlToText(draft.html) })} className="flex items-center gap-1 text-[#666] hover:text-[#111] shrink-0">
                                        <RefreshCw size={12} /> Regenerate from HTML
                                    </button>
                                </div>
                            )}
                            {embedded.count > 0 && (
                                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#F3E4A3] bg-[#FFFBE6] px-4 py-3">
                                    <div className="flex items-start gap-2 text-xs text-[#7A6400]">
                                        <ImageUp size={14} className="mt-0.5 shrink-0" />
                                        <span>
                                            <span className="font-semibold">{embedded.count} image{embedded.count === 1 ? '' : 's'} embedded as base64 ({formatKB(embedded.bytes)}).</span>{' '}
                                            Gmail hides base64 images and clips the email. Upload them to POWR storage and the HTML links to them instead.
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={extractImages}
                                        disabled={extracting}
                                        className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#111] text-white text-xs font-semibold hover:bg-[#333] disabled:opacity-40 shrink-0"
                                    >
                                        {extracting ? <Loader2 size={13} className="animate-spin" /> : <ImageUp size={13} />}
                                        {extracting ? 'Uploading…' : 'Upload images & link them'}
                                    </button>
                                </div>
                            )}
                            <textarea
                                ref={editorRef}
                                value={editorValue}
                                onChange={(e) => update({ [editorField]: e.target.value })}
                                onKeyDown={onEditorKeyDown}
                                spellCheck={false}
                                className="w-full min-h-[440px] rounded-xl border border-[#E6E6E1] bg-[#0F0F0F] text-[#E6E6E1] px-4 py-3 font-mono text-[12.5px] leading-relaxed resize-y focus:outline-none focus:border-[#E8D200]"
                                placeholder={tab === 'text' ? 'Plain-text version…' : '<p>Your HTML…</p>'}
                            />
                            <div className="flex items-center justify-between gap-3 text-[11px] text-[#AAA]">
                                <span>{tab === 'html' ? 'Inline styles travel best. Scripts are removed before sending.' : ''}</span>
                                <span className="shrink-0">
                                    {editorValue.length.toLocaleString()} chars
                                    {tab === 'html' && renderedKB && (
                                        <span className={overClip ? 'text-[#B45309] font-semibold' : ''}> · renders to {renderedKB}{overClip ? ' (Gmail clips over 102 KB)' : ''}</span>
                                    )}
                                </span>
                            </div>
                            {shownWarnings.length > 0 && (
                                <div className="rounded-xl border border-[#F3E4A3] bg-[#FFFBE6] px-4 py-3 space-y-1">
                                    {shownWarnings.map((w) => (
                                        <div key={w} className="flex items-start gap-2 text-xs text-[#7A6400]">
                                            <AlertTriangle size={13} className="mt-0.5 shrink-0" />{w}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </section>

                    {/* 03 Test */}
                    <section className={card}>
                        <CardHeader step="3" title="Test">
                            <span className="text-[11px] text-[#AAA] truncate">Any address · your own merge data · subject prefixed [TEST]</span>
                        </CardHeader>
                        <div className="px-5 py-4">
                            <div className="flex flex-wrap items-center gap-2">
                                <FlaskConical size={15} className="text-[#999]" />
                                <input value={testTo} onChange={(e) => setTestTo(e.target.value)} list="email-test-recent" type="email" className="w-72 rounded-lg border border-[#E6E6E1] bg-[#FAFAF8] px-3 py-2 text-sm text-[#111] focus:outline-none focus:border-[#E8D200]" placeholder="any email address" />
                                <datalist id="email-test-recent">
                                    {recentTests.map((e) => <option key={e} value={e} />)}
                                </datalist>
                                <button
                                    onClick={sendTest}
                                    disabled={testing || Boolean(testBlocker)}
                                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#E6E6E1] bg-white text-sm font-medium text-[#333] hover:border-[#CFCFCF] disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                                    {testing ? 'Sending…' : 'Send test'}
                                </button>
                                {testBlocker && <span className="text-[11px] font-medium text-[#8a7600]">{testBlocker}</span>}
                            </div>
                            {recentTests.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1.5 mt-3 text-[11px] text-[#999]">
                                    <span>Recent</span>
                                    {recentTests.map((e) => (
                                        <button key={e} type="button" onClick={() => setTestTo(e)} className="rounded-full border border-[#E6E6E1] bg-[#FAFAF8] px-2 py-0.5 text-[#555] hover:border-[#CFCFCF]">{e}</button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </section>

                    {/* 04 Send */}
                    <section className={card}>
                        <CardHeader step="4" title="Send">
                            <span className="text-[11px] text-[#AAA] truncate">{draft.name || 'this template'}</span>
                        </CardHeader>
                        <div className="px-5 py-4">
                            <AudienceSelector onChange={onAudienceChange} counter={emailCounter} devices={false} noun={(n) => (n === 1 ? 'person' : 'people')} />
                            {audienceStats && (audienceStats.opted_out > 0) && (
                                <div className="text-xs text-[#999] mt-1 ml-6">
                                    {audienceStats.opted_out} turned Product news off and won&apos;t get this.
                                </div>
                            )}

                            {progress && (
                                <div className="mt-4 rounded-xl bg-[#111] p-4 text-sm">
                                    <div className="flex items-center justify-between text-white">
                                        <span className="flex items-center gap-2">
                                            {sending ? <Loader2 size={14} className="animate-spin text-[#E8D200]" /> : <Check size={14} className="text-[#E8D200]" />}
                                            {sending ? 'Sending…' : progress.done ? 'Done' : 'Paused'}
                                        </span>
                                        <span className="text-[#BBB]">{progress.sent} sent · {progress.failed} failed · {progress.queued} to go</span>
                                    </div>
                                    <div className="h-1.5 rounded-full bg-[#2a2a2a] mt-3 overflow-hidden">
                                        <div className="h-full bg-[#E8D200] transition-all" style={{ width: `${progress.recipients ? Math.round(((progress.sent + progress.failed) / progress.recipients) * 100) : 0}%` }} />
                                    </div>
                                </div>
                            )}

                            <div className="flex items-center justify-between gap-3 mt-4 pt-4 border-t border-[#F0F0EC]">
                                <span className={`text-xs ${sendBlocker ? 'text-[#8a7600] font-medium' : 'text-[#999]'}`}>{sendBlocker ?? `Sends "${draft.subject}" to ${audienceLabel(audience)}.`}</span>
                                <button
                                    onClick={() => setConfirm(true)}
                                    disabled={!canSend}
                                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#E8D200] text-[#080808] text-sm font-semibold hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                                >
                                    <Send size={15} />{sending ? 'Sending…' : 'Send email'}
                                </button>
                            </div>
                        </div>
                    </section>
                </div>

                {/* Preview: pinned while the editor scrolls */}
                <section className={`${card} min-[1280px]:sticky min-[1280px]:top-20`}>
                    <CardHeader icon={Monitor} title={<span className="flex items-center gap-2">Preview {rendering && <Loader2 size={12} className="animate-spin text-[#BBB]" />}</span>}>
                        <div className="flex gap-1 p-1 rounded-lg bg-[#F4F4F1]">
                            {[['desktop', Monitor], ['mobile', Smartphone]].map(([v, Icon]) => (
                                <button
                                    key={v}
                                    type="button"
                                    onClick={() => setPreviewWidth(v)}
                                    className={`p-1.5 rounded-md transition-colors ${previewWidth === v ? 'bg-white text-[#111] shadow-sm' : 'text-[#999] hover:text-[#333]'}`}
                                    title={v === 'desktop' ? 'Desktop' : 'Phone'}
                                >
                                    <Icon size={14} />
                                </button>
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={() => setGmailDark((v) => !v)}
                            aria-pressed={gmailDark}
                            title="Show the email the way Gmail on iPhone shows it in dark mode (approximate)"
                            className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs font-medium transition-colors ${gmailDark ? 'bg-[#111] border-[#111] text-[#E8D200]' : 'bg-white border-[#E6E6E1] text-[#666] hover:border-[#CFCFCF]'}`}
                        >
                            <Moon size={13} /> Gmail dark
                        </button>
                    </CardHeader>
                    {/* Inbox row */}
                    <div className="px-4 py-3 border-b border-[#F0F0EC] bg-[#FAFAF8]">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-[#111] text-[#E8D200] flex items-center justify-center text-xs font-black">P</div>
                            <div className="min-w-0">
                                <div className="text-xs text-[#666]">POWR <span className="text-[#AAA]">&lt;hello@powr.life&gt;</span></div>
                                <div className="text-sm font-semibold text-[#111] truncate">{preview?.subject || draft.subject || 'Subject'}</div>
                                <div className="text-xs text-[#888] truncate">{draft.preheader || 'Preheader shows here'}</div>
                            </div>
                        </div>
                        <div className="text-[11px] text-[#AAA] mt-2">
                            {gmailDark
                                ? 'Approximately how Gmail on iPhone shows this in dark mode. Blocks that hold only an image keep their colour; everything else is recoloured.'
                                : preview?.rendered_for === 'you' ? 'Merge tags filled with your own data' : 'Merge tags filled with sample data'}
                        </div>
                    </div>
                    <div className="bg-[#EDEDEA] p-3 flex justify-center">
                        {previewError ? (
                            <div className="w-full rounded-xl bg-white px-4 py-8 text-center text-sm text-[#B45309]">
                                <AlertTriangle size={18} className="mx-auto mb-2" />
                                Preview unavailable: {previewError}
                            </div>
                        ) : (
                            <iframe
                                title="Email preview"
                                sandbox=""
                                srcDoc={`${preview?.html ?? '<p style="font-family:Arial;color:#999;padding:24px;">Rendering…</p>'}${gmailDark ? GMAIL_DARK_CSS : ''}`}
                                style={{ width: previewWidth === 'mobile' ? 375 : '100%', height: 'max(520px, calc(100vh - 300px))', border: 0, background: '#fff', borderRadius: 12, transition: 'width .2s', filter: gmailDark ? GMAIL_DARK_FILTER : 'none' }}
                            />
                        )}
                    </div>
                </section>
            </div>

            {confirm && (
                <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40 px-4" onClick={() => setConfirm(false)}>
                    <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2 mb-2">
                            <AlertTriangle size={18} className="text-[#E8D200]" />
                            <h3 className="text-base font-bold text-[#111]">Send this email?</h3>
                        </div>
                        <p className="text-sm text-[#666] mb-5">
                            Emails <span className="font-semibold text-[#111]">&ldquo;{draft.subject}&rdquo;</span> to{' '}
                            <span className="font-semibold text-[#111]">{audienceLabel(audience)}</span>
                            {audienceCount != null && <> — {audienceCount} {audienceCount === 1 ? 'person' : 'people'}</>}. This can&apos;t be undone.
                        </p>
                        <div className="flex gap-2 justify-end">
                            <button onClick={() => setConfirm(false)} className="px-4 py-2 rounded-xl text-sm text-[#666] hover:bg-[#F4F4F1]">Cancel</button>
                            <button onClick={send} className="px-4 py-2 rounded-xl bg-[#E8D200] text-[#080808] text-sm font-semibold hover:brightness-95">Send now</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
