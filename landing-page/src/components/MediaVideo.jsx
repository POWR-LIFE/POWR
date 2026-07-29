import React, { useEffect, useRef } from 'react';

// <video> that also plays HLS (.m3u8) everywhere. Playlist URLs lazy-load
// hls.js (MSE) with native playback as the fallback for iOS Safari, which
// has no MSE but plays HLS natively — that order matters: desktop Chrome
// answers "maybe" to canPlayType('application/vnd.apple.mpegurl') yet
// can't actually play it, so hls.js must be first choice. mp4/webm render
// dependency-free. Used by the public event promo page and the admin
// promo-media preview, so both agree on what "a working video URL" is.

const HLS_EXT = /\.m3u8(\?|#|$)/i;

export default function MediaVideo({ src, ...rest }) {
    const ref = useRef(null);

    useEffect(() => {
        const video = ref.current;
        if (!video || !src) return;
        if (!HLS_EXT.test(src)) {
            video.src = src;
            return;
        }
        let hls;
        let cancelled = false;
        import('hls.js')
            .then(({ default: Hls }) => {
                if (cancelled || !ref.current) return;
                if (Hls.isSupported()) {
                    // Ensure we're not trying to play a previous non-MSE src.
                    video.removeAttribute('src');
                    video.load();
                    hls = new Hls({ enableWorker: true });
                    hls.attachMedia(video);
                    hls.loadSource(src);
                } else {
                    video.src = src;
                }
            })
            .catch(() => {
                if (cancelled || !ref.current) return;
                video.src = src;
            });
        return () => {
            cancelled = true;
            hls?.destroy();
            video.removeAttribute('src');
            video.load();
        };
    }, [src]);

    return <video ref={ref} {...rest} />;
}
