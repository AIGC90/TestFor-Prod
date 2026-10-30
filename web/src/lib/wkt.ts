/** Geofence shapes as used in the UI; coordinates are [lon, lat] like GeoJSON. */
export type Shape =
  | { kind: 'circle'; center: [number, number]; radius: number }
  | { kind: 'polygon'; coords: [number, number][] }
  | { kind: 'line'; coords: [number, number][] };

// Traccar stores WKT with latitude first: "CIRCLE (lat lon, r)", "POLYGON ((lat lon, ...))".
const pair = (lon: number, lat: number) => `${+lat.toFixed(6)} ${+lon.toFixed(6)}`;

export function toWkt(shape: Shape): string {
  switch (shape.kind) {
    case 'circle':
      return `CIRCLE (${pair(...shape.center)}, ${Math.round(shape.radius)})`;
    case 'polygon': {
      const ring = [...shape.coords];
      const [f, l] = [ring[0], ring[ring.length - 1]];
      if (f[0] !== l[0] || f[1] !== l[1]) ring.push(f);
      return `POLYGON ((${ring.map((c) => pair(...c)).join(', ')}))`;
    }
    case 'line':
      return `LINESTRING (${shape.coords.map((c) => pair(...c)).join(', ')})`;
  }
}

function points(text: string): [number, number][] {
  return text
    .split(',')
    .map((p) => p.trim().split(/\s+/).map(Number))
    .filter((p) => p.length === 2 && p.every(Number.isFinite))
    .map(([lat, lon]) => [lon, lat]);
}

export function parseWkt(wkt: string): Shape | null {
  const s = wkt.trim();
  let m = s.match(/^CIRCLE\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*,\s*([\d.]+)\s*\)$/i);
  if (m) return { kind: 'circle', center: [Number(m[2]), Number(m[1])], radius: Number(m[3]) };
  m = s.match(/^POLYGON\s*\(\s*\((.*)\)\s*\)$/i);
  if (m) {
    const coords = points(m[1]);
    return coords.length >= 3 ? { kind: 'polygon', coords } : null;
  }
  m = s.match(/^LINESTRING\s*\((.*)\)$/i);
  if (m) {
    const coords = points(m[1]);
    return coords.length >= 2 ? { kind: 'line', coords } : null;
  }
  return null;
}

/** Centre point of a shape, for flying the map to it. */
export function shapeCenter(shape: Shape): [number, number] {
  if (shape.kind === 'circle') return shape.center;
  const lon = shape.coords.reduce((s, c) => s + c[0], 0) / shape.coords.length;
  const lat = shape.coords.reduce((s, c) => s + c[1], 0) / shape.coords.length;
  return [lon, lat];
}

/** Reads track points from a GPX file as a line. */
export function gpxToShape(xml: string): Shape | null {
  const coords = [...xml.matchAll(/<(?:trkpt|rtept|wpt)[^>]*\blat="([-\d.]+)"[^>]*\blon="([-\d.]+)"/g)].map(
    (m) => [Number(m[2]), Number(m[1])] as [number, number],
  );
  return coords.length >= 2 ? { kind: 'line', coords } : null;
}
