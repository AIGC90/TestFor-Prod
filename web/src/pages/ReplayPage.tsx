import FastForward from '@mui/icons-material/FastForward';
import Pause from '@mui/icons-material/Pause';
import PlayArrow from '@mui/icons-material/PlayArrow';
import { Alert, Autocomplete, Box, Button, Card, CardContent, IconButton, Slider, Stack, TextField, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { traccar } from '../api/traccar';
import { FleetMap } from '../components/FleetMap';
import { type Period, PeriodPicker, resolvePeriod } from '../components/PeriodPicker';
import { knotsToKmh } from '../lib/fleet';
import { useDevices } from '../lib/live';

const SPEEDS = [1, 2, 5, 10];

export function ReplayPage() {
  const [params] = useSearchParams();
  const devices = useDevices();
  const [deviceId, setDeviceId] = useState<number | null>(params.get('device') ? Number(params.get('device')) : null);
  const [period, setPeriod] = useState<Period>(() => resolvePeriod('today'));
  const [request, setRequest] = useState<{ deviceId: number; period: Period } | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const route = useQuery({
    queryKey: ['route', request],
    queryFn: () => traccar.route(request!.deviceId, request!.period.from, request!.period.to),
    enabled: request !== null,
  });
  const points = useMemo(() => route.data ?? [], [route.data]);

  useEffect(() => {
    setIndex(0);
    setPlaying(false);
  }, [points]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setIndex((i) => {
        if (i >= points.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 500 / speed);
    return () => clearInterval(t);
  }, [playing, speed, points.length]);

  const current = points[index];
  const device = devices.data?.find((d) => d.id === deviceId) ?? null;
  const coords = useMemo(() => points.map((p) => [p.longitude, p.latitude] as [number, number]), [points]);
  const routeLines = useMemo(() => [{ id: 'route', coords, color: '#0b5cad' }], [coords]);
  const distanceKm = points.length > 1
    ? ((points.at(-1)!.attributes.totalDistance ?? 0) - (points[0].attributes.totalDistance ?? 0)) / 1000
    : 0;

  return (
    <Stack spacing={2}>
      <Typography variant="h5">Route Replay</Typography>
      <Card>
        <CardContent>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' } }}>
            <Autocomplete
              size="small"
              sx={{ minWidth: 260 }}
              options={devices.data ?? []}
              getOptionLabel={(d) => d.name}
              value={device}
              onChange={(_, d) => setDeviceId(d?.id ?? null)}
              renderInput={(p) => <TextField {...p} label="Vehicle" />}
            />
            <PeriodPicker value={period} onChange={setPeriod} />
            <Button variant="contained" disabled={!deviceId} onClick={() => deviceId && setRequest({ deviceId, period })}>
              Show
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {route.isSuccess && points.length === 0 && <Alert severity="info">No positions recorded for this vehicle in the selected period.</Alert>}
      {route.isError && <Alert severity="error">Could not load the route.</Alert>}

      <Box sx={{ height: { xs: 420, md: 'calc(100vh - 330px)' }, minHeight: 360 }}>
        <FleetMap
          lines={routeLines}
          points={current ? [{ id: 0, lon: current.longitude, lat: current.latitude, label: device?.name ?? '', color: '#f57c00' }] : []}
          fitToLines
        />
      </Box>

      {points.length > 0 && (
        <Card>
          <CardContent>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <IconButton onClick={() => setPlaying((p) => !p)} color="primary" aria-label={playing ? 'pause' : 'play'}>
                {playing ? <Pause /> : <PlayArrow />}
              </IconButton>
              <Button size="small" startIcon={<FastForward />} onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}>
                {speed}×
              </Button>
              <Slider value={index} min={0} max={points.length - 1} onChange={(_, v) => setIndex(v as number)} sx={{ mx: 2 }} />
            </Stack>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 3, mt: 1 }}>
              {[
                ['Time', dayjs(current.fixTime).format('D MMM YYYY, HH:mm:ss')],
                ['Speed', `${Math.round(knotsToKmh(current.speed))} km/h`],
                ['Ignition', current.attributes.ignition ? 'On' : 'Off'],
                ['Point', `${index + 1} / ${points.length}`],
                ['Route distance', `${distanceKm.toFixed(1)} km`],
                ['Location', current.address ?? `${current.latitude.toFixed(5)}, ${current.longitude.toFixed(5)}`],
              ].map(([k, v]) => (
                <Box key={k}>
                  <Typography variant="caption" color="text.secondary">{k}</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{v}</Typography>
                </Box>
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}
