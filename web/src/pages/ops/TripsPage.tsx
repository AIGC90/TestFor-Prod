import AddIcon from '@mui/icons-material/Add';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  InputAdornment,
  LinearProgress,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { http } from '../../api/http';
import { traccar } from '../../api/traccar';
import { EntityForm, errorMessage, type Field, type Option } from '../../components/EntityPage';
import { useAccess } from '../../lib/access';
import { inr, num, partyOptions, StatusChip, useNames } from '../inventory/shared';

export interface Trip {
  id: number;
  tripNo: string;
  orderId: number | null;
  customerId: number | null;
  deviceId: number | null;
  vehicleNo: string;
  driverName: string;
  driverPhone: string;
  origin: string;
  destination: string;
  corridor: string | null;
  plannedKm: number | null;
  material: string | null;
  weightT: number | null;
  freight: number | null;
  lrNo: string | null;
  scheduledAt: string | null;
  plannedArrival: string | null;
  status: string;
  exceptionNote: string | null;
  podStatus: string;
  podReceivedBy: string | null;
  completedAt: string | null;
  // live fields
  travelledKm?: number | null;
  progressPct?: number | null;
  eta?: string | null;
  delayed?: boolean;
}

const deviceOptions = async (): Promise<Option[]> => (await traccar.devices()).map((d) => ({ value: d.id, label: d.name }));
const geofenceOptions = async (): Promise<Option[]> => (await traccar.geofences()).map((g) => ({ value: g.id, label: g.name }));
const orderOptions = async (): Promise<Option[]> =>
  (await http<{ id: number; orderNo: string; origin: string; destination: string; status: string }[]>('/erp/ops/orders?status=booked')).map((o) => ({
    value: o.id,
    label: `${o.orderNo} · ${o.origin} → ${o.destination}`,
  }));

const tripFields: Field[] = [
  { section: 'Customer & cargo', path: 'customerId', label: 'Customer', type: 'autocomplete', options: partyOptions('customer'), optionsKey: 'customer-options' },
  { section: 'Customer & cargo', path: 'orderId', label: 'Order (optional)', type: 'autocomplete', options: orderOptions, optionsKey: 'open-order-options' },
  { section: 'Customer & cargo', path: 'material', label: 'Cargo material' },
  { section: 'Customer & cargo', path: 'weightT', label: 'Weight (tonnes)', type: 'number' },
  { section: 'Vehicle & driver', path: 'deviceId', label: 'Vehicle (GPS tracked)', type: 'autocomplete', required: true, options: deviceOptions, optionsKey: 'device-options' },
  { section: 'Vehicle & driver', path: 'driverName', label: 'Driver', required: true },
  { section: 'Vehicle & driver', path: 'driverPhone', label: 'Driver mobile', required: true },
  { section: 'Vehicle & driver', path: 'lrNo', label: 'LR number' },
  { section: 'Route', path: 'origin', label: 'Origin / loading hub', required: true },
  { section: 'Route', path: 'destination', label: 'Destination / unloading hub', required: true },
  { section: 'Route', path: 'destGeofenceId', label: 'Destination geofence (auto-arrival)', type: 'select', options: geofenceOptions, optionsKey: 'geofence-options' },
  { section: 'Route', path: 'corridor', label: 'Highway corridor' },
  { section: 'Route', path: 'plannedKm', label: 'Distance (km)', type: 'number' },
  { section: 'Schedule & money', path: 'scheduledAt', label: 'Departure', type: 'datetime' },
  { section: 'Schedule & money', path: 'plannedArrival', label: 'Planned arrival', type: 'datetime' },
  { section: 'Schedule & money', path: 'freight', label: 'Freight (SAR)', type: 'number' },
  { section: 'Schedule & money', path: 'driverAdvance', label: 'Driver advance (SAR)', type: 'number' },
];

type View = 'open' | 'in_transit' | 'scheduled' | 'delayed' | 'arrived' | 'completed';

export function TripsPage() {
  const qc = useQueryClient();
  const n = useNames();
  const access = useAccess();
  const navigate = useNavigate();
  const [view, setView] = useState<View>('open');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [podFor, setPodFor] = useState<Trip | null>(null);
  const [pod, setPod] = useState({ receivedBy: '', remarks: '' });
  const live = useQuery({ queryKey: ['trips', 'live'], queryFn: () => http<Trip[]>('/erp/ops/trips-live'), refetchInterval: 30_000 });
  const completed = useQuery({ queryKey: ['trips', 'completed'], queryFn: () => http<Trip[]>('/erp/ops/trips?status=completed&limit=200'), enabled: view === 'completed' });
  const devices = useQuery({ queryKey: ['options', 'device-options'], queryFn: deviceOptions });
  const refresh = () => qc.invalidateQueries({ queryKey: ['trips'] });

  const create = useMutation({
    mutationFn: (v: Record<string, unknown>) => {
      const vehicleNo = devices.data?.find((d) => String(d.value) === String(v.deviceId))?.label;
      return http<Trip>('/erp/ops/trips', { method: 'POST', body: JSON.stringify({ ...v, vehicleNo }) });
    },
    onSuccess: () => setCreating(false),
    onSettled: refresh,
  });
  const act = useMutation({
    mutationFn: ({ id, action, body }: { id: number; action: string; body?: unknown }) =>
      http(`/erp/ops/trips/${id}/${action}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
    onSuccess: () => setPodFor(null),
    onSettled: refresh,
  });

  const open = live.data ?? [];
  const counts = {
    open: open.length,
    in_transit: open.filter((t) => t.status === 'in_transit').length,
    scheduled: open.filter((t) => t.status === 'scheduled').length,
    delayed: open.filter((t) => t.delayed).length,
    arrived: open.filter((t) => t.status === 'arrived').length,
  };
  const base = view === 'completed' ? (completed.data ?? []) : open.filter((t) => view === 'open' || (view === 'delayed' ? t.delayed : t.status === view));
  const q = search.trim().toLowerCase();
  const rows = base.filter((t) => !q || `${t.tripNo} ${t.vehicleNo} ${t.driverName} ${t.origin} ${t.destination} ${t.lrNo ?? ''} ${n.party(t.customerId)}`.toLowerCase().includes(q));
  const freightOnRoad = open.reduce((s, t) => s + (t.freight ?? 0), 0);
  const canEdit = access.can('trip', 'edit');

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
        <Box>
          <Typography variant="h5">Trip Dispatch Hub</Typography>
          <Typography color="text.secondary">Create and dispatch trips, follow them on GPS, and close them with proof of delivery.</Typography>
        </Box>
        {access.can('trip', 'create') && <Button variant="contained" startIcon={<AddIcon />} onClick={() => { create.reset(); setCreating(true); }}>Create trip</Button>}
      </Stack>

      <Grid container spacing={2}>
        {([
          ['Open trips', counts.open, `Freight ${inr(freightOnRoad)}`],
          ['On the road', counts.in_transit, 'Live GPS progress'],
          ['Delayed', counts.delayed, 'ETA after planned arrival'],
          ['Arrived, awaiting POD', counts.arrived, 'Verify delivery to close'],
          ['Scheduled', counts.scheduled, 'Not yet started'],
        ] as [string, number, string][]).map(([k, v, sub]) => (
          <Grid key={k} size={{ xs: 6, md: 2.4 }}>
            <Card sx={{ height: '100%' }}><CardContent><Typography variant="body2" color="text.secondary">{k}</Typography><Typography variant="h5">{v}</Typography><Typography variant="caption" color="text.secondary">{sub}</Typography></CardContent></Card>
          </Grid>
        ))}
      </Grid>

      <Card>
        <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { md: 'center' }, px: 2 }}>
          <Tabs value={view} onChange={(_, v) => setView(v)} variant="scrollable" allowScrollButtonsMobile>
            <Tab value="open" label={`All open (${counts.open})`} />
            <Tab value="in_transit" label={`In transit (${counts.in_transit})`} />
            <Tab value="delayed" label={`Delayed (${counts.delayed})`} />
            <Tab value="arrived" label={`Arrived (${counts.arrived})`} />
            <Tab value="scheduled" label={`Scheduled (${counts.scheduled})`} />
            <Tab value="completed" label="Completed" />
          </Tabs>
          <TextField
            size="small"
            placeholder="Search trip, vehicle, driver, customer, route…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ my: 1, minWidth: 300 }}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
          />
        </Stack>
      </Card>
      {act.isError && <Alert severity="error">{errorMessage(act.error)}</Alert>}

      <Card>
        <Table size="small">
          <TableHead>
            <TableRow>{['Trip & LR', 'Customer & cargo', 'Vehicle & driver', 'Route', 'Progress & ETA', 'Status', 'e-POD', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={8}><Typography color="text.secondary" sx={{ py: 2 }}>No trips here.</Typography></TableCell></TableRow>}
            {rows.map((t) => (
              <TableRow key={t.id} hover>
                <TableCell><b>{t.tripNo}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t.lrNo ?? 'No LR'}</Typography></TableCell>
                <TableCell>{n.party(t.customerId)}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{[t.material, t.weightT ? `${num(t.weightT)} t` : null].filter(Boolean).join(' · ') || '—'}</Typography></TableCell>
                <TableCell>{t.vehicleNo}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t.driverName} · {t.driverPhone}</Typography></TableCell>
                <TableCell>{t.origin} → {t.destination}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{[t.plannedKm ? `${num(t.plannedKm)} km` : null, t.corridor].filter(Boolean).join(' · ') || '—'}</Typography></TableCell>
                <TableCell sx={{ minWidth: 170 }}>
                  {t.progressPct !== null && t.progressPct !== undefined ? (
                    <>
                      <LinearProgress variant="determinate" value={t.progressPct} color={t.delayed ? 'error' : 'primary'} sx={{ height: 8, borderRadius: 4 }} />
                      <Typography variant="caption">{t.progressPct}%{t.travelledKm !== null && t.travelledKm !== undefined ? ` · ${num(t.travelledKm)} km` : ''}</Typography>
                      {t.eta && <Typography variant="caption" color={t.delayed ? 'error' : 'text.secondary'} sx={{ display: 'block' }}>ETA {dayjs(t.eta).format('D MMM, HH:mm')}{t.delayed ? ' · late' : ''}</Typography>}
                    </>
                  ) : (
                    <Typography variant="caption" color="text.secondary">{t.scheduledAt ? `Departs ${dayjs(t.scheduledAt).format('D MMM, HH:mm')}` : '—'}</Typography>
                  )}
                  {t.exceptionNote && <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>⚠ {t.exceptionNote}</Typography>}
                </TableCell>
                <TableCell>{t.delayed ? <Chip size="small" color="error" label="Delayed" /> : <StatusChip status={t.status} />}</TableCell>
                <TableCell>{t.podStatus === 'verified' ? <Chip size="small" color="success" label={`Verified · ${t.podReceivedBy}`} /> : <Chip size="small" variant="outlined" label="Pending" />}</TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  {t.deviceId && <Button size="small" onClick={() => navigate(`/map?device=${t.deviceId}`)}>Map</Button>}
                  {canEdit && t.status === 'scheduled' && <Button size="small" variant="contained" onClick={() => act.mutate({ id: t.id, action: 'start' })}>Start</Button>}
                  {canEdit && t.status === 'in_transit' && <Button size="small" onClick={() => act.mutate({ id: t.id, action: 'arrive' })}>Arrived</Button>}
                  {canEdit && (t.status === 'arrived' || t.status === 'in_transit') && (
                    <Button size="small" variant="contained" onClick={() => { act.reset(); setPod({ receivedBy: '', remarks: '' }); setPodFor(t); }}>POD</Button>
                  )}
                  {canEdit && !['completed', 'cancelled'].includes(t.status) && <Button size="small" color="inherit" onClick={() => window.confirm(`Cancel ${t.tripNo}?`) && act.mutate({ id: t.id, action: 'cancel' })}>Cancel</Button>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {creating && (
        <EntityForm
          title="Schedule & dispatch a trip"
          fields={tripFields}
          initial={{}}
          isNew
          onCancel={() => setCreating(false)}
          onSubmit={(v) => create.mutate(v)}
          busy={create.isPending}
          error={create.isError ? errorMessage(create.error) : null}
        />
      )}

      <Dialog open={Boolean(podFor)} onClose={() => setPodFor(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Proof of delivery · {podFor?.tripNo}</DialogTitle>
        <DialogContent>
          {act.isError && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage(act.error)}</Alert>}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Received by (name / designation)" required value={pod.receivedBy} onChange={(e) => setPod({ ...pod, receivedBy: e.target.value })} />
            <TextField label="Remarks (shortages, damage, seal no.)" multiline minRows={3} value={pod.remarks} onChange={(e) => setPod({ ...pod, remarks: e.target.value })} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPodFor(null)}>Cancel</Button>
          <Button variant="contained" disabled={!pod.receivedBy.trim() || act.isPending} onClick={() => podFor && act.mutate({ id: podFor.id, action: 'pod', body: pod })}>Verify delivery</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
