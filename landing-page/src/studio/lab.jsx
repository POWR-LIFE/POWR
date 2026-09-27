/**
 * Dev harness — see studio-lab.html. `?ui` mounts the editor (`?pack` the
 * pack builder) without admin
 * auth; `window.__studio.render(spec)` returns a PNG data URL for one post,
 * using the local test photos in public/studio-samples/ (gitignored).
 */
import '../../style.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import StudioEditor from './StudioEditor';
import PackBuilder from './PackBuilder';
import { prepareStudio, renderPost } from './render';
import { templateById } from './templates';
import { loadMedia } from './media';
import { loadAsset } from './assets';
import { exportVideo } from './video';

const photos = new Map();
const photo = (name) => {
    if (!photos.has(name)) photos.set(name, loadMedia(`/studio-samples/${name}`));
    return photos.get(name);
};

window.__studio = {
    async ready() {
        return prepareStudio();
    },
    async render({ template, format = 'post', photo: name, fields, style, look, focal, zoom, scale = 1, assets: assetUrls = {} }) {
        await prepareStudio();
        const media = name ? await photo(name) : null;
        const assets = {};
        for (const [k, url] of Object.entries(assetUrls)) assets[k] = await loadAsset(await (await fetch(url)).blob());
        const canvas = document.createElement('canvas');
        const t0 = performance.now();
        const info = renderPost(canvas, { template: templateById(template), format, media, fields, style, look, focal, zoom, scale, assets });
        const ms = performance.now() - t0;
        return { url: canvas.toDataURL('image/png'), ms, sharp: info.photo?.stats?.sharp, motion: info.photo?.motion };
    },
    // MP4 export of a sample clip; returns a data URL so a script can save it.
    async exportVideo({ template, format = 'story', video, fields, style, look, focal, zoom, start = 0, end, keepAudio = false }) {
        await prepareStudio();
        const media = await loadMedia(`/studio-samples/${video}`);
        const t0 = performance.now();
        const blob = await exportVideo({
            media, template: templateById(template), format, fields, style, look, focal, zoom, start, end, keepAudio,
            onProgress: (p) => { window.__studioProgress = p; },
        });
        const ms = performance.now() - t0;
        const url = await new Promise((resolve) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.readAsDataURL(blob);
        });
        return { url, ms, size: blob.size };
    },
};

if (new URLSearchParams(window.location.search).has('pack')) {
    ReactDOM.createRoot(document.getElementById('root')).render(
        <div className="max-w-[1600px] px-8 py-8">
            <PackBuilder partnerId={new URLSearchParams(window.location.search).get('partner')} />
        </div>,
    );
}

if (new URLSearchParams(window.location.search).has('ui')) {
    ReactDOM.createRoot(document.getElementById('root')).render(
        <div className="max-w-[1600px] px-8 py-8">
            <StudioEditor />
        </div>,
    );
}
