import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * The real map under the Gym League's network card: CARTO Dark Matter vector
 * tiles rendered by MapLibre (© OpenStreetMap contributors, © CARTO), tuned
 * to the wall — water darker than the card, roads as faint structure, parks
 * a shade green, no POIs or street names. It draws nothing of the league:
 * GymLeague.jsx's canvas stays on top and projects every gym through this
 * map, so the dots, labels, arcs and ripples keep their look.
 *
 * No key and no origin restriction, so it renders on localhost too. Loaded
 * lazily so the rest of the site never carries MapLibre. Hands the map up
 * once it's styled, or null if it can't load (the card falls back to its
 * drawn coastline and Thames).
 */

const STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

function tuneStyle(map) {
    for (const l of map.getStyle().layers ?? []) {
        const id = l.id;
        try {
            if (id === 'background') map.setPaintProperty(id, 'background-color', '#131313');
            else if (id === 'water' || id === 'waterway') map.setPaintProperty(id, l.type === 'line' ? 'line-color' : 'fill-color', '#060606');
            else if (id === 'water_shadow') map.setLayoutProperty(id, 'visibility', 'none');
            else if (/^(landcover|landuse|park)/.test(id) && l.type === 'fill') map.setPaintProperty(id, 'fill-color', /park|landcover|wood|grass/.test(id) ? '#171c17' : '#151515');
            else if (l.type === 'symbol' && /poi|housenum|roadname|waterway_label|watername|place_hamlet|place_villages|place_city|place_capital|place_country|place_state|place_continent|_dot_/.test(id)) map.setLayoutProperty(id, 'visibility', 'none');
            else if (l.type === 'symbol') {
                // Area names, faint, so the city reads as a place; the league's own labels stay on top.
                map.setPaintProperty(id, 'text-color', '#5a5a5a');
                map.setPaintProperty(id, 'text-halo-color', '#0e0e0e');
                map.setPaintProperty(id, 'text-halo-width', 1.5);
            } else if (id === 'building' || id === 'building-top') map.setPaintProperty(id, 'fill-color', '#191919');
            else if (/_case/.test(id)) map.setLayoutProperty(id, 'visibility', 'none');
            else if (/^(road|bridge|tunnel)_(mot|trunk)/.test(id)) map.setPaintProperty(id, 'line-color', '#303030');
            else if (/^(road|bridge|tunnel)_(pri|sec)/.test(id)) map.setPaintProperty(id, 'line-color', '#262626');
            else if (/^(road|bridge|tunnel)_(minor|service|path)/.test(id)) map.setPaintProperty(id, 'line-color', '#1d1d1d');
            else if (/^rail/.test(id) || /_rail/.test(id)) map.setPaintProperty(id, 'line-color', '#222');
            else if (/^boundary/.test(id)) map.setPaintProperty(id, 'line-color', '#2a2a2a');
        } catch {
            // a layer this style version doesn't have: leave it as CARTO drew it
        }
    }
}

export default function GymLeagueBasemap({ onMap, initialBounds }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ref.current) return undefined;
        let map;
        let ready = false;
        try {
            map = new maplibregl.Map({
                container: ref.current,
                style: STYLE_URL,
                interactive: false,
                attributionControl: false,
                bounds: initialBounds,
                fadeDuration: 0,
                maxZoom: 15,
            });
        } catch {
            onMap(null);
            return undefined;
        }
        map.on('load', () => { tuneStyle(map); ready = true; onMap(map); });
        map.on('error', () => { if (!ready) onMap(null); });
        const ro = new ResizeObserver(() => map.resize());
        ro.observe(ref.current);
        return () => { ro.disconnect(); onMap(null); map.remove(); };
        // Boot once; the canvas drives the camera through the map it's handed.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div ref={ref} className="gl-basemap" />;
}
