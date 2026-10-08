import React from 'react';
import { Bug, Siren, Sparkles, TrendingUp, SquareCheckBig, Wrench, Microscope, Apple, Smartphone, Globe } from 'lucide-react';
import { typeOf, priorityOf, statusOf, resolutionLabel } from './model';
import { surfaceOf, areaOf } from './taxonomy';

const TYPE_ICONS = {
    bug: Bug, incident: Siren, feature: Sparkles, improvement: TrendingUp,
    task: SquareCheckBig, debt: Wrench, investigation: Microscope,
};

export function TypeIcon({ type, size = 14 }) {
    const Icon = TYPE_ICONS[type] ?? Bug;
    return <Icon size={size} style={{ color: typeOf(type).color }} aria-label={typeOf(type).label} />;
}

export function PriorityBadge({ value, withName = false }) {
    const p = priorityOf(value);
    return (
        <span
            title={`${p.label} · ${p.name} — ${p.hint}`}
            className="inline-flex items-center gap-1 h-5 px-2 rounded-full text-[9px] font-black tracking-[0.15em] border"
            style={{ color: p.color, borderColor: `${p.color}55`, background: `${p.color}12` }}
        >
            {p.label}{withName ? ` · ${p.name.toUpperCase()}` : ''}
        </span>
    );
}

export function StatusPill({ status, resolution }) {
    const s = statusOf(status);
    const label = status === 'closed' ? `Closed · ${resolutionLabel(resolution)}` : s.label;
    return (
        <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full border border-[#E6E6E1] bg-white text-[9px] font-black uppercase tracking-[0.2em] text-[#444444]">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
            {label}
        </span>
    );
}

export function PlaceChip({ issue, short = false }) {
    const s = surfaceOf(issue.surface);
    const a = areaOf(issue.surface, issue.area);
    return (
        <span className="inline-flex items-center gap-1.5 min-w-0 max-w-full text-[10px] font-bold text-[#555555]">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s?.color ?? '#AAAAAA' }} />
            <span className="truncate">
                <span style={{ color: s?.ink ?? '#555555' }}>{short ? (s?.short ?? issue.surface) : (s?.label ?? issue.surface)}</span>
                {a ? <span className="text-[#888888]"> › {a.label}</span> : null}
                {!short && issue.feature ? <span className="text-[#AAAAAA]"> › {issue.feature}</span> : null}
            </span>
        </span>
    );
}

const PLATFORM_ICONS = { ios: Apple, android: Smartphone, web: Globe };

export function PlatformIcons({ platforms = [], size = 11 }) {
    if (!platforms?.length) return null;
    return (
        <span className="inline-flex items-center gap-1 text-[#999999]">
            {platforms.map(p => {
                const Icon = PLATFORM_ICONS[p];
                return Icon ? <Icon key={p} size={size} aria-label={p} /> : null;
            })}
        </span>
    );
}

export function Avatar({ person, size = 22 }) {
    if (!person) {
        return <span className="inline-block rounded-full border border-dashed border-[#CCCCCC]" style={{ width: size, height: size }} title="Unassigned" />;
    }
    const initials = (person.name ?? '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return person.avatar_url ? (
        <img src={person.avatar_url} alt={person.name} title={person.name} className="rounded-full object-cover bg-[#EFEFEC]" style={{ width: size, height: size }} />
    ) : (
        <span title={person.name} className="inline-flex items-center justify-center rounded-full bg-[#E8D200] text-[#080808] font-black" style={{ width: size, height: size, fontSize: Math.max(8, size * 0.38) }}>
            {initials}
        </span>
    );
}

export const Label = ({ children, className = '' }) => (
    <div className={`text-[9px] uppercase tracking-[0.35em] text-[#999999] font-black ${className}`}>{children}</div>
);

export function SectionTitle({ children, right }) {
    return (
        <div className="flex items-center justify-between gap-4 mb-3">
            <div className="text-[10px] uppercase tracking-[0.4em] text-[#888888] font-black">{children}</div>
            {right}
        </div>
    );
}

export const inputClass = 'w-full h-10 bg-white border border-[#E6E6E1] rounded-xl px-3 text-[13px] text-[#1A1A1A] placeholder-[#BBBBBB] focus:border-[#E8D200] outline-none transition-colors';
export const selectClass = 'h-10 bg-white border border-[#E6E6E1] rounded-xl px-3 text-[12px] text-[#1A1A1A] focus:border-[#E8D200] outline-none';

export function Chip({ active, onClick, children, color, title }) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            aria-pressed={!!active}
            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[10px] font-black uppercase tracking-[0.15em] transition-all whitespace-nowrap ${
                active ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-white border-[#E6E6E1] text-[#666666] hover:border-[#BBBBBB]'
            }`}
        >
            {color ? <span className="w-2 h-2 rounded-full" style={{ background: color }} /> : null}
            {children}
        </button>
    );
}

// ── Markdown, the small subset people type in descriptions and comments ────
// Headings, bullets, numbered lists, quotes, **bold**, _italic_, `code`,
// [links](url) and bare URLs. Builds React nodes — never injects HTML.

// _italic_ only at word edges, so snake_case names (push_send_log,
// project_supabase_service_role_leak.md) keep their underscores.
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)]+|(?<!\w)_(?!\s)[^\n]+?(?<!\s)_(?!\w))/g;

function inline(text, keyBase) {
    const out = [];
    let last = 0;
    let m;
    INLINE.lastIndex = 0;
    while ((m = INLINE.exec(text))) {
        if (m.index > last) out.push(text.slice(last, m.index));
        const t = m[0];
        const k = `${keyBase}-${m.index}`;
        if (t.startsWith('**')) out.push(<strong key={k} className="font-bold text-[#1A1A1A]">{t.slice(2, -2)}</strong>);
        else if (t.startsWith('`')) out.push(<code key={k} className="px-1 py-0.5 rounded bg-[#EFEFEC] text-[12px] font-mono">{t.slice(1, -1)}</code>);
        else if (t.startsWith('[')) {
            const [, label, href] = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
            out.push(<a key={k} href={href} target="_blank" rel="noreferrer" className="text-[#0369A1] underline underline-offset-2">{label}</a>);
        } else if (t.startsWith('http')) out.push(<a key={k} href={t} target="_blank" rel="noreferrer" className="text-[#0369A1] underline underline-offset-2 break-all">{t}</a>);
        else out.push(<em key={k}>{t.slice(1, -1)}</em>);
        last = m.index + t.length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
}

export function Markdown({ text, className = '' }) {
    const lines = (text ?? '').replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) { i += 1; continue; }
        if (/^\s*[-*] /.test(line)) {
            const items = [];
            while (i < lines.length && /^\s*[-*] /.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*] /, '')); i += 1; }
            blocks.push(<ul key={i} className="list-disc pl-5 space-y-1">{items.map((t, j) => <li key={j}>{inline(t, `${i}-${j}`)}</li>)}</ul>);
            continue;
        }
        if (/^\s*\d+[.)] /.test(line)) {
            const items = [];
            while (i < lines.length && /^\s*\d+[.)] /.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)] /, '')); i += 1; }
            blocks.push(<ol key={i} className="list-decimal pl-5 space-y-1">{items.map((t, j) => <li key={j}>{inline(t, `${i}-${j}`)}</li>)}</ol>);
            continue;
        }
        if (/^> ?/.test(line)) {
            const quote = [];
            while (i < lines.length && /^> ?/.test(lines[i])) { quote.push(lines[i].replace(/^> ?/, '')); i += 1; }
            blocks.push(<blockquote key={i} className="border-l-2 border-[#E8D200] pl-4 text-[#666666] whitespace-pre-wrap">{inline(quote.join('\n'), `q${i}`)}</blockquote>);
            continue;
        }
        const h = line.match(/^(#{1,3}) (.*)$/);
        if (h) {
            blocks.push(<div key={i} className={`font-bold text-[#1A1A1A] ${h[1].length === 1 ? 'text-[16px]' : 'text-[14px]'}`}>{inline(h[2], `h${i}`)}</div>);
            i += 1;
            continue;
        }
        const para = [];
        while (i < lines.length && lines[i].trim() && !/^\s*([-*]|\d+[.)]) |^> ?|^#{1,3} /.test(lines[i])) { para.push(lines[i]); i += 1; }
        blocks.push(<p key={i} className="whitespace-pre-wrap">{inline(para.join('\n'), `p${i}`)}</p>);
    }
    return <div className={`space-y-3 text-[13px] leading-relaxed text-[#333333] ${className}`}>{blocks}</div>;
}
