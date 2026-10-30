import { Box, Card, CardActionArea, CardContent, Chip, List, ListItem, ListItemText, Skeleton, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { Grid } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { traccar } from '../api/traccar';
import { useAuth } from '../auth/AuthProvider';
import { eventLabel, fleetStatus, type FleetStatus, knotsToKmh, STATUS_COLOR, STATUS_LABEL } from '../lib/fleet';

dayjs.extend(relativeTime);

const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
const PIE_COLORS = ['#0b5cad', '#f57c00', '#2e7d32', '#c62828', '#6a1b9a', '#00838f', '#9e9e9e'];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function Panel({ title, subtitle, children, action }: { title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
          <Box>
            <Typography variant="h6">{title}</Typography>
            {subtitle && <Typography variant="body2" color="text.secondary">{subtitle}</Typography>}
          </Box>
          {action}
        </Stack>
        {children}
      </CardContent>
    </Card>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [days, setDays] = useState(7);

  const devices = useQuery({ queryKey: ['devices'], queryFn: traccar.devices, refetchInterval: 15_000 });
  const positions = useQuery({ queryKey: ['positions'], queryFn: traccar.positions, refetchInterval: 15_000 });
  const ids = devices.data?.map((d) => d.id) ?? [];
  const from = dayjs().subtract(days - 1, 'day').startOf('day').toISOString();
  const to = dayjs().endOf('day').toISOString();

  const daily = useQuery({
    queryKey: ['summary-daily', days, ids.length],
    queryFn: () => traccar.summary(ids, from, to, true),
    enabled: ids.length > 0,
  });
  const totals = useQuery({
    queryKey: ['summary', days, ids.length],
    queryFn: () => traccar.summary(ids, from, to),
    enabled: ids.length > 0,
  });
  const events = useQuery({
    queryKey: ['events', days, ids.length],
    queryFn: () => traccar.events(ids, from, to),
    enabled: ids.length > 0,
    refetchInterval: 60_000,
  });

  const byStatus = useMemo(() => {
    const pos = new Map(positions.data?.map((p) => [p.deviceId, p]));
    const counts: Record<FleetStatus, number> = { moving: 0, idle: 0, stopped: 0, offline: 0 };
    devices.data?.forEach((d) => counts[fleetStatus(d, pos.get(d.id))]++);
    return counts;
  }, [devices.data, positions.data]);
  const total = devices.data?.length ?? 0;
  const online = total - byStatus.offline;

  const dayKeys = Array.from({ length: days }, (_, i) => dayjs(from).add(i, 'day').format('YYYY-MM-DD'));
  const distanceByDay = dayKeys.map((k) => ({
    day: dayjs(k).format(days > 14 ? 'D MMM' : 'ddd D'),
    km: (daily.data ?? []).filter((r) => dayjs(r.startTime).format('YYYY-MM-DD') === k).reduce((s, r) => s + r.distance / 1000, 0),
  }));
  const periodKm = distanceByDay.reduce((s, d) => s + d.km, 0);

  const t = totals.data ?? [];
  const engineHours = t.reduce((s, r) => s + r.engineHours, 0) / 3_600_000;
  const maxSpeed = Math.max(0, ...t.map((r) => r.maxSpeed));
  const moving = t.filter((r) => r.averageSpeed > 0);
  const avgSpeed = moving.length ? moving.reduce((s, r) => s + r.averageSpeed, 0) / moving.length : 0;
  const fuel = t.reduce((s, r) => s + (r.spentFuel ?? 0), 0);

  const ev = events.data ?? [];
  const alertsByDay = dayKeys.map((k) => ({
    day: dayjs(k).format(days > 14 ? 'D MMM' : 'ddd D'),
    alerts: ev.filter((e) => dayjs(e.eventTime).format('YYYY-MM-DD') === k).length,
  }));
  const byType = Object.entries(
    ev.reduce<Record<string, number>>((acc, e) => ((acc[e.type] = (acc[e.type] ?? 0) + 1), acc), {}),
  )
    .map(([type, count]) => ({ name: eventLabel(type), value: count }))
    .sort((a, b) => b.value - a.value);
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  ev.forEach((e) => {
    const d = dayjs(e.eventTime);
    heat[(d.day() + 6) % 7][d.hour()]++;
  });
  const heatMax = Math.max(1, ...heat.flat());

  const deviceName = new Map(devices.data?.map((d) => [d.id, d.name]));
  const recent = [...ev].sort((a, b) => b.eventTime.localeCompare(a.eventTime)).slice(0, 6);
  const top = [...t].sort((a, b) => b.distance - a.distance).slice(0, 6).map((r) => ({ name: r.deviceName, km: r.distance / 1000 }));
  const silent = (devices.data ?? [])
    .filter((d) => d.status !== 'online')
    .sort((a, b) => (a.lastUpdate ?? '').localeCompare(b.lastUpdate ?? ''));

  const loading = devices.isLoading || positions.isLoading;

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', gap: 2 }}>
        <Box>
          <Typography variant="body2" color="text.secondary">
            {greeting()}, {user?.name} · {dayjs().format('dddd, D MMMM')}
          </Typography>
          <Typography variant="h5">Fleet Dashboard</Typography>
        </Box>
        <ToggleButtonGroup size="small" exclusive value={days} onChange={(_, v) => v && setDays(v)}>
          {[7, 14, 30].map((d) => (
            <ToggleButton key={d} value={d}>{d} days</ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>

      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 2.4 }}>
          <Card sx={{ height: '100%' }}>
            <CardActionArea onClick={() => navigate('/map')} sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="body2" color="text.secondary">Total vehicles</Typography>
                <Typography variant="h4" sx={{ fontWeight: 700 }}>{loading ? <Skeleton width={40} /> : total}</Typography>
                <Typography variant="caption" color="text.secondary">{online} online now</Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        </Grid>
        {(['moving', 'offline', 'stopped', 'idle'] as FleetStatus[]).map((s) => (
          <Grid key={s} size={{ xs: 6, md: 2.4 }}>
            <Card sx={{ height: '100%', borderLeft: 4, borderLeftColor: STATUS_COLOR[s] }}>
              <CardActionArea onClick={() => navigate(`/map?status=${s}`)} sx={{ height: '100%' }}>
                <CardContent>
                  <Typography variant="body2" color="text.secondary">{STATUS_LABEL[s]}</Typography>
                  <Typography variant="h4" sx={{ fontWeight: 700 }}>{loading ? <Skeleton width={40} /> : byStatus[s]}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {total ? Math.round((byStatus[s] / total) * 100) : 0}% of fleet
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <Panel
            title="Distance travelled"
            subtitle={`Whole fleet, daily totals for the last ${days} days`}
            action={<Typography variant="h6">{nf1.format(periodKm)} km</Typography>}
          >
            <Box sx={{ height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={distanceByDay}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip formatter={(v) => `${nf.format(Number(v))} km`} />
                  <Bar dataKey="km" fill="#0b5cad" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Box>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 3, mt: 2 }}>
              {[
                ['Engine hours', `${nf1.format(engineHours)} h`],
                ['Average speed', `${nf.format(knotsToKmh(avgSpeed))} km/h`],
                ['Maximum speed', `${nf.format(knotsToKmh(maxSpeed))} km/h`],
                ['Fuel used', `${nf1.format(fuel)} L`],
                ['Events', nf.format(ev.length)],
              ].map(([k, v]) => (
                <Box key={k}>
                  <Typography variant="caption" color="text.secondary">{k}</Typography>
                  <Typography sx={{ fontWeight: 700 }}>{v}</Typography>
                </Box>
              ))}
            </Stack>
          </Panel>
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <Panel title="Fleet status" subtitle="Live, updates as vehicles report">
            <Box sx={{ height: 220 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={(Object.keys(byStatus) as FleetStatus[]).map((s) => ({ name: STATUS_LABEL[s], value: byStatus[s], s }))}
                    dataKey="value"
                    innerRadius={60}
                    outerRadius={90}
                  >
                    {(Object.keys(byStatus) as FleetStatus[]).map((s) => <Cell key={s} fill={STATUS_COLOR[s]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </Box>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, justifyContent: 'center' }}>
              {(Object.keys(byStatus) as FleetStatus[]).map((s) => (
                <Chip key={s} size="small" label={`${STATUS_LABEL[s]} ${byStatus[s]}`} sx={{ bgcolor: STATUS_COLOR[s], color: '#fff' }} />
              ))}
            </Stack>
          </Panel>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Panel title="Alerts per day" subtitle={`All event types, last ${days} days`}>
            <Box sx={{ height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={alertsByDay}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" fontSize={12} />
                  <YAxis fontSize={12} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="alerts" fill="#f57c00" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </Panel>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Panel title="Top vehicles by distance" subtitle="Most active vehicles this period">
            <Box sx={{ height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={top} layout="vertical" margin={{ left: 40 }}>
                  <XAxis type="number" fontSize={12} />
                  <YAxis type="category" dataKey="name" fontSize={12} width={110} />
                  <Tooltip formatter={(v) => `${nf.format(Number(v))} km`} />
                  <Bar dataKey="km" fill="#2e7d32" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </Panel>
        </Grid>

        <Grid size={{ xs: 12, md: 7 }}>
          <Panel title="Alert activity by hour" subtitle="When alerts happen across the week">
            <Box sx={{ overflowX: 'auto' }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: '36px repeat(24, minmax(14px, 1fr))', gap: '3px', minWidth: 420 }}>
                {heat.map((row, d) => [
                  <Typography key={`l${d}`} variant="caption" color="text.secondary">
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d]}
                  </Typography>,
                  ...row.map((v, h) => (
                    <Box
                      key={`${d}-${h}`}
                      title={`${v} alerts at ${String(h).padStart(2, '0')}:00`}
                      sx={{ height: 16, borderRadius: '3px', bgcolor: v ? `rgba(11,92,173,${0.15 + (0.85 * v) / heatMax})` : '#eef1f6' }}
                    />
                  )),
                ])}
              </Box>
            </Box>
          </Panel>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Panel title="Alerts by type" subtitle="What triggered alerts this period">
            <Box sx={{ height: 200 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={byType} dataKey="value" nameKey="name" outerRadius={80}>
                    {byType.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </Box>
          </Panel>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Panel title="Recent alerts" subtitle="Latest events across the fleet" action={<Chip label="View all" onClick={() => navigate('/notifications')} />}>
            <List dense disablePadding>
              {recent.length === 0 && <Typography color="text.secondary">No alerts in this period.</Typography>}
              {recent.map((e) => (
                <ListItem key={e.id} disableGutters divider>
                  <ListItemText primary={eventLabel(e.type)} secondary={deviceName.get(e.deviceId)} />
                  <Typography variant="caption" color="text.secondary">{dayjs(e.eventTime).fromNow()}</Typography>
                </ListItem>
              ))}
            </List>
          </Panel>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Panel title="Needs attention" subtitle={`${silent.length} vehicles not reporting · longest silent first`}>
            <List dense disablePadding>
              {silent.length === 0 && <Typography color="text.secondary">Every vehicle is reporting.</Typography>}
              {silent.slice(0, 6).map((d) => (
                <ListItem key={d.id} disableGutters divider>
                  <ListItemText primary={d.name} secondary={d.uniqueId} />
                  <Typography variant="caption" color="text.secondary">
                    {d.lastUpdate ? `Seen ${dayjs(d.lastUpdate).fromNow()}` : 'Never reported'}
                  </Typography>
                </ListItem>
              ))}
            </List>
          </Panel>
        </Grid>
      </Grid>
    </Stack>
  );
}
