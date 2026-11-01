import CallOutlined from '@mui/icons-material/CallOutlined';
import CameraAltOutlined from '@mui/icons-material/CameraAltOutlined';
import MapOutlined from '@mui/icons-material/MapOutlined';
import VideocamOffOutlined from '@mui/icons-material/VideocamOffOutlined';
import { Alert, Box, Button, Card, CardContent, Chip, Grid, List, ListItemButton, ListItemText, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { http } from '../../api/http';
import { type Device, type Position, traccar } from '../../api/traccar';
import { errorMessage } from '../../components/EntityPage';
import { eventLabel, fleetStatus, knotsToKmh, STATUS_COLOR, STATUS_LABEL } from '../../lib/fleet';
import { useDevices, useDriverName, usePositions } from '../../lib/live';

/** ADAS (road-facing) and DMS (driver-facing) alarms that video telematics devices report through Traccar. */
export const CAMERA_ALARMS = ['fatigueDriving', 'laneChange', 'hardBraking', 'hardAcceleration', 'hardCornering', 'accident', 'sos', 'tampering'];
const ALARM_LABEL: Record<string, string> = {
  fatigueDriving: 'Fatigue / drowsiness (DMS)',
  laneChange: 'Lane departure (ADAS)',
  hardBraking: 'Harsh braking',
  hardAcceleration: 'Harsh acceleration',
  hardCornering: 'Harsh cornering',
  accident: 'Collision',
  sos: 'Panic button',
  tampering: 'Camera covered / tampering',
};

interface CamConfig { configured: boolean; channels: { id: number; name: string }[] }

function Stream({ device, channel, name, configured }: { device: Device; channel: number; name: string; configured: boolean }) {
  const stream = useQuery({
    queryKey: ['dashcam-stream', device.id, channel],
    queryFn: () => http<{ url: string }>(`/erp/dashcam/stream?deviceId=${device.id}&channel=${channel}`),
    enabled: configured && device.status === 'online',
    retry: false,
  });
  return (
    <Box sx={{ position: 'relative', bgcolor: '#111', borderRadius: 1, aspectRatio: '16 / 9', overflow: 'hidden', color: '#fff' }}>
      {stream.data ? (
        <video src={stream.data.url} autoPlay muted playsInline controls style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <Stack sx={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', p: 2, textAlign: 'center' }} spacing={1}>
          <VideocamOffOutlined />
          <Typography variant="body2">
            {!configured ? 'No video media server is connected. Set DASHCAM_STREAM_URL on the API server.' : device.status !== 'online' ? 'Camera offline' : stream.isError ? errorMessage(stream.error) : 'Connecting…'}
          </Typography>
        </Stack>
      )}
      <Stack direction="row" spacing={1} sx={{ position: 'absolute', top: 8, left: 8 }}>
        <Chip size="small" label={name} sx={{ bgcolor: 'rgba(0,0,0,.6)', color: '#fff' }} />
        {stream.data && <Chip size="small" color="error" label="LIVE" />}
      </Stack>
    </Box>
  );
}

export function DashcamPage() {
  const navigate = useNavigate();
  const devices = useDevices();
  const positions = usePositions();
  const driverName = useDriverName();
  const cfg = useQuery({ queryKey: ['dashcam-config'], queryFn: () => http<CamConfig>('/erp/dashcam/config'), staleTime: Infinity }).data;
  const [filter, setFilter] = useState<'all' | 'online' | 'offline'>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [view, setView] = useState<'split' | 'front' | 'driver'>('split');
  const [tab, setTab] = useState(0);

  const posBy = useMemo(() => new Map((positions.data ?? []).map((p) => [p.deviceId, p])), [positions.data]);
  const all = devices.data ?? [];
  const list = all.filter((d) => (filter === 'all' || (filter === 'online' ? d.status === 'online' : d.status !== 'online')) && d.name.toLowerCase().includes(search.toLowerCase()));
  const device = all.find((d) => d.id === (selected ?? list[0]?.id));
  const pos: Position | undefined = device ? posBy.get(device.id) : undefined;
  const from = dayjs().subtract(7, 'day').toISOString();
  const to = dayjs().toISOString();
  const events = useQuery({
    queryKey: ['dashcam-events', device?.id],
    queryFn: () => traccar.events([device!.id], from, to, ['alarm', 'media']),
    enabled: !!device,
  });
  const alerts = (events.data ?? []).filter((e) => e.type === 'alarm' && CAMERA_ALARMS.includes(String(e.attributes.alarm)));
  const media = (events.data ?? []).filter((e) => e.type === 'media');
  const snapshot = useMutation({ mutationFn: () => http('/api/commands/send', { method: 'POST', body: JSON.stringify({ deviceId: device!.id, type: 'requestPhoto', attributes: {} }) }) });

  const counts = { all: all.length, online: all.filter((d) => d.status === 'online').length, offline: all.filter((d) => d.status !== 'online').length };
  const channels = cfg?.channels ?? [{ id: 1, name: 'Front camera' }, { id: 2, name: 'Driver camera' }];
  const shown = view === 'split' ? channels : channels.filter((c) => (view === 'front' ? c.id === 1 : c.id === 2));
  const phone = device?.phone || device?.contact;

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5">Dashcam Streams</Typography>
        <Typography color="text.secondary">Live front and driver cameras, recordings, and ADAS / DMS alerts from video telematics devices.</Typography>
      </Box>
      {cfg && !cfg.configured && <Alert severity="info">Video needs a JT/T 1078 (or vendor) media server. Alerts and snapshots below work through Traccar already; set DASHCAM_STREAM_URL to show live video.</Alert>}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 3 }}>
          <Card>
            <CardContent sx={{ pb: 1 }}>
              <ToggleButtonGroup size="small" exclusive fullWidth value={filter} onChange={(_, v) => v && setFilter(v)}>
                <ToggleButton value="all">All {counts.all}</ToggleButton>
                <ToggleButton value="online">Online {counts.online}</ToggleButton>
                <ToggleButton value="offline">Offline {counts.offline}</ToggleButton>
              </ToggleButtonGroup>
              <TextField size="small" fullWidth placeholder="Search vehicle" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ mt: 1 }} />
            </CardContent>
            <List dense sx={{ maxHeight: 560, overflow: 'auto' }}>
              {list.map((d) => {
                const st = fleetStatus(d, posBy.get(d.id));
                return (
                  <ListItemButton key={d.id} selected={d.id === device?.id} onClick={() => setSelected(d.id)}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: STATUS_COLOR[st], mr: 1.5, flexShrink: 0 }} />
                    <ListItemText primary={d.name} secondary={`${STATUS_LABEL[st]} · ${d.lastUpdate ? dayjs(d.lastUpdate).format('D MMM HH:mm') : 'never'}`} />
                  </ListItemButton>
                );
              })}
            </List>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 9 }}>
          {device && (
            <Stack spacing={2}>
              <Card>
                <CardContent>
                  <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
                    <Box>
                      <Typography variant="h6">{device.name}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {[pos?.attributes.driverUniqueId ? `Driver ${driverName(pos.attributes.driverUniqueId)}` : null, device.lastUpdate ? `last seen ${dayjs(device.lastUpdate).format('D MMM HH:mm')}` : null, pos ? `${pos.latitude.toFixed(5)}, ${pos.longitude.toFixed(5)}` : null, pos ? `${Math.round(knotsToKmh(pos.speed))} km/h` : null, pos?.attributes.totalDistance !== undefined ? `${Math.round(Number(pos.attributes.totalDistance) / 1000).toLocaleString('en-IN')} km` : null, pos?.attributes.power !== undefined ? `power ${Number(pos.attributes.power).toFixed(1)} V` : null].filter(Boolean).join(' · ')}
                      </Typography>
                    </Box>
                    <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
                      <ToggleButton value="split">Split view</ToggleButton>
                      <ToggleButton value="front">Front cam</ToggleButton>
                      <ToggleButton value="driver">Driver cam</ToggleButton>
                    </ToggleButtonGroup>
                  </Stack>
                  <Grid container spacing={1.5} sx={{ mt: 1 }}>
                    {shown.map((c) => (
                      <Grid key={c.id} size={{ xs: 12, md: shown.length > 1 ? 6 : 12 }}>
                        <Stream device={device} channel={c.id} name={c.name} configured={!!cfg?.configured} />
                      </Grid>
                    ))}
                  </Grid>
                  <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', gap: 1 }}>
                    <Button size="small" startIcon={<CameraAltOutlined />} onClick={() => snapshot.mutate()} disabled={snapshot.isPending || device.status !== 'online'}>Snapshot</Button>
                    <Button size="small" startIcon={<CallOutlined />} href={phone ? `tel:${phone}` : undefined} disabled={!phone}>Call {phone ? 'driver' : '(no phone on device)'}</Button>
                    <Button size="small" startIcon={<MapOutlined />} onClick={() => navigate(`/map?deviceId=${device.id}`)}>Map view</Button>
                  </Stack>
                  {snapshot.isError && <Alert severity="warning" sx={{ mt: 1 }} onClose={() => snapshot.reset()}>{errorMessage(snapshot.error)}. The device may not support photo requests.</Alert>}
                  {snapshot.isSuccess && <Alert severity="success" sx={{ mt: 1 }} onClose={() => snapshot.reset()}>Snapshot requested. It appears under Recordings when the device uploads it.</Alert>}
                </CardContent>
              </Card>
              <Card>
                <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 2 }}>
                  <Tab label={`Alerts (${alerts.length})`} />
                  <Tab label={`Recordings (${media.length})`} />
                </Tabs>
                <Table size="small">
                  <TableHead><TableRow>{(tab === 0 ? ['When', 'Alert', 'Severity'] : ['When', 'File', '']).map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
                  <TableBody>
                    {tab === 0 && alerts.length === 0 && <TableRow><TableCell colSpan={3}><Typography color="text.secondary">No ADAS or DMS alerts in the last 7 days.</Typography></TableCell></TableRow>}
                    {tab === 0 &&
                      alerts.map((e) => {
                        const a = String(e.attributes.alarm);
                        return (
                          <TableRow key={e.id} hover>
                            <TableCell>{dayjs(e.eventTime).format('D MMM HH:mm:ss')}</TableCell>
                            <TableCell>{ALARM_LABEL[a] ?? eventLabel(a)}</TableCell>
                            <TableCell><Chip size="small" label={['accident', 'sos', 'fatigueDriving'].includes(a) ? 'High' : 'Medium'} color={['accident', 'sos', 'fatigueDriving'].includes(a) ? 'error' : 'warning'} /></TableCell>
                          </TableRow>
                        );
                      })}
                    {tab === 1 && media.length === 0 && <TableRow><TableCell colSpan={3}><Typography color="text.secondary">No photos or clips uploaded in the last 7 days.</Typography></TableCell></TableRow>}
                    {tab === 1 &&
                      media.map((e) => {
                        const file = String(e.attributes.media ?? '');
                        return (
                          <TableRow key={e.id} hover>
                            <TableCell>{dayjs(e.eventTime).format('D MMM HH:mm:ss')}</TableCell>
                            <TableCell>{file}</TableCell>
                            <TableCell align="right"><Button size="small" href={`/api/media/${encodeURIComponent(device.uniqueId)}/${encodeURIComponent(file)}`} target="_blank" rel="noreferrer">Open</Button></TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </Card>
            </Stack>
          )}
        </Grid>
      </Grid>
    </Stack>
  );
}
