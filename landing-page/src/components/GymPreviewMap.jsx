import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * The map behind the gym's page in GymAppPreview: CARTO Dark Matter vector
 * tiles (© OpenStreetMap contributors, © CARTO) drawn by MapLibre and
 * recoloured to the app's own Discover map (DARK_MAP_STYLE in
 * app/(tabs)/discover.tsx): grey land, roads a shade lighter, near-black
 * water, no POIs or transit, quiet labels. No key and no origin
 * restriction, so it draws on localhost and previews too (CARTO's raster
 * tiles now want a key; the web Maps key only allows powr.life). A still:
 * nothing moves it. Loaded lazily so the portal only carries MapLibre here.
 */

const STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

function tune(map) {
    for (const l of map.getStyle().layers ?? []) {
        const id = l.id;
        try {
            if (id === 'background') map.setPaintProperty(id, 'background-color', '#1c1c1e');
            else if (id === 'water' || id === 'waterway') map.setPaintProperty(id, l.type === 'line' ? 'line-color' : 'fill-color', '#131314');
            else if (id === 'water_shadow') map.setLayoutProperty(id, 'visibility', 'none');
            else if (/^(landcover|landuse|park)/.test(id) && l.type === 'fill') map.setPaintProperty(id, 'fill-color', '#1e1e20');
            else if (id === 'building' || id === 'building-top') map.setPaintProperty(id, 'fill-color', '#212123');
            else if (l.type === 'symbol' && /poi|housenum|transit|rail|aeroway|_dot_/.test(id)) map.setLayoutProperty(id, 'visibility', 'none');
            else if (l.type === 'symbol') {
                map.setPaintProperty(id, 'text-color', /roadname/.test(id) ? '#585858' : '#686868');
                map.setPaintProperty(id, 'text-halo-color', '#161616');
            } else if (/^(road|bridge|tunnel)_(mot|trunk)/.test(id)) map.setPaintProperty(id, 'line-color', /_case/.test(id) ? '#383838' : '#2e2e2e');
            else if (/^(road|bridge|tunnel)_/.test(id)) map.setPaintProperty(id, 'line-color', /_case/.test(id) ? '#313131' : '#282828');
            else if (/^rail/.test(id) || /_rail/.test(id)) map.setLayoutProperty(id, 'visibility', 'none');
            else if (/^boundary/.test(id)) map.setPaintProperty(id, 'line-color', '#272727');
        } catch {
            // a layer this style version doesn't have: leave it as CARTO drew it
        }
    }
}

export default function GymPreviewMap({ lat, lng, zoom = 15.6 }) {
    const ref = useRef(null);
    const mapRef = useRef(null);
    useEffect(() => {
        if (!ref.current) return undefined;
        let map;
        try {
            map = new maplibregl.Map({
                container: ref.current, style: STYLE_URL, center: [lng, lat], zoom,
                interactive: false, attributionControl: false, fadeDuration: 0,
            });
        } catch {
            return undefined;   // no WebGL: the dark ground underneath stands in
        }
        mapRef.current = map;
        map.on('load', () => tune(map));
        return () => { mapRef.current = null; map.remove(); };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { mapRef.current?.jumpTo({ center: [lng, lat], zoom }); }, [lat, lng, zoom]);
    return <div ref={ref} style={{ position: 'absolute', inset: 0 }} />;
}
