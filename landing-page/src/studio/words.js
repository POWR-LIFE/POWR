/**
 * Small wording helpers shared by the data fills and the templates' fill
 * functions: line breaks and number formats, never layout.
 */

/** Split a name over two lines near its middle ("Road to\nFriday Finals"). */
export function twoLines(text, max = 11) {
    const t = String(text ?? '').trim();
    if (t.length <= max || !t.includes(' ')) return t;
    const words = t.split(/\s+/);
    let best = null;
    for (let i = 1; i < words.length; i++) {
        const a = words.slice(0, i).join(' ');
        const b = words.slice(i).join(' ');
        const score = Math.max(a.length, b.length);
        if (!best || score < best.score) best = { score, text: `${a}\n${b}` };
    }
    return best.text;
}

/** Break running text into lines of about `width` characters (at most `max` lines). */
export function wrap(text, width = 30, max = 3) {
    const words = String(text ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const lines = [];
    let line = '';
    for (const w of words) {
        if (line && `${line} ${w}`.length > width) {
            lines.push(line);
            line = w;
        } else {
            line = line ? `${line} ${w}` : w;
        }
    }
    if (line) lines.push(line);
    if (lines.length > max) {
        const kept = lines.slice(0, max);
        kept[max - 1] = `${kept[max - 1].replace(/[\s,.;:–—-]+$/, '')}…`;
        return kept.join('\n');
    }
    return lines.join('\n');
}

/** Wrap each line of a caption on its own, so a list and the blank lines around it survive. */
export const wrapParagraphs = (text, width = 90) =>
    String(text ?? '').split('\n').map((line) => (line.trim() ? wrap(line, width, 40) : '')).join('\n');

/** 1240 → "1,240". */
export const thousands = (n) => Number(n ?? 0).toLocaleString('en-GB');

/** "dessert built different" → "Dessert Built Different". */
export const titleCase = (s) => String(s ?? '').replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
