import 'maplibre-gl/dist/maplibre-gl.css';
import { Box, MenuItem, Select } from '@mui/material';
import { type GeoJSONSource, LngLatBounds, type LngLatLike, Map as MlMap, type MapLayerMouseEvent, NavigationControl, ScaleControl, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_CENTER, MAP_STYLES } from '../config';

export interface MapPoint {
  id: number;
  lon: number;
  lat: number;
  label: string;
  color: string;
  course?: number;
}

export interface MapLine {
  id: string | number;
  coords: [number, number][];
  color?: string;
}

export interface MapCircle {
  id: string | number;
  lon: number;
  lat: number;
  radiusM: number;
  label: string;
}

interface Props {
  points?: MapPoint[];
  lines?: MapLine[];
  circles?: MapCircle[];
  selectedId?: number | null;
  onSelect?: (id: number) => void;
  /** Fly to this coordinate whenever it changes. */
  focus?: [number, number] | null;
  fitToPoints?: boolean;
  /** Zoom to the lines whenever they change (e.g. a loaded route). */
  fitToLines?: boolean;
  height?: number | string;
  onMapReady?: (map: MlMap) => void;
}

// MapLibre locates its worker next to its own module, which breaks once Vite bundles it.
setWorkerUrl(workerUrl);

const STYLE_KEY = 'mapStyle';

function circlePolygon(lon: number, lat: number, radiusM: number, steps = 48): [number, number][] {
  const out: [number, number][] = [];
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    out.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return out;
}

function readStyle() {
  try {
    return localStorage.getItem(STYLE_KEY) ?? MAP_STYLES[0].id;
  } catch {
    return MAP_STYLES[0].id;
  }
}

/** MapLibre map with vehicle markers, polylines (trails, routes) and geofence circles. */
export function FleetMap({ points = [], lines = [], circles = [], selectedId, onSelect, focus, fitToPoints, fitToLines, height = '100%', onMapReady }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [styleId, setStyleId] = useState(readStyle);
  const fitted = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const style = MAP_STYLES.find((s) => s.id === styleId) ?? MAP_STYLES[0];
    const map = new MlMap({ container: container.current!, style: style.style, center: DEFAULT_CENTER, zoom: 4 });
    map.addControl(new NavigationControl(), 'top-right');
    map.addControl(new ScaleControl({}), 'bottom-left');
    mapRef.current = map;
    map.on('load', () => {
      const empty = { type: 'FeatureCollection' as const, features: [] };
      map.addSource('circles', { type: 'geojson', data: empty });
      map.addLayer({ id: 'circles-fill', type: 'fill', source: 'circles', paint: { 'fill-color': '#0b5cad', 'fill-opacity': 0.12 } });
      map.addLayer({ id: 'circles-line', type: 'line', source: 'circles', paint: { 'line-color': '#0b5cad', 'line-width': 1.5 } });
      map.addSource('lines', { type: 'geojson', data: empty });
      map.addLayer({
        id: 'lines',
        type: 'line',
        source: 'lines',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['coalesce', ['get', 'color'], '#0b5cad'], 'line-width': 3, 'line-opacity': 0.8 },
      });
      map.addSource('points', { type: 'geojson', data: empty });
      map.addLayer({
        id: 'points',
        type: 'circle',
        source: 'points',
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 10, 7],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2,
        },
      });
      map.addLayer({
        id: 'labels',
        type: 'symbol',
        source: 'points',
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-offset': [0, 1.4],
          'text-anchor': 'top',
          'text-allow-overlap': false,
        },
        paint: { 'text-color': '#1b2a41', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
      });
      map.on('click', 'points', (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id;
        if (id !== undefined) onSelectRef.current?.(Number(id));
      });
      map.on('mouseenter', 'points', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'points', () => (map.getCanvas().style.cursor = ''));
      setReady(true);
      onMapReady?.(map);
    });
    return () => {
      setReady(false);
      fitted.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, [styleId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('points') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: points.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { id: p.id, label: p.label, color: p.color, selected: p.id === selectedId },
      })),
    });
    if (fitToPoints && !fitted.current && points.length) {
      const b = new LngLatBounds();
      points.forEach((p) => b.extend([p.lon, p.lat]));
      map.fitBounds(b, { padding: 60, maxZoom: 12, duration: 0 });
      fitted.current = true;
    }
  }, [ready, points, selectedId, fitToPoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('lines') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: lines
        .filter((l) => l.coords.length > 1)
        .map((l) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: l.coords }, properties: { id: l.id, color: l.color } })),
    });
    const all = lines.flatMap((l) => l.coords);
    if (fitToLines && all.length > 1) {
      const b = new LngLatBounds();
      all.forEach((c) => b.extend(c));
      map.fitBounds(b, { padding: 50, maxZoom: 14, duration: 500 });
    }
  }, [ready, lines, fitToLines]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('circles') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: circles.map((c) => ({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [circlePolygon(c.lon, c.lat, c.radiusM)] },
        properties: { id: c.id, label: c.label },
      })),
    });
  }, [ready, circles]);

  useEffect(() => {
    if (ready && focus) mapRef.current?.flyTo({ center: focus as LngLatLike, zoom: Math.max(mapRef.current.getZoom(), 10) });
  }, [ready, focus]);

  return (
    <Box sx={{ position: 'relative', height, width: '100%', borderRadius: 2, overflow: 'hidden' }}>
      <Box ref={container} sx={{ position: 'absolute', inset: 0 }} />
      <Select
        size="small"
        value={styleId}
        onChange={(e) => {
          setStyleId(e.target.value);
          try {
            localStorage.setItem(STYLE_KEY, e.target.value);
          } catch {
            /* storage unavailable */
          }
        }}
        sx={{ position: 'absolute', top: 10, left: 10, bgcolor: 'background.paper', fontSize: 13 }}
      >
        {MAP_STYLES.map((s) => (
          <MenuItem key={s.id} value={s.id}>
            {s.label}
          </MenuItem>
        ))}
      </Select>
    </Box>
  );
}
