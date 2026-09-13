import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { boundsOf, clusterNodes, nodeLabel, rankGyms } from '../../../shared/gymLeague.ts';

/**
 * The Gym League's network map — a real basemap (CARTO Dark Matter vector
 * tiles via MapLibre; © OpenStreetMap contributors, © CARTO) with the league
 * on top: discs that merge into counted clusters when they'd overlap, rank
 * or place labels, a dashed local-radius ring around the host, gold arcs to
 * the three strongest rivals, and a ripple wherever a session just landed.
 *
 * The gyms are ordinary DOM positioned on every render frame, so CSS runs
 * the host's pulse and the ripples, and clusterNodes() — the same pure
 * helper the tests cover — decides what merges at the current zoom. The
 * map never takes input; the lens change drives fitBounds.
 *
 * Loaded lazily by GymLeague.jsx so the marketing bundle never carries it.
 */

const STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const GOLD = '#facc15';
const MAX_ZOOM = 13.2;
const DASH_FRAMES = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];

const fmt = (n) => Math.round(n).toLocaleString('en-GB');
const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

// A quadratic curve between two points, in lng/lat, bowing to one side.
function arcCoords(a, b, steps = 32) {
    const kx = Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180) || 1;
    const dx = (b.lng - a.lng) * kx;
    const dy = b.lat - a.lat;
    const c = { lng: (a.lng + b.lng) / 2 - (dy * 0.18) / kx, lat: (a.lat + b.lat) / 2 + dx * 0.18 };
    return Array.from({ length: steps + 1 }, (_, i) => {
        const t = i / steps;
        return [
            (1 - t) ** 2 * a.lng + 2 * (1 - t) * t * c.lng + t ** 2 * b.lng,
            (1 - t) ** 2 * a.lat + 2 * (1 - t) * t * c.lat + t ** 2 * b.lat,
        ];
    });
}

function circleCoords(center, km, steps = 96) {
    const dLat = km / 111;
    const dLng = km / (111 * Math.cos((center.lat * Math.PI) / 180));
    return Array.from({ length: steps + 1 }, (_, i) => {
        const a = (i / steps) * Math.PI * 2;
        return [center.lng + Math.cos(a) * dLng, center.lat + Math.sin(a) * dLat];
    });
}

// Tune the basemap to the wall: quieter roads, darker water, no POIs, and
// no more labels than the room can use.
function tuneStyle(map) {
    const style = map.getStyle();
    for (const l of style.layers ?? []) {
        const id = l.id;
        if (id === 'background') map.setPaintProperty(id, 'background-color', '#121212');
        else if (id === 'water' || id === 'waterway') map.setPaintProperty(id, l.type === 'line' ? 'line-color' : 'fill-color', '#050505');
        else if (id === 'water_shadow') map.setLayoutProperty(id, 'visibility', 'none');
        else if (/^(landcover|landuse|park)/.test(id) && l.type === 'fill') map.setPaintProperty(id, 'fill-color', id.includes('park') || id === 'landcover' ? '#161a16' : '#151515');
        else if (l.type === 'symbol' && /poi|housenum|roadname|waterway_label|watername|place_hamlet|place_suburbs|place_villages|place_town|place_country|place_state|place_continent|_dot_/.test(id)) map.setLayoutProperty(id, 'visibility', 'none');
        else if (l.type === 'symbol') {
            // city names help at the country scale; close in, the league's own labels carry it
            map.setLayerZoomRange(id, l.minzoom ?? 0, Math.min(l.maxzoom ?? 24, 9.5));
            map.setPaintProperty(id, 'text-color', '#6a6a6a'); map.setPaintProperty(id, 'text-halo-color', '#0e0e0e'); map.setPaintProperty(id, 'text-halo-width', 1.5);
        }
        else if (id === 'building' || id === 'building-top') map.setPaintProperty(id, 'fill-color', '#181818');
        else if (/_case/.test(id)) map.setLayoutProperty(id, 'visibility', 'none');
        else if (/^(road|bridge|tunnel)_(mot|trunk)/.test(id)) map.setPaintProperty(id, 'line-color', '#2c2c2c');
        else if (/^(road|bridge|tunnel)_(pri|sec)/.test(id)) map.setPaintProperty(id, 'line-color', '#242424');
        else if (/^(road|bridge|tunnel)_(minor|service|path)/.test(id)) map.setPaintProperty(id, 'line-color', '#1c1c1c');
        else if (/^rail/.test(id) || /_rail/.test(id)) map.setPaintProperty(id, 'line-color', '#1f1f1f');
        else if (/^boundary/.test(id)) map.setPaintProperty(id, 'line-color', '#2a2a2a');
    }
}

export default function GymLeagueMap({ scope, gyms, host, hostKey, radiusKm, hits }) {
    const containerRef = useRef(null);
    const mapRef = useRef(null);
    const rootRef = useRef(null);
    const elsRef = useRef(new Map());
    const stateRef = useRef({ scope, gyms, host, hostKey, radiusKm, ranked: [], ripples: [], ready: false });
    const seenHits = useRef(new Set());
    const [failed, setFailed] = useState(false);
    stateRef.current = { ...stateRef.current, scope, gyms, host, hostKey, radiusKm, ranked: rankGyms(gyms) };

    // Boot once.
    useEffect(() => {
        if (!containerRef.current) return undefined;
        let map;
        try {
            map = new maplibregl.Map({
                container: containerRef.current,
                style: STYLE_URL,
                interactive: false,
                attributionControl: false,
                center: [-0.12, 51.5],
                zoom: 9,
                fadeDuration: 0,
            });
        } catch {
            setFailed(true);
            return undefined;
        }
        mapRef.current = map;
        const root = document.createElement('div');
        root.className = 'glm-root';
        map.getCanvasContainer().appendChild(root);
        rootRef.current = root;

        map.on('error', (e) => { if (!stateRef.current.ready) { console.error('league map', e?.error?.message); setFailed(true); } });
        map.on('load', () => {
            tuneStyle(map);
            map.addSource('arcs', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addSource('ring', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({ id: 'ring', type: 'line', source: 'ring', paint: { 'line-color': GOLD, 'line-opacity': 0.28, 'line-width': 1, 'line-dasharray': [2, 3] } });
            map.addLayer({ id: 'arcs', type: 'line', source: 'arcs', paint: { 'line-color': GOLD, 'line-opacity': 0.5, 'line-width': 1.2, 'line-dasharray': DASH_FRAMES[0] } });
            stateRef.current.ready = true;
            fit(map);
            drawShapes(map);
            layout(map);
        });
        map.on('render', () => layout(map));

        // the arcs flow toward the rivals
        let frame = 0;
        const dashTimer = setInterval(() => {
            if (!stateRef.current.ready || !map.getLayer('arcs')) return;
            frame = (frame + 1) % DASH_FRAMES.length;
            map.setPaintProperty('arcs', 'line-dasharray', DASH_FRAMES[frame]);
        }, 90);

        return () => { clearInterval(dashTimer); map.remove(); mapRef.current = null; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Fit the lens; redraw shapes when the league changes.
    const gymSig = gyms.map((g) => `${g.key}:${g.points_week}`).join();
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !stateRef.current.ready) return;
        fit(map);
        drawShapes(map);
    }, [scope, gymSig, host?.key, radiusKm]);

    // A landed session ripples on its gym.
    useEffect(() => {
        const s = stateRef.current;
        for (const [gymKey, h] of Object.entries(hits ?? {})) {
            if (!h?.key || seenHits.current.has(h.key)) continue;
            seenHits.current.add(h.key);
            const g = s.gyms.find((x) => x.key === gymKey);
            if (!g) continue;
            s.ripples.push({ lat: g.lat, lng: g.lng, host: gymKey === s.hostKey, t: performance.now() });
        }
        if (mapRef.current) layout(mapRef.current);
    }, [hits]);

    function fit(map) {
        const s = stateRef.current;
        const list = s.gyms.length ? s.gyms : (s.host ? [s.host] : []);
        if (list.length === 0) return;
        if (list.length === 1) { map.flyTo({ center: [list[0].lng, list[0].lat], zoom: 12, duration: 1400 }); return; }
        const b = boundsOf(list);
        map.fitBounds([[b.w, b.s], [b.e, b.n]], { padding: 28, duration: 1400, maxZoom: MAX_ZOOM });
    }

    function drawShapes(map) {
        const s = stateRef.current;
        if (!map.getSource('arcs')) return;
        const feats = [];
        if (s.host) {
            const rivals = s.ranked.filter((g) => g.key !== s.hostKey && g.points_week > 0).slice(0, 3);
            for (const r of rivals) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: arcCoords(s.host, r) } });
        }
        map.getSource('arcs').setData({ type: 'FeatureCollection', features: feats });
        map.getSource('ring').setData({
            type: 'FeatureCollection',
            features: s.host && s.scope === 'local' ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: circleCoords(s.host, s.radiusKm) } }] : [],
        });
    }

    // Position the gym pins and ripples for the current view.
    function layout(map) {
        const s = stateRef.current;
        const root = rootRef.current;
        if (!root) return;
        const rem = remPx();
        const width = map.getContainer().clientWidth;
        const p = (lat, lng) => { const pt = map.project([lng, lat]); return [pt.x, pt.y]; };
        p.sc = Math.abs(p(51, 0)[1] - p(50, 0)[1]);
        p.kx = 1;
        const wide = map.getZoom() < 7.5;
        // merge only when discs would actually touch; neighbours a street apart stay separate
        const nodes = clusterNodes(s.gyms, p, wide ? 0.9 * rem : 0.8 * rem, rem, s.hostKey);
        const els = elsRef.current;
        const keep = new Set();
        for (const n of nodes) {
            const key = n.gyms.map((g) => g.key).sort().join('+');
            keep.add(key);
            let el = els.get(key);
            if (!el) {
                el = document.createElement('div');
                el.innerHTML = '<i class="disc"></i><span class="lbl"></span>';
                root.appendChild(el);
                els.set(key, el);
            }
            const count = n.gyms.length;
            const lit = n.points > 0;
            el.className = `glm-pin${n.host ? ' host' : lit ? ' lit' : ' quiet'}`;
            const disc = el.firstChild;
            disc.textContent = count > 1 ? String(count) : '';
            disc.style.width = disc.style.height = `${(n.r * 2) / rem}rem`;
            let text = '';
            if (wide) {
                if (lit || n.host) text = `${nodeLabel(n, s.hostKey)} <em>${fmt(n.points)}</em>`;
            } else {
                const rk = s.ranked.indexOf(n.lead) + 1;
                text = count > 1 ? n.gyms.map((g) => s.ranked.indexOf(g) + 1).join(' · ') : `${rk}`;
                if (n.host || rk === 1) text += `  ${n.lead.name}`;
            }
            const lbl = el.lastChild;
            if (lbl.innerHTML !== text) lbl.innerHTML = text;
            const left = n.x > width * 0.62;
            lbl.style.left = left ? 'auto' : `${(n.r + 0.35 * rem) / rem}rem`;
            lbl.style.right = left ? `${(n.r + 0.35 * rem) / rem}rem` : 'auto';
            el.style.transform = `translate(${n.x}px, ${n.y}px)`;
        }
        for (const [key, el] of els) if (!keep.has(key)) { el.remove(); els.delete(key); }
        // labels that would overlap step down, in rank order
        const placed = [];
        for (const n of nodes) {
            const el = els.get(n.gyms.map((g) => g.key).sort().join('+'));
            const lbl = el?.lastChild;
            if (!lbl || !lbl.innerHTML) continue;
            const w = lbl.offsetWidth;
            const left = lbl.style.left === 'auto';
            const x0 = left ? n.x - n.r - 0.35 * rem - w : n.x + n.r + 0.35 * rem;
            let y = n.y;
            for (const o of placed) {
                if (x0 < o.x1 + 0.4 * rem && x0 + w > o.x0 - 0.4 * rem && Math.abs(y - o.y) < 1.0 * rem) y = o.y + 1.0 * rem;
            }
            lbl.style.top = `${y - n.y}px`;
            placed.push({ x0, x1: x0 + w, y });
        }
        const now = performance.now();
        s.ripples = s.ripples.filter((r) => now - r.t < 1700);
        for (const r of s.ripples) {
            if (!r.el) {
                r.el = document.createElement('i');
                r.el.className = `glm-ripple${r.host ? ' host' : ''}`;
                root.appendChild(r.el);
                setTimeout(() => r.el.remove(), 1700);
            }
            const [x, y] = p(r.lat, r.lng);
            r.el.style.transform = `translate(${x}px, ${y}px)`;
        }
    }

    if (failed) return <div className="glm-fallback">Map unavailable</div>;
    return (
        <>
            <style>{CSS}</style>
            <div ref={containerRef} className="glm-map" />
            <div className="glm-attrib">© OpenStreetMap contributors · © CARTO</div>
        </>
    );
}

const CSS = `
.glm-map { position: absolute; inset: 0; border-radius: 0.6rem; overflow: hidden; background: #121212; }
.glm-attrib { position: absolute; right: 0.5rem; bottom: 0.35rem; font: 400 0.52rem Outfit, sans-serif; color: rgba(242,242,242,0.3); pointer-events: none; z-index: 3; }
.glm-fallback { position: absolute; inset: 0; display: grid; place-items: center; color: rgba(242,242,242,0.38); font-size: 0.85rem; border-radius: 0.6rem; background: #121212; }
.glm-root { position: absolute; left: 0; top: 0; pointer-events: none; z-index: 2; }
.glm-pin { position: absolute; left: 0; top: 0; pointer-events: none; will-change: transform; }
.glm-pin .disc { position: absolute; left: 0; top: 0; transform: translate(-50%, -50%); display: grid; place-items: center; border-radius: 50%; box-sizing: border-box;
  font: 700 0.62rem Outfit, sans-serif; color: #0d0d0d; background: rgba(242,242,242,0.78); }
.glm-pin.quiet .disc { background: rgba(242,242,242,0.28); }
.glm-pin.host .disc { background: #facc15; box-shadow: 0 0 0 0.25rem rgba(250,204,21,0.18); animation: glmPulse 2.4s ease-in-out infinite; }
.glm-pin .lbl { position: absolute; top: 0; transform: translateY(-50%); white-space: nowrap; font: 500 0.66rem Outfit, sans-serif; color: rgba(242,242,242,0.72);
  text-shadow: 0 0 3px #0e0e0e, 0 0 3px #0e0e0e, 0 1px 2px #0e0e0e; }
.glm-pin .lbl em { font-style: normal; color: rgba(242,242,242,0.42); margin-left: 0.25rem; font-variant-numeric: tabular-nums; }
.glm-pin.host .lbl { color: #facc15; } .glm-pin.host .lbl em { color: rgba(250,204,21,0.7); }
.glm-pin .lbl:empty { display: none; }
@keyframes glmPulse { 0%,100% { box-shadow: 0 0 0 0.25rem rgba(250,204,21,0.18) } 50% { box-shadow: 0 0 0 0.45rem rgba(250,204,21,0.08) } }
.glm-ripple { position: absolute; left: 0; top: 0; width: 0.6rem; height: 0.6rem; margin: -0.3rem 0 0 -0.3rem; border-radius: 50%; border: 1.5px solid rgba(242,242,242,0.8); pointer-events: none; animation: glmRipple 1.6s ease-out forwards; }
.glm-ripple.host { border-color: #facc15; }
@keyframes glmRipple { 0% { opacity: 0.9; scale: 1 } 100% { opacity: 0; scale: 7 } }
@media (prefers-reduced-motion: reduce) { .glm-pin.host .disc, .glm-ripple { animation: none; } }
`;
