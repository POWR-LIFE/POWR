/**
 * Video export: decode the clip frame by frame, run every frame through the
 * same renderPost() the preview uses, and encode the canvas to an H.264 MP4 —
 * all in the browser (WebCodecs via mediabunny), no render server.
 *
 * mediabunny is imported on demand so the public site's bundle never carries it.
 */
import { FORMATS } from './formats';
import { renderPost } from './render';

export const EXPORT_FPS = 30;
export const MAX_CLIP_SECONDS = 60;

/**
 * Render `media` (a loaded video, see media.js) over [start, end) seconds.
 * `cache` should be the preview's render cache, so the export's legibility
 * shading matches what was on screen. Resolves with an MP4 Blob.
 */
export async function exportVideo({
    media, template, format, fields, style, look, focal, zoom, assets,
    start = 0, end, keepAudio = false, cache = {}, onProgress, signal,
}) {
    const mb = await import('mediabunny');
    const F = FORMATS[format];
    const clipEnd = Math.min(end ?? media.duration, start + MAX_CLIP_SECONDS);

    if (!(await mb.canEncodeVideo('avc', { width: F.w, height: F.h, frameRate: EXPORT_FPS }))) {
        throw new Error('This browser can’t encode H.264 video — use Chrome or Safari on a Mac.');
    }

    const blob = media.blob ?? await (await fetch(media.url)).blob();
    const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
    const output = new mb.Output({
        format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }),
        target: new mb.BufferTarget(),
    });
    try {
        const track = await input.getPrimaryVideoTrack();
        if (!track || !(await track.canDecode())) {
            throw new Error('This browser can’t decode that video — export it from your phone as MP4 (H.264).');
        }

        const canvas = document.createElement('canvas');
        canvas.width = F.w;
        canvas.height = F.h;
        // ~0.22 bits per pixel: ≈14 Mbps for a story, ≈10 for a post — a clean
        // master for Instagram/TikTok, which re-encode to 3–6 Mbps anyway.
        // (Moving grain is noise the encoder can't predict; "high" quality
        // spent 35–40 Mbps on it.)
        const bitrate = Math.round(0.22 * F.w * F.h * EXPORT_FPS);
        const videoSource = new mb.CanvasSource(canvas, {
            codec: 'avc',
            quality: new mb.Quality({ bitrate, bitrateMode: 'variable' }),
        });
        output.addVideoTrack(videoSource, { frameRate: EXPORT_FPS });

        let audio = null;
        if (keepAudio) {
            const aTrack = await input.getPrimaryAudioTrack();
            if (aTrack && (await aTrack.canDecode()) && (await mb.canEncodeAudio('aac'))) {
                audio = { track: aTrack, source: new mb.AudioSampleSource({ codec: 'aac', quality: new mb.Quality('high') }) };
                output.addAudioTrack(audio.source);
            }
        }

        await output.start();

        // One output frame every 1/30 s; the sink hands back whichever source
        // frame is showing at that moment, so 24/25/60 fps clips all land on 30.
        const frames = Math.max(1, Math.round((clipEnd - start) * EXPORT_FPS));
        const times = Array.from({ length: frames }, (_, i) => start + i / EXPORT_FPS);
        const sink = new mb.CanvasSink(track, { poolSize: 2 });
        let i = 0;
        let last = null;
        for await (const frame of sink.canvasesAtTimestamps(times)) {
            if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
            const src = frame?.canvas ?? last;
            if (src) {
                last = src;
                renderPost(canvas, {
                    template, format, fields, style, look, focal, zoom, assets, cache,
                    media: { ...media, source: src, width: src.width, height: src.height },
                    scale: 1,
                    seed: i + 1, // grain moves every frame, like film
                });
            }
            await videoSource.add(i / EXPORT_FPS, 1 / EXPORT_FPS);
            i++;
            onProgress?.((i / frames) * (audio ? 0.94 : 1));
        }

        if (audio) {
            const aSink = new mb.AudioSampleSink(audio.track);
            for await (const sample of aSink.samples(start, clipEnd)) {
                if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
                sample.setTimestamp(Math.max(0, sample.timestamp - start));
                await audio.source.add(sample);
                sample.close();
            }
        }

        await output.finalize();
        onProgress?.(1);
        return new Blob([output.target.buffer], { type: 'video/mp4' });
    } catch (e) {
        if (output.state === 'started') await output.cancel().catch(() => {});
        throw e;
    } finally {
        input.dispose();
    }
}
