import type { Device, Position } from '../api/traccar';

export type FleetStatus = 'moving' | 'idle' | 'stopped' | 'offline';

export const STATUS_LABEL: Record<FleetStatus, string> = {
  moving: 'Moving',
  idle: 'Idle',
  stopped: 'Stopped',
  offline: 'Offline',
};

export const STATUS_COLOR: Record<FleetStatus, string> = {
  moving: '#2e7d32',
  idle: '#ed6c02',
  stopped: '#1565c0',
  offline: '#9e9e9e',
};

const MOVING_KNOTS = 1.5;

/** Classifies a device the way the dashboard counts it. */
export function fleetStatus(device: Device, position?: Position): FleetStatus {
  if (device.status !== 'online' || !position) return 'offline';
  const moving = position.attributes.motion ?? position.speed > MOVING_KNOTS;
  if (moving) return 'moving';
  return position.attributes.ignition ? 'idle' : 'stopped';
}

export const knotsToKmh = (knots: number) => knots * 1.852;

export const EVENT_LABEL: Record<string, string> = {
  deviceOnline: 'Device online',
  deviceOffline: 'Device offline',
  deviceUnknown: 'Status unknown',
  deviceInactive: 'Device inactive',
  deviceMoving: 'Device moving',
  deviceStopped: 'Device stopped',
  deviceOverspeed: 'Speed limit exceeded',
  deviceFuelDrop: 'Fuel drop',
  deviceFuelIncrease: 'Fuel increase',
  geofenceEnter: 'Geofence entered',
  geofenceExit: 'Geofence exited',
  alarm: 'Alarm',
  ignitionOn: 'Ignition on',
  ignitionOff: 'Ignition off',
  maintenance: 'Maintenance required',
  driverChanged: 'Driver changed',
  commandResult: 'Command result',
  textMessage: 'Text message',
  media: 'Media',
};

export const eventLabel = (type: string) => EVENT_LABEL[type] ?? type;
