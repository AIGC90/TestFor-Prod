import { describe, expect, it } from 'vitest';
import type { Device, Position } from '../api/traccar';
import { NAV, NAV_ITEMS } from '../nav';
import { eventLabel, fleetStatus, knotsToKmh } from './fleet';

const device = (status: Device['status']) => ({ id: 1, status }) as Device;
const position = (speed: number, attributes: Position['attributes']) => ({ speed, attributes }) as Position;

describe('fleetStatus', () => {
  it('is offline when the device is not online or has no position', () => {
    expect(fleetStatus(device('offline'), position(30, { motion: true }))).toBe('offline');
    expect(fleetStatus(device('online'))).toBe('offline');
  });

  it('is moving when motion is reported, else falls back to speed', () => {
    expect(fleetStatus(device('online'), position(0, { motion: true }))).toBe('moving');
    expect(fleetStatus(device('online'), position(20, {}))).toBe('moving');
  });

  it('separates idle (ignition on) from stopped (ignition off)', () => {
    expect(fleetStatus(device('online'), position(0, { motion: false, ignition: true }))).toBe('idle');
    expect(fleetStatus(device('online'), position(0, { motion: false, ignition: false }))).toBe('stopped');
  });
});

describe('helpers', () => {
  it('converts knots to km/h', () => {
    expect(knotsToKmh(10)).toBeCloseTo(18.52);
  });

  it('labels known and unknown events', () => {
    expect(eventLabel('deviceOverspeed')).toBe('Speed limit exceeded');
    expect(eventLabel('somethingNew')).toBe('somethingNew');
  });
});

describe('navigation', () => {
  it('has all 74 entries in 8 sections with unique paths', () => {
    expect(NAV).toHaveLength(8);
    expect(NAV_ITEMS).toHaveLength(74);
    expect(new Set(NAV_ITEMS.map((i) => i.path)).size).toBe(74);
  });
});
