import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { FleetMap, type MapLine, type MapPoint } from '../components/FleetMap';
import { fleetStatus, type FleetStatus, knotsToKmh, STATUS_COLOR, STATUS_LABEL } from '../lib/fleet';
import { trails, useDevices, useDriverName, usePositions } from '../lib/live';

dayjs.extend(relativeTime);

const FILTERS: (FleetStatus | 'all')[] = ['all', 'moving', 'idle', 'stopped', 'offline'];

export function MapPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const devices = useDevices();
  const positions = usePositions();
  const driverName = useDriverName();
  const [search, setSearch] = useState('');
  const filter = (params.get('status') as FleetStatus | null) ?? 'all';
  const selectedId = params.get('device') ? Number(params.get('device')) : null;

  const rows = useMemo(() => {
    const pos = new Map(positions.data?.map((p) => [p.deviceId, p]));
    return (devices.data ?? [])
      .map((d) => ({ device: d, position: pos.get(d.id), status: fleetStatus(d, pos.get(d.id)) }))
      .sort((a, b) => a.device.name.localeCompare(b.device.name));
  }, [devices.data, positions.data]);

  const counts = FILTERS.reduce<Record<string, number>>(
    (acc, f) => ((acc[f] = f === 'all' ? rows.length : rows.filter((r) => r.status === f).length), acc),
    {},
  );
  const q = search.trim().toLowerCase();
  const visible = rows.filter(
    (r) =>
      (filter === 'all' || r.status === filter) &&
      (!q || r.device.name.toLowerCase().includes(q) || r.device.uniqueId.includes(q) ||
        driverName(r.position?.attributes.driverUniqueId).toLowerCase().includes(q)),
  );

  const points: MapPoint[] = visible
    .filter((r) => r.position)
    .map((r) => ({
      id: r.device.id,
      lon: r.position!.longitude,
      lat: r.position!.latitude,
      label: r.device.name,
      color: STATUS_COLOR[r.status],
      course: r.position!.course,
    }));
  const lines: MapLine[] = visible
    .filter((r) => r.status === 'moving')
    .map((r) => ({ id: r.device.id, coords: trails.get(r.device.id) ?? [], color: STATUS_COLOR.moving }));

  const selected = rows.find((r) => r.device.id === selectedId);
  const select = (id: number | null) => {
    const next = new URLSearchParams(params);
    if (id === null) next.delete('device');
    else next.set('device', String(id));
    setParams(next, { replace: true });
  };

  return (
    <Box sx={{ display: 'flex', gap: 2, height: { xs: 'auto', md: 'calc(100vh - 112px)' }, flexDirection: { xs: 'column', md: 'row' } }}>
      <Card sx={{ width: { md: 340 }, flexShrink: 0, display: 'flex', flexDirection: 'column', maxHeight: { xs: 420, md: 'none' } }}>
        <CardContent sx={{ pb: 1 }}>
          <Typography variant="h6">Fleet devices ({rows.length})</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {rows.length - counts.offline} online · {counts.offline} offline
          </Typography>
          <TextField
            size="small"
            fullWidth
            placeholder="Search device, vehicle no. or driver..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
          />
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75, mt: 1.5 }}>
            {FILTERS.map((f) => (
              <Chip
                key={f}
                size="small"
                label={`${f === 'all' ? 'All' : STATUS_LABEL[f]} ${counts[f]}`}
                color={filter === f ? 'primary' : 'default'}
                variant={filter === f ? 'filled' : 'outlined'}
                onClick={() => {
                  const next = new URLSearchParams(params);
                  if (f === 'all') next.delete('status');
                  else next.set('status', f);
                  setParams(next, { replace: true });
                }}
              />
            ))}
          </Stack>
        </CardContent>
        <Divider />
        <List dense sx={{ overflowY: 'auto', flexGrow: 1 }}>
          {visible.map((r) => (
            <ListItemButton key={r.device.id} selected={r.device.id === selectedId} onClick={() => select(r.device.id)}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: STATUS_COLOR[r.status], mr: 1.5, flexShrink: 0 }} />
              <ListItemText
                primary={r.device.name}
                secondary={`${r.device.category ?? 'vehicle'} · ${r.device.uniqueId}`}
              />
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" sx={{ display: 'block', fontWeight: 600 }}>
                  {r.status === 'moving' ? `${Math.round(knotsToKmh(r.position!.speed))} km/h` : STATUS_LABEL[r.status]}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {r.device.lastUpdate ? dayjs(r.device.lastUpdate).fromNow(true) : 'never'}
                </Typography>
              </Box>
            </ListItemButton>
          ))}
          {visible.length === 0 && <Typography sx={{ p: 2 }} color="text.secondary">No vehicles match.</Typography>}
        </List>
      </Card>

      <Box sx={{ position: 'relative', flexGrow: 1, minHeight: { xs: 480, md: 0 } }}>
        <FleetMap
          points={points}
          lines={lines}
          selectedId={selectedId}
          onSelect={select}
          fitToPoints
          focus={selected?.position ? [selected.position.longitude, selected.position.latitude] : null}
        />
        {selected && (
          <Card sx={{ position: 'absolute', right: 12, bottom: 12, width: 320, maxWidth: 'calc(100% - 24px)' }} elevation={4}>
            <CardContent>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6">{selected.device.name}</Typography>
                <IconButton size="small" onClick={() => select(null)} aria-label="close">
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Stack>
              <Chip size="small" label={STATUS_LABEL[selected.status]} sx={{ bgcolor: STATUS_COLOR[selected.status], color: '#fff', mb: 1 }} />
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mt: 1 }}>
                {[
                  ['Speed', selected.position ? `${Math.round(knotsToKmh(selected.position.speed))} km/h` : '—'],
                  ['Ignition', selected.position?.attributes.ignition ? 'On' : 'Off'],
                  ['Fuel', selected.position?.attributes.fuel !== undefined ? `${selected.position.attributes.fuel}` : '—'],
                  ['Odometer', selected.position?.attributes.odometer ? `${Math.round(selected.position.attributes.odometer / 1000).toLocaleString('en-IN')} km` : '—'],
                  ['Driver', driverName(selected.position?.attributes.driverUniqueId)],
                  ['Model', selected.device.model ?? '—'],
                  ['IMEI', selected.device.uniqueId],
                  ['Last update', selected.device.lastUpdate ? dayjs(selected.device.lastUpdate).format('D MMM, HH:mm') : '—'],
                ].map(([k, v]) => (
                  <Box key={k}>
                    <Typography variant="caption" color="text.secondary">{k}</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: 'break-word' }}>{v}</Typography>
                  </Box>
                ))}
              </Box>
              {selected.position && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  {selected.position.address ?? `${selected.position.latitude.toFixed(5)}, ${selected.position.longitude.toFixed(5)}`}
                </Typography>
              )}
              <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                <Button size="small" variant="contained" onClick={() => navigate(`/replay?device=${selected.device.id}`)}>Replay</Button>
                <Button size="small" variant="outlined" onClick={() => navigate(`/reports/trips?device=${selected.device.id}`)}>Trips</Button>
                <Button size="small" onClick={() => navigate(`/devices?edit=${selected.device.id}`)}>Edit</Button>
              </Stack>
            </CardContent>
          </Card>
        )}
      </Box>
    </Box>
  );
}
