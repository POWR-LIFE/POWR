import React, { useEffect, useRef, useState } from 'react';
import { Crosshair, AlertTriangle, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../lib/toast';
import { loadGoogleMaps } from '../lib/googleMaps';
import {
    GOLD, RED, CELL_CAP,
    nAt, lngLatToTile, tileNW, tileBounds, cellKey, parseKey,
    tilesOverlap, clampZoom, buildWeekMask, startOfDayISO, endOfDayISO,
} from '../lib/placementGrid';

const MAPS_KEY = import.meta.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

// ── Adaptive grid map ─────────────────────────────────────────────────────────
// Paint/erase a set of Web-Mercator tiles at whatever zoom the map is showing.
// Shared by the admin RewardPlacements page and the partner PartnerPlacements
// page — the only auth difference lives in the get_taken_grid_cells RPC.
export default function PlacementGridMap({ form, toggleCell, onPaint, onEraseArea, excludeId }) {
    const toast = useToast();
    const elRef = useRef(null);
    const searchRef = useRef(null);
    const mapRef = useRef(null);
    const rectsRef = useRef([]);
    const takenRef = useRef([]);          // [{z,x,y}] occupied by other placements for this slice
    const selectedRef = useRef(form.cells);
    const modeRef = useRef('pan');
    const startRef = useRef(null);
    const lastRef = useRef(null);
    const previewRef = useRef(null);
    const finalizeRef = useRef(() => {});
    const [mode, setMode] = useState('pan');
    const [error, setError] = useState(null);
    const [tooWide, setTooWide] = useState(false);
    const [ready, setReady] = useState(false);
    const [idleTick, setIdleTick] = useState(0);

    selectedRef.current = form.cells;
    modeRef.current = mode;
    const mask = buildWeekMask(form.active_days, form.active_hour_start, form.active_hour_end);
    // Flight window — the occupancy preview should only flag squares taken by
    // placements whose DATE range also overlaps the one being edited.
    const startISO = startOfDayISO(form.starts_on);
    const endISO = endOfDayISO(form.ends_on);

    const curZoom = () => clampZoom(mapRef.current?.getZoom() ?? 13);

    const cellsInBox = (a, b, z) => {
        const nw = lngLatToTile(Math.max(a.lat(), b.lat()), Math.min(a.lng(), b.lng()), z);
        const se = lngLatToTile(Math.min(a.lat(), b.lat()), Math.max(a.lng(), b.lng()), z);
        const list = [];
        for (let y = Math.min(nw.y, se.y); y <= Math.max(nw.y, se.y); y++)
            for (let x = Math.min(nw.x, se.x); x <= Math.max(nw.x, se.x); x++) list.push({ z, x, y });
        return list;
    };
    const isTaken = (cell) => takenRef.current.some((t) => tilesOverlap(cell, t));

    const addRect = (bounds, style) => {
        rectsRef.current.push(new window.google.maps.Rectangle({ map: mapRef.current, clickable: false, bounds, ...style }));
    };

    const redraw = () => {
        const maps = window.google?.maps;
        if (!maps || !mapRef.current) return;
        rectsRef.current.forEach((r) => r.setMap(null));
        rectsRef.current = [];
        const b = mapRef.current.getBounds();
        if (!b) return;
        const z = curZoom();
        const ne = b.getNorthEast(), sw = b.getSouthWest();
        const nw = lngLatToTile(ne.lat(), sw.lng(), z);
        const se = lngLatToTile(sw.lat(), ne.lng(), z);
        const xmin = Math.min(nw.x, se.x), xmax = Math.max(nw.x, se.x);
        const ymin = Math.min(nw.y, se.y), ymax = Math.max(nw.y, se.y);
        const count = (xmax - xmin + 1) * (ymax - ymin + 1);
        if (count > CELL_CAP) { setTooWide(true); return; }
        setTooWide(false);

        const selected = selectedRef.current;
        // faint available grid at the current zoom
        for (let y = ymin; y <= ymax; y++)
            for (let x = xmin; x <= xmax; x++)
                addRect(tileBounds(z, x, y), { fillOpacity: 0, strokeColor: '#94a3b8', strokeOpacity: 0.22, strokeWeight: 1 });
        // taken cells (their own zoom)
        for (const t of takenRef.current)
            addRect(tileBounds(t.z, t.x, t.y), { fillColor: RED, fillOpacity: 0.38, strokeColor: RED, strokeOpacity: 0.9, strokeWeight: 1 });
        // selected cells (their own zoom)
        for (const key of selected) { const { z: cz, x, y } = parseKey(key); addRect(tileBounds(cz, x, y), { fillColor: GOLD, fillOpacity: 0.5, strokeColor: GOLD, strokeOpacity: 0.95, strokeWeight: 1 }); }
    };

    const fetchTakenAndRedraw = async () => {
        const b = mapRef.current?.getBounds();
        if (!b) { redraw(); return; }
        const ne = b.getNorthEast(), sw = b.getSouthWest();
        try {
            const { data } = await supabase.rpc('get_taken_grid_cells', {
                p_south: sw.lat(), p_west: sw.lng(), p_north: ne.lat(), p_east: ne.lng(),
                p_exclude: excludeId ?? null, p_starts: startISO, p_ends: endISO, p_mask: mask,
            });
            takenRef.current = data ?? [];
        } catch { takenRef.current = []; }
        redraw();
    };

    const clearPreview = () => { if (previewRef.current) { previewRef.current.setMap(null); previewRef.current = null; } };
    const finalizeDrag = () => {
        const start = startRef.current, last = lastRef.current;
        startRef.current = null; lastRef.current = null;
        clearPreview();
        if (!start || !last) return;
        if (modeRef.current === 'erase') {
            onEraseArea({
                north: Math.max(start.lat(), last.lat()), south: Math.min(start.lat(), last.lat()),
                east: Math.max(start.lng(), last.lng()), west: Math.min(start.lng(), last.lng()),
            });
            return;
        }
        const list = cellsInBox(start, last, curZoom());
        if (list.length > CELL_CAP) { toast.error('Area too large — zoom in a little and try again'); return; }
        onPaint(list.filter((c) => !isTaken(c)));
    };
    finalizeRef.current = finalizeDrag;

    useEffect(() => {
        let cancelled = false;
        loadGoogleMaps(MAPS_KEY)
            .then((maps) => {
                if (cancelled || !elRef.current || mapRef.current) return;
                const map = new maps.Map(elRef.current, {
                    center: { lat: form.center_lat, lng: form.center_lng },
                    zoom: 13,
                    mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
                    clickableIcons: false, gestureHandling: 'greedy',
                });
                map.addListener('click', (e) => {
                    if (modeRef.current !== 'pan') return;
                    const cell = lngLatToTile(e.latLng.lat(), e.latLng.lng(), curZoom());
                    if (isTaken(cell)) return;
                    toggleCell(cell.z, cell.x, cell.y);
                });
                map.addListener('mousedown', (e) => {
                    if (modeRef.current === 'pan') return;
                    startRef.current = e.latLng; lastRef.current = e.latLng;
                    clearPreview();
                    const c = modeRef.current === 'erase' ? RED : GOLD;
                    previewRef.current = new maps.Rectangle({
                        map, clickable: false, fillColor: c, fillOpacity: 0.15, strokeColor: c, strokeOpacity: 0.9, strokeWeight: 1,
                        bounds: { north: e.latLng.lat(), south: e.latLng.lat(), east: e.latLng.lng(), west: e.latLng.lng() },
                    });
                });
                map.addListener('mousemove', (e) => {
                    if (!startRef.current) return;
                    lastRef.current = e.latLng;
                    const s = startRef.current;
                    previewRef.current?.setBounds({
                        north: Math.max(s.lat(), e.latLng.lat()), south: Math.min(s.lat(), e.latLng.lat()),
                        east: Math.max(s.lng(), e.latLng.lng()), west: Math.min(s.lng(), e.latLng.lng()),
                    });
                });
                map.addListener('idle', () => setIdleTick((t) => t + 1));

                // Address / venue search — fly the map to a typed place. Fails
                // soft if the Places library/API isn't available on the key.
                if (searchRef.current && maps.places?.Autocomplete) {
                    const ac = new maps.places.Autocomplete(searchRef.current, { fields: ['geometry'] });
                    ac.addListener('place_changed', () => {
                        const place = ac.getPlace();
                        if (place?.geometry?.viewport) map.fitBounds(place.geometry.viewport);
                        else if (place?.geometry?.location) { map.setCenter(place.geometry.location); map.setZoom(16); }
                    });
                }

                mapRef.current = map;
                setReady(true);
            })
            .catch((e) => !cancelled && setError(e.message));
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        const up = () => finalizeRef.current();
        window.addEventListener('mouseup', up);
        return () => window.removeEventListener('mouseup', up);
    }, []);

    useEffect(() => {
        if (mapRef.current) mapRef.current.setOptions({ draggable: mode === 'pan', draggableCursor: mode === 'pan' ? null : 'crosshair' });
    }, [mode, ready]);

    useEffect(() => { if (ready) fetchTakenAndRedraw(); }, [ready, idleTick, mask, startISO, endISO, excludeId]);
    useEffect(() => { if (ready) redraw(); }, [form.cells]);

    const locateMe = () => {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition((p) => { if (mapRef.current) mapRef.current.setCenter({ lat: p.coords.latitude, lng: p.coords.longitude }); });
    };

    if (error) {
        return (
            <div className="h-[420px] lg:h-[560px] w-full rounded-2xl border border-amber-300 bg-amber-50 flex flex-col items-center justify-center text-center px-6 gap-2">
                <AlertTriangle size={22} className="text-amber-500" />
                <div className="text-[13px] font-semibold text-amber-800">Map couldn’t load</div>
                <div className="text-[12px] text-amber-700 max-w-sm">{error}. Enable the “Maps JavaScript API” and add this domain to the key’s referrer allow-list in Google Cloud Console.</div>
            </div>
        );
    }

    const modeBtn = (m, label) => (
        <button type="button" onClick={() => setMode(m)}
            className={`px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide transition ${mode === m ? 'bg-[#E8D200] text-[#080808]' : 'bg-white text-[#666] hover:bg-[#F4F4F1]'}`}>
            {label}
        </button>
    );

    return (
        <div className="relative">
            <div ref={elRef} className="h-[420px] lg:h-[560px] w-full rounded-2xl overflow-hidden border border-[#E6E6E1] bg-[#EDEDEA]" />
            <div className="absolute top-3 left-3 flex rounded-lg overflow-hidden shadow border border-[#E6E6E1]">
                {modeBtn('pan', 'Pan')}
                {modeBtn('paint', 'Paint')}
                {modeBtn('erase', 'Erase')}
            </div>
            <div className="absolute top-3 left-1/2 -translate-x-1/2 w-[min(300px,55%)]">
                <div className="flex items-center gap-2 bg-white/95 backdrop-blur px-3 h-9 rounded-lg shadow border border-[#E6E6E1]">
                    <Search size={14} className="text-[#999] shrink-0" />
                    <input ref={searchRef} type="text" placeholder="Search a place or address…"
                        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                        className="w-full bg-transparent text-[13px] text-[#1A1A1A] placeholder:text-[#AAA] outline-none" />
                </div>
            </div>
            <button type="button" onClick={locateMe}
                className="absolute top-3 right-3 flex items-center gap-1.5 bg-white/95 backdrop-blur px-3 py-1.5 rounded-lg shadow text-[12px] font-semibold text-[#8a7600] hover:bg-white">
                <Crosshair size={13} /> My location
            </button>
            {tooWide && (
                <div className="absolute inset-x-0 bottom-3 flex justify-center pointer-events-none">
                    <div className="bg-black/70 text-white text-[12px] font-medium px-3 py-1.5 rounded-lg">Zoom in to select squares</div>
                </div>
            )}
        </div>
    );
}
