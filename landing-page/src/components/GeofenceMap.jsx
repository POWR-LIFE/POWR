import React, { useEffect, useRef, useState } from 'react';
import { Crosshair, AlertTriangle, Search, Layers } from 'lucide-react';
import { loadGoogleMaps } from '../lib/googleMaps';

const MAPS_KEY = import.meta.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

const GOLD = '#E8D200';
const SKY = '#0EA5E9';

// The app arms the native OS region at a WIDER "approach" radius than the
// partner's true check-in radius (see APPROACH_RADIUS_M in GeofenceContext) —
// the OS wakes the app at 120 m, then JS confirms the real radius before it
// credits anything. Drawing both rings is the point of this map: the gold ring
// is what a member has to stand inside, the outer ring is only where the phone
// wakes up. Keep this in step with the app constant.
const APPROACH_RADIUS_M = 120;

// Fallback centre when a node has no coordinates yet — central London, where
// POWR's live venues are. Only ever used to give the search box somewhere to
// start; no pin is drawn until real coordinates exist.
const FALLBACK_CENTRE = { lat: 51.5074, lng: -0.1278 };

// The centre pip has to stay visible at a 25 m fence, where a naive fraction of
// the radius renders sub-pixel. Floor it at 2 m so the exact point is always
// readable, and cap it so a wide fence doesn't get a bullseye.
const centrePipM = (radiusM) => Math.min(Math.max(2, radiusM * 0.12), 8);

const num = (v) => {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
};

// ── Geofence preview / editor ────────────────────────────────────────────────
// Renders one partner location's check-in fence over Google Maps so an admin can
// see the circle the app actually enforces sitting on the real building. Drag the
// gold ring (or click the map) to move the node; `onMove` receives the new
// coordinates and the parent owns the state as before.
export default function GeofenceMap({ lat, lng, radius, label, readOnly = false, onMove, height = 320 }) {
    const elRef = useRef(null);
    const searchRef = useRef(null);
    const mapRef = useRef(null);
    const fenceRef = useRef(null);       // gold circle: the true check-in radius
    const approachRef = useRef(null);    // outer circle: the OS wake ring
    const dotRef = useRef(null);         // centre pip, so the exact point stays visible
    const onMoveRef = useRef(onMove);
    const applyingRef = useRef(false);   // true while WE move the circle, to mute the drag handler
    const [mapType, setMapType] = useState('hybrid');  // satellite + labels — the only way to judge a 25 m fence
    const [ready, setReady] = useState(false);
    const [error, setError] = useState(null);

    onMoveRef.current = onMove;

    const centre = (() => {
        const la = num(lat), ln = num(lng);
        return la === null || ln === null ? null : { lat: la, lng: ln };
    })();
    const radiusM = num(radius) ?? 25;
    // Only draw the wake ring when it's genuinely wider than the fence, otherwise
    // it just traces the gold circle and reads as a rendering glitch.
    const showApproach = radiusM < APPROACH_RADIUS_M;

    // Frame the node: fit whichever ring is the outer one, so the fence fills the
    // viewport instead of being a speck at whatever zoom the map opened on.
    const frame = (maps, animate) => {
        const outer = showApproach ? approachRef.current : fenceRef.current;
        const bounds = outer?.getBounds?.();
        if (!bounds || !mapRef.current) return;
        if (animate) mapRef.current.panToBounds(bounds);
        mapRef.current.fitBounds(bounds, 24);
    };

    // ── Boot the map once ────────────────────────────────────────────────────
    useEffect(() => {
        let cancelled = false;
        loadGoogleMaps(MAPS_KEY)
            .then((maps) => {
                if (cancelled || !elRef.current) return;

                mapRef.current = new maps.Map(elRef.current, {
                    center: centre || FALLBACK_CENTRE,
                    zoom: centre ? 18 : 11,
                    mapTypeId: 'hybrid',
                    disableDefaultUI: true,
                    zoomControl: true,
                    gestureHandling: 'cooperative',
                    tilt: 0,
                });

                approachRef.current = new maps.Circle({
                    map: null,
                    center: centre || FALLBACK_CENTRE,
                    radius: APPROACH_RADIUS_M,
                    strokeColor: SKY, strokeOpacity: 0.55, strokeWeight: 1.5,
                    fillColor: SKY, fillOpacity: 0.06,
                    clickable: false,
                });

                fenceRef.current = new maps.Circle({
                    map: null,
                    center: centre || FALLBACK_CENTRE,
                    radius: radiusM,
                    strokeColor: GOLD, strokeOpacity: 0.95, strokeWeight: 2,
                    fillColor: GOLD, fillOpacity: 0.22,
                    draggable: !readOnly,
                    clickable: !readOnly,
                });

                dotRef.current = new maps.Circle({
                    map: null,
                    center: centre || FALLBACK_CENTRE,
                    radius: centrePipM(radiusM),
                    strokeColor: '#1A1A1A', strokeOpacity: 0.9, strokeWeight: 1,
                    fillColor: '#1A1A1A', fillOpacity: 0.85,
                    clickable: false,
                });

                if (!readOnly) {
                    // Drag the fence itself — the circle IS the handle, so there's no
                    // second marker to disagree with it.
                    fenceRef.current.addListener('dragend', () => {
                        if (applyingRef.current) return;
                        const c = fenceRef.current.getCenter();
                        onMoveRef.current?.({ lat: +c.lat().toFixed(6), lng: +c.lng().toFixed(6) });
                    });
                    mapRef.current.addListener('click', (e) => {
                        if (!e.latLng) return;
                        onMoveRef.current?.({ lat: +e.latLng.lat().toFixed(6), lng: +e.latLng.lng().toFixed(6) });
                    });

                    // Places search — the fastest way to land on a venue that has an
                    // address but no coordinates yet. Fails soft if Places isn't
                    // enabled on the key; the map still works.
                    if (searchRef.current && maps.places?.Autocomplete) {
                        const ac = new maps.places.Autocomplete(searchRef.current, {
                            fields: ['geometry'],
                        });
                        ac.bindTo('bounds', mapRef.current);
                        ac.addListener('place_changed', () => {
                            const loc = ac.getPlace()?.geometry?.location;
                            if (!loc) return;
                            onMoveRef.current?.({ lat: +loc.lat().toFixed(6), lng: +loc.lng().toFixed(6) });
                        });
                    }
                }

                setReady(true);
            })
            .catch((err) => { if (!cancelled) setError(err.message); });

        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Keep the rings in step with the form ────────────────────────────────
    useEffect(() => {
        if (!ready || !window.google?.maps) return;
        const maps = window.google.maps;
        const map = mapRef.current;

        if (!centre) {
            // No coordinates yet — clear the rings rather than parking them at 0,0.
            [fenceRef, approachRef, dotRef].forEach(r => r.current?.setMap(null));
            return;
        }

        applyingRef.current = true;
        const c = new maps.LatLng(centre.lat, centre.lng);

        approachRef.current.setCenter(c);
        approachRef.current.setMap(showApproach ? map : null);

        fenceRef.current.setCenter(c);
        fenceRef.current.setRadius(radiusM);
        fenceRef.current.setMap(map);

        dotRef.current.setCenter(c);
        dotRef.current.setRadius(centrePipM(radiusM));
        dotRef.current.setMap(map);
        applyingRef.current = false;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, centre?.lat, centre?.lng, radiusM, showApproach]);

    // Frame once the node first gets coordinates; after that the admin's own pan
    // and zoom is left alone — refitting on every keystroke would fight them.
    const framedRef = useRef(false);
    useEffect(() => {
        if (!ready || !centre || framedRef.current) return;
        framedRef.current = true;
        frame(window.google.maps, false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, centre?.lat, centre?.lng]);

    useEffect(() => {
        if (ready && mapRef.current) mapRef.current.setMapTypeId(mapType);
    }, [ready, mapType]);

    if (error) {
        return (
            <div className="flex items-center gap-3 p-6 bg-[#F4F4F1] border border-dashed border-[#E6E6E1] rounded-2xl">
                <AlertTriangle size={14} className="text-red-500 shrink-0" />
                <span className="text-[10px] uppercase tracking-[0.3em] text-[#666666] font-black">Map unavailable — {error}</span>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {!readOnly && (
                <div className="relative">
                    <Search size={13} className="absolute left-5 top-1/2 -translate-y-1/2 text-[#BBBBBB]" />
                    <input
                        ref={searchRef}
                        type="text"
                        placeholder="SEARCH A VENUE OR ADDRESS TO DROP THE PIN..."
                        onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
                        className="w-full h-12 pl-12 pr-6 bg-white border border-[#E6E6E1] rounded-2xl text-[11px] font-bold text-[#1A1A1A] placeholder-[#BBBBBB] focus:border-[#E8D200]/40 outline-none transition-all"
                    />
                </div>
            )}

            <div className="relative rounded-2xl overflow-hidden border border-[#E6E6E1]">
                <div ref={elRef} style={{ height }} className="w-full bg-[#F4F4F1]" />

                {!centre && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/85 pointer-events-none">
                        <p className="text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black text-center px-8">
                            {readOnly ? 'No coordinates on this node' : 'Search above or click the map to place this node'}
                        </p>
                    </div>
                )}

                <div className="absolute top-3 right-3 flex gap-2">
                    <button
                        type="button"
                        onClick={() => setMapType(t => (t === 'hybrid' ? 'roadmap' : 'hybrid'))}
                        title={mapType === 'hybrid' ? 'Switch to map' : 'Switch to satellite'}
                        className="h-9 px-4 flex items-center gap-2 bg-white/95 border border-[#E6E6E1] rounded-full text-[8px] uppercase tracking-[0.3em] text-[#333333] hover:text-[#8a7600] font-black transition-all shadow-sm"
                    >
                        {/* Labelled with the view you'd switch TO, like Google's own control —
                            labelling the current view reads as a status and confuses the click. */}
                        <Layers size={11} /> {mapType === 'hybrid' ? 'Map' : 'Satellite'}
                    </button>
                    {centre && (
                        <button
                            type="button"
                            onClick={() => frame(window.google.maps, true)}
                            title="Recentre on the fence"
                            className="w-9 h-9 flex items-center justify-center bg-white/95 border border-[#E6E6E1] rounded-full text-[#333333] hover:text-[#8a7600] transition-all shadow-sm"
                        >
                            <Crosshair size={13} />
                        </button>
                    )}
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-2">
                <span className="flex items-center gap-2 text-[8px] uppercase tracking-[0.3em] text-[#666666] font-black">
                    <span className="w-3 h-3 rounded-full border-2" style={{ borderColor: GOLD, background: `${GOLD}38` }} />
                    Check-in fence · {Math.round(radiusM)}m
                </span>
                {showApproach && (
                    <span className="flex items-center gap-2 text-[8px] uppercase tracking-[0.3em] text-[#666666] font-black">
                        <span className="w-3 h-3 rounded-full border" style={{ borderColor: SKY, background: `${SKY}12` }} />
                        Wake ring · {APPROACH_RADIUS_M}m
                    </span>
                )}
                {centre && (
                    <span className="text-[8px] uppercase tracking-[0.3em] text-[#999999] font-black font-mono">
                        {centre.lat.toFixed(5)}, {centre.lng.toFixed(5)}
                    </span>
                )}
                {!readOnly && centre && (
                    <span className="text-[8px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">
                        Drag the gold ring to adjust{label ? ` · ${label}` : ''}
                    </span>
                )}
            </div>
        </div>
    );
}
