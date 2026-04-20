import { supabase } from './supabase';

const CODE_REGEX = /^POWR-[A-Z0-9]{4}-[A-Z0-9]{6}$/;

export function normalise(code) {
    return (code || '').trim().toUpperCase();
}

export function isValidFormat(code) {
    return CODE_REGEX.test(code);
}

// Parses raw text (CSV / pasted list / single code) into a clean array of unique codes.
export function parseCodes(raw) {
    if (!raw) return [];
    const lines = raw
        .split(/[\s,;\n\r]+/)
        .map(normalise)
        .filter(Boolean);
    return Array.from(new Set(lines));
}

// Uploads codes for a reward. Validates format + partner prefix.
// Returns { accepted, rejected: [{code, reason}] }.
export async function uploadCodes({ rewardId, codes, expiresAt }) {
    if (!rewardId) throw new Error('rewardId required');
    if (!codes?.length) return { accepted: 0, rejected: [] };

    const { data: reward, error: rErr } = await supabase
        .from('rewards')
        .select('id, partner_id, code_expiry_days, partners(partner_code)')
        .eq('id', rewardId)
        .single();
    if (rErr || !reward) throw new Error('Reward not found');

    const partnerCode = reward.partners?.partner_code;
    if (!partnerCode) throw new Error('Partner has no partner_code set');

    const prefix = `POWR-${partnerCode}-`;
    const expiry = expiresAt
        ? new Date(expiresAt).toISOString()
        : new Date(Date.now() + (reward.code_expiry_days || 90) * 86400_000).toISOString();

    const rejected = [];
    const accepted = [];
    const seen = new Set();

    for (const raw of codes) {
        const code = normalise(raw);
        if (!code) continue;
        if (seen.has(code)) { rejected.push({ code, reason: 'duplicate_in_batch' }); continue; }
        seen.add(code);
        if (!isValidFormat(code)) { rejected.push({ code, reason: 'invalid_format' }); continue; }
        if (!code.startsWith(prefix)) { rejected.push({ code, reason: 'wrong_partner_prefix' }); continue; }
        accepted.push({
            reward_id: rewardId,
            code,
            source: 'PARTNER_UPLOAD',
            status: 'available',
            expires_at: expiry,
        });
    }

    if (accepted.length === 0) return { accepted: 0, rejected };

    // Insert in chunks; on unique violation mark as rejected.
    const chunkSize = 500;
    let insertedCount = 0;
    for (let i = 0; i < accepted.length; i += chunkSize) {
        const chunk = accepted.slice(i, i + chunkSize);
        const { data, error } = await supabase
            .from('redemption_codes')
            .insert(chunk)
            .select('code');
        if (error) {
            // On batch failure fall back to per-row inserts to surface precise rejects.
            for (const row of chunk) {
                const { error: rowErr } = await supabase.from('redemption_codes').insert(row);
                if (rowErr) {
                    rejected.push({ code: row.code, reason: rowErr.code === '23505' ? 'already_exists' : 'insert_failed' });
                } else {
                    insertedCount += 1;
                }
            }
        } else {
            insertedCount += data?.length ?? chunk.length;
        }
    }

    return { accepted: insertedCount, rejected };
}

export async function fetchCodeStats(rewardId) {
    const { data, error } = await supabase
        .from('redemption_codes')
        .select('status')
        .eq('reward_id', rewardId);
    if (error) throw error;
    const stats = { available: 0, reserved: 0, used: 0, expired: 0, total: (data ?? []).length };
    for (const row of data ?? []) stats[row.status] = (stats[row.status] ?? 0) + 1;
    return stats;
}
