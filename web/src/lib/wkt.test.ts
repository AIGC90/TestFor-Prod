import { describe, expect, it } from 'vitest';
import { gpxToShape, parseWkt, shapeCenter, toWkt } from './wkt';

describe('wkt', () => {
  it('reads Traccar circles (lat first) and writes them back', () => {
    const shape = parseWkt('CIRCLE (23.0225 72.5714, 3000)');
    expect(shape).toEqual({ kind: 'circle', center: [72.5714, 23.0225], radius: 3000 });
    expect(toWkt(shape!)).toBe('CIRCLE (23.0225 72.5714, 3000)');
  });

  it('closes polygon rings and parses them', () => {
    const wkt = toWkt({ kind: 'polygon', coords: [[77, 28], [77.1, 28], [77.1, 28.1]] });
    expect(wkt).toBe('POLYGON ((28 77, 28 77.1, 28.1 77.1, 28 77))');
    expect(parseWkt(wkt)).toMatchObject({ kind: 'polygon' });
  });

  it('handles lines and rejects junk', () => {
    expect(parseWkt('LINESTRING (28 77, 28.5 77.5)')).toEqual({ kind: 'line', coords: [[77, 28], [77.5, 28.5]] });
    expect(parseWkt('POINT (1 2)')).toBeNull();
    expect(parseWkt('POLYGON ((1 2, 3 4))')).toBeNull();
  });

  it('finds a shape centre', () => {
    expect(shapeCenter({ kind: 'line', coords: [[0, 0], [2, 4]] })).toEqual([1, 2]);
  });

  it('reads GPX track points', () => {
    const gpx = '<gpx><trk><trkseg><trkpt lat="28.6" lon="77.2"/><trkpt lat="28.7" lon="77.3"></trkpt></trkseg></trk></gpx>';
    expect(gpxToShape(gpx)).toEqual({ kind: 'line', coords: [[77.2, 28.6], [77.3, 28.7]] });
  });
});
