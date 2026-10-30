import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { type Device, type Position, type TEvent, traccar } from '../api/traccar';

interface SocketMessage {
  devices?: Device[];
  positions?: Position[];
  events?: TEvent[];
}

const TRAIL_POINTS = 60;
/** Recent positions per device collected from the live feed, used to draw trails. */
export const trails = new Map<number, [number, number][]>();
type EventListener = (events: TEvent[]) => void;
const eventListeners = new Set<EventListener>();

/** Subscribe to live events pushed by Traccar (alarms, geofence, overspeed...). */
export function onLiveEvents(fn: EventListener): () => void {
  eventListeners.add(fn);
  return () => {
    eventListeners.delete(fn);
  };
}

function mergeById<T extends { id: number }>(list: T[] | undefined, updates: T[]) {
  const map = new Map((list ?? []).map((x) => [x.id, x]));
  updates.forEach((u) => map.set(u.id, u));
  return [...map.values()];
}

/**
 * Keeps the `devices` and `positions` queries current through Traccar's WebSocket.
 * Mount once (in the app shell); pages read the same query keys.
 */
export function useLiveSocket(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let closed = false;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${proto}://${window.location.host}/api/socket`);
      socket.onmessage = (msg) => {
        const data = JSON.parse(msg.data) as SocketMessage;
        if (data.devices?.length) qc.setQueryData<Device[]>(['devices'], (old) => mergeById(old, data.devices!));
        if (data.positions?.length) {
          qc.setQueryData<Position[]>(['positions'], (old) => {
            const byDevice = new Map((old ?? []).map((p) => [p.deviceId, p]));
            data.positions!.forEach((p) => byDevice.set(p.deviceId, p));
            return [...byDevice.values()];
          });
          data.positions.forEach((p) => {
            const t = trails.get(p.deviceId) ?? [];
            t.push([p.longitude, p.latitude]);
            if (t.length > TRAIL_POINTS) t.shift();
            trails.set(p.deviceId, t);
          });
        }
        if (data.events?.length) eventListeners.forEach((fn) => fn(data.events!));
      };
      socket.onclose = () => {
        if (!closed) retry = setTimeout(connect, 5000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, [enabled, qc]);
}

export const useDevices = () => useQuery({ queryKey: ['devices'], queryFn: traccar.devices, staleTime: 60_000 });
export const usePositions = () => useQuery({ queryKey: ['positions'], queryFn: traccar.positions, staleTime: 60_000 });
export const useGroups = () => useQuery({ queryKey: ['groups'], queryFn: traccar.groups, staleTime: 300_000 });
export const useDrivers = () => useQuery({ queryKey: ['drivers'], queryFn: traccar.drivers, staleTime: 300_000 });
export const useGeofences = () => useQuery({ queryKey: ['geofences'], queryFn: traccar.geofences, staleTime: 300_000 });

/** Maps a driver uniqueId (as reported by the device) to the driver's name. */
export function useDriverName() {
  const drivers = useDrivers();
  const byId = new Map(drivers.data?.map((d) => [d.uniqueId, d.name]));
  return (uniqueId: unknown) => (uniqueId ? (byId.get(String(uniqueId)) ?? String(uniqueId)) : '—');
}
