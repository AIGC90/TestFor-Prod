import SearchIcon from '@mui/icons-material/Search';
import { Box, Button, Card, CardContent, Chip, InputAdornment, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useDevices, useGeofences } from '../lib/live';
import {
  CATEGORY_LABEL,
  eventCategory,
  eventTitle,
  NOTIFICATION_DAYS,
  type NotificationCategory,
  useNotifications,
} from '../lib/notifications';

const CATEGORY_COLOR: Record<NotificationCategory, 'error' | 'warning' | 'info' | 'secondary' | 'default'> = {
  critical: 'error',
  speed: 'warning',
  geofence: 'info',
  maintenance: 'secondary',
  status: 'default',
};

export function NotificationsPage() {
  const navigate = useNavigate();
  const { events, isRead, unreadCount, markRead, markUnread, loading } = useNotifications();
  const devices = useDevices();
  const geofences = useGeofences();
  const [tab, setTab] = useState<NotificationCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(50);

  const deviceName = new Map(devices.data?.map((d) => [d.id, d.name]));
  const geofenceName = new Map(geofences.data?.map((g) => [g.id, g.name]));
  const q = search.trim().toLowerCase();
  const filtered = events.filter(
    (e) =>
      (tab === 'all' || eventCategory(e.type) === tab) &&
      (!q || eventTitle(e).toLowerCase().includes(q) || (deviceName.get(e.deviceId) ?? '').toLowerCase().includes(q)),
  );
  const count = (c: NotificationCategory) => events.filter((e) => eventCategory(e.type) === c).length;

  function detail(e: (typeof events)[number]) {
    const vehicle = deviceName.get(e.deviceId) ?? `Device ${e.deviceId}`;
    if (e.geofenceId) return `${vehicle} · ${geofenceName.get(e.geofenceId) ?? 'geofence'}`;
    if (e.type === 'deviceOverspeed' && e.attributes.speed) {
      return `${vehicle} · ${Math.round(Number(e.attributes.speed) * 1.852)} km/h (limit ${Math.round(Number(e.attributes.speedLimit ?? 0) * 1.852)} km/h)`;
    }
    return vehicle;
  }

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
        <Box>
          <Typography variant="h5">Notifications Center</Typography>
          <Typography color="text.secondary">
            Alerts from the last {NOTIFICATION_DAYS} days · {unreadCount} unread
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={() => navigate('/settings/notifications')}>Alert rules</Button>
          <Button variant="contained" disabled={!unreadCount} onClick={() => markRead(filtered.filter((e) => !isRead(e.id)).map((e) => e.id))}>
            Mark all read
          </Button>
        </Stack>
      </Stack>

      <Card>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile>
          <Tab value="all" label={`All (${events.length})`} />
          {(Object.keys(CATEGORY_LABEL) as NotificationCategory[]).map((c) => (
            <Tab key={c} value={c} label={`${CATEGORY_LABEL[c]} (${count(c)})`} />
          ))}
        </Tabs>
      </Card>

      <TextField
        size="small"
        placeholder="Search alert or vehicle..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ maxWidth: 420 }}
        slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
      />

      {loading && <Typography color="text.secondary">Loading alerts…</Typography>}
      {!loading && filtered.length === 0 && <Typography color="text.secondary">No alerts in this category.</Typography>}

      <Stack spacing={1}>
        {filtered.slice(0, limit).map((e) => {
          const cat = eventCategory(e.type);
          const read = isRead(e.id);
          return (
            <Card key={e.id} sx={{ borderLeft: 4, borderLeftColor: read ? 'divider' : `${CATEGORY_COLOR[cat] === 'default' ? 'grey.500' : `${CATEGORY_COLOR[cat]}.main`}` }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 }, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                <Box sx={{ flexGrow: 1, minWidth: 220 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Typography sx={{ fontWeight: read ? 400 : 700 }}>{eventTitle(e)}</Typography>
                    <Chip size="small" label={CATEGORY_LABEL[cat]} color={CATEGORY_COLOR[cat]} variant="outlined" />
                  </Stack>
                  <Typography variant="body2" color="text.secondary">{detail(e)}</Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">{dayjs(e.eventTime).format('D MMM, HH:mm')}</Typography>
                <Button size="small" onClick={() => navigate(`/map?device=${e.deviceId}`)}>Map</Button>
                <Button size="small" onClick={() => (read ? markUnread([e.id]) : markRead([e.id]))}>
                  {read ? 'Mark unread' : 'Mark read'}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </Stack>
      {filtered.length > limit && (
        <Button onClick={() => setLimit((l) => l + 50)} sx={{ alignSelf: 'center' }}>
          Show more ({filtered.length - limit} left)
        </Button>
      )}
    </Stack>
  );
}
