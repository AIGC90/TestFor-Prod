import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect } from 'react';
import { erp } from '../api/erp';
import { type TEvent, traccar } from '../api/traccar';
import { eventLabel } from './fleet';
import { onLiveEvents, useDevices } from './live';

export type NotificationCategory = 'critical' | 'speed' | 'geofence' | 'maintenance' | 'status';

export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  critical: 'Critical & SOS',
  speed: 'Speed & Driving',
  geofence: 'Geofences',
  maintenance: 'Maintenance',
  status: 'Vehicle status',
};

export function eventCategory(type: string): NotificationCategory {
  if (type === 'alarm') return 'critical';
  if (type === 'deviceOverspeed') return 'speed';
  if (type.startsWith('geofence')) return 'geofence';
  if (type === 'maintenance') return 'maintenance';
  return 'status';
}

const ALARM_LABEL: Record<string, string> = {
  sos: 'SOS panic button',
  accident: 'Accident / crash',
  powerCut: 'Main power disconnected',
  lowBattery: 'Low battery',
  tampering: 'Device tampering',
  hardBraking: 'Harsh braking',
  hardAcceleration: 'Harsh acceleration',
  hardCornering: 'Harsh cornering',
  fatigueDriving: 'Driver fatigue',
};

/** Human title for an event, including the alarm kind where present. */
export function eventTitle(e: TEvent) {
  if (e.type === 'alarm') {
    const kind = String(e.attributes.alarm ?? '');
    return ALARM_LABEL[kind] ?? `Alarm${kind ? `: ${kind}` : ''}`;
  }
  return eventLabel(e.type);
}

export const NOTIFICATION_DAYS = 7;

/** Events of the last week for every device, newest first, kept fresh by the live feed. */
export function useNotifications() {
  const qc = useQueryClient();
  const devices = useDevices();
  const ids = devices.data?.map((d) => d.id) ?? [];
  const events = useQuery({
    queryKey: ['notifications', ids.length],
    queryFn: async () => {
      const from = dayjs().subtract(NOTIFICATION_DAYS, 'day').toISOString();
      const list = await traccar.events(ids, from, dayjs().add(1, 'minute').toISOString());
      return list.sort((a, b) => b.eventTime.localeCompare(a.eventTime));
    },
    enabled: ids.length > 0,
    refetchInterval: 120_000,
  });
  const eventIds = events.data?.map((e) => e.id) ?? [];
  const read = useQuery({
    queryKey: ['notification-reads', eventIds.length, eventIds[0]],
    queryFn: () => erp.readEvents(eventIds),
    enabled: eventIds.length > 0,
  });

  useEffect(
    () =>
      onLiveEvents(() => {
        void qc.invalidateQueries({ queryKey: ['notifications'] });
      }),
    [qc],
  );

  const readSet = new Set(read.data ?? []);
  const mark = useMutation({
    mutationFn: ({ ids: list, asRead }: { ids: number[]; asRead: boolean }) => (asRead ? erp.markRead(list) : erp.markUnread(list)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-reads'] }),
  });

  return {
    events: events.data ?? [],
    loading: events.isLoading,
    isRead: (id: number) => readSet.has(id),
    unreadCount: (events.data ?? []).filter((e) => !readSet.has(e.id)).length,
    markRead: (list: number[]) => mark.mutate({ ids: list, asRead: true }),
    markUnread: (list: number[]) => mark.mutate({ ids: list, asRead: false }),
  };
}
