import { http, qs } from './http';

export interface User {
  id: number;
  name: string;
  email: string;
  administrator: boolean;
  readonly: boolean;
  attributes: Record<string, unknown>;
}

export interface Device {
  id: number;
  name: string;
  uniqueId: string;
  status: 'online' | 'offline' | 'unknown';
  lastUpdate: string | null;
  positionId: number;
  groupId: number;
  phone: string | null;
  model: string | null;
  contact: string | null;
  category: string | null;
  disabled: boolean;
  expirationTime: string | null;
  attributes: Record<string, unknown>;
}

export interface Position {
  id: number;
  deviceId: number;
  fixTime: string;
  latitude: number;
  longitude: number;
  speed: number; // knots
  course: number;
  address: string | null;
  attributes: {
    ignition?: boolean;
    motion?: boolean;
    odometer?: number;
    totalDistance?: number;
    fuel?: number;
    batteryLevel?: number;
    driverUniqueId?: string;
    [k: string]: unknown;
  };
}

export interface TEvent {
  id: number;
  type: string;
  eventTime: string;
  deviceId: number;
  positionId: number;
  geofenceId: number;
  attributes: Record<string, unknown>;
}

export interface Group {
  id: number;
  name: string;
  groupId: number;
}

export interface Driver {
  id: number;
  name: string;
  uniqueId: string;
  attributes: Record<string, unknown>;
}

export interface Geofence {
  id: number;
  name: string;
  description: string | null;
  area: string;
  calendarId: number;
  attributes: Record<string, unknown>;
}

export interface SummaryRow {
  deviceId: number;
  deviceName: string;
  distance: number; // metres
  averageSpeed: number;
  maxSpeed: number;
  spentFuel: number;
  engineHours: number;
  startTime: string;
  endTime: string;
}

export const traccar = {
  session: () => http<User>('/api/session'),
  login: (email: string, password: string) =>
    http<User>('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email, password }),
    }),
  logout: () => http<void>('/api/session', { method: 'DELETE' }),
  devices: () => http<Device[]>('/api/devices'),
  positions: () => http<Position[]>('/api/positions'),
  groups: () => http<Group[]>('/api/groups'),
  summary: (deviceIds: number[], from: string, to: string, daily = false) =>
    http<SummaryRow[]>(`/api/reports/summary?${qs({ deviceId: deviceIds, from, to, daily })}`),
  events: (deviceIds: number[], from: string, to: string, type?: string[]) =>
    http<TEvent[]>(`/api/reports/events?${qs({ deviceId: deviceIds, from, to, type })}`),
  route: (deviceId: number, from: string, to: string) =>
    http<Position[]>(`/api/reports/route?${qs({ deviceId, from, to })}`),
  drivers: () => http<Driver[]>('/api/drivers'),
  geofences: () => http<Geofence[]>('/api/geofences'),
};
