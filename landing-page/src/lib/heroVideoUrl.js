// Shared validation for the reward hero *background video* URL field — used by
// the admin RewardManager and both partner surfaces (PartnerRewards +
// PartnerRewardSubmit) so the rules stay identical everywhere.
//
// A hero video must be a *direct* video file that the app's native player
// (expo-video → AVPlayer/ExoPlayer) and the panels' <video> preview can load
// straight from the URL. Streaming-site links (YouTube/Vimeo/TikTok…) are web
// pages, not files — they only play through each site's own iframe embed, which
// can't be a muted, looping, chrome-less card background and has no still frame
// for the share card. So we reject those hosts and point to what does work.
// (new URL() is fine here: this is the browser admin/portal over http(s), not
// the RN custom-scheme case that string-slicing is reserved for.)

const VIDEO_STREAMING_HOSTS = [
    'youtube.com', 'youtu.be', 'youtube-nocookie.com',
    'vimeo.com', 'tiktok.com', 'instagram.com', 'facebook.com', 'fb.watch',
    'dailymotion.com', 'dai.ly', 'twitch.tv', 'x.com', 'twitter.com',
];
const DIRECT_VIDEO_EXT = /\.(mp4|m3u8|webm|mov)(\?|#|$)/i;

// Returns { value } for an accepted (or empty) URL — value is the cleaned string
// to store (empty string if blank), optionally with a soft `warn` — or { error }
// for one we won't accept.
export function validateHeroVideoUrl(raw) {
    const url = (raw || '').trim();
    if (!url) return { value: '' };
    let parsed;
    try { parsed = new URL(url); } catch { return { error: 'Enter a full URL starting with https://' }; }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return { error: 'Enter a full URL starting with https://' };
    }
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (VIDEO_STREAMING_HOSTS.some(h => host === h || host.endsWith('.' + h))) {
        return { error: "That's a YouTube/Vimeo-style page link, which can't be a card background. Upload the file, or paste a direct .mp4/.m3u8 link (e.g. Cloudflare Stream)." };
    }
    const looksLikeFile = DIRECT_VIDEO_EXT.test(parsed.pathname) || DIRECT_VIDEO_EXT.test(url);
    return {
        value: url,
        warn: looksLikeFile ? null : "Saved — but that link doesn't end in .mp4/.m3u8/.webm. If it's a web page rather than a direct video file, the card will just show the image.",
    };
}
