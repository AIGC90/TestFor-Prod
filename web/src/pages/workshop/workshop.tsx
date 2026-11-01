import { Alert, Box, Button, Card, CardContent, Chip, Grid, List, ListItem, ListItemText, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { http } from '../../api/http';
import { traccar } from '../../api/traccar';
import { EntityForm, EntityPage, type EntityConfig, errorMessage, type Field, type Option } from '../../components/EntityPage';
import { useFormDialog } from '../../components/useFormDialog';
import { AttachmentsDialog } from '../../components/Attachments';
import { useAccess } from '../../lib/access';
import { inr, itemOptions, num, partyOptions, StatusChip, storeOptions, useNames } from '../inventory/shared';

const post = (url: string, body?: unknown) => http(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const date = (v: string | null | undefined) => (v ? dayjs(v).format('D MMM YYYY') : '—');
const opts = (pairs: [string, string][]): Option[] => pairs.map(([value, label]) => ({ value, label }));
export const vehicleOptions = async (): Promise<Option[]> => (await traccar.devices()).map((d) => ({ value: d.name, label: d.name }));
const vehicleField = (required = true): Field => ({ path: 'vehicleNo', label: 'Vehicle', type: 'autocomplete', required, options: vehicleOptions, optionsKey: 'vehicle-name-options' });
const JOB_TYPES = opts([['own_workshop', 'Own workshop'], ['market_garage', 'Market garage'], ['amc', 'AMC']]);
const PIE = ['#0b5cad', '#f57c00', '#2e7d32', '#6a1b9a', '#c62828', '#00838f'];
const useMeta = () => useQuery({ queryKey: ['workshop-meta'], queryFn: () => http<{ serviceTypes: string[]; tools: string[] }>('/erp/workshop/meta'), staleTime: Infinity });

/* --------------------------------------------------------------- hub */

interface Summary {
  openJobs: number;
  inProgress: number;
  awaitingSpares: number;
  agingOver7Days: number;
  pmOverdue: number;
  pmDueSoon: number;
  gatePassesOut: number;
  gatePassesOverdue: number;
  owedToGarages: number;
  unpaidBills: number;
  closed: number;
  spend: number;
  partsSpend: number;
  labourSpend: number;
  avgTurnaroundDays: number | null;
  openByService: { name: string; value: number }[];
  spendByJobType: { name: string; value: number }[];
  costliestVehicles: { vehicleNo: string; cards: number; spend: number }[];
  pmNext: { id: number; vehicleNo: string; task: string; status: string; kmLeft: number | null; daysLeft: number | null }[];
  openJobList: { id: number; jcNo: string; vehicleNo: string; serviceType: string; status: string; openedAt: string }[];
}

export function WorkshopHubPage() {
  const navigate = useNavigate();
  const [days, setDays] = useState(30);
  const s = useQuery({ queryKey: ['workshop-summary', days], queryFn: () => http<Summary>(`/erp/workshop/summary?days=${days}`) }).data;
  const kpis: [string, string, string][] = s
    ? [
        ['Open job cards', num(s.openJobs), `${s.inProgress} in progress, ${s.awaitingSpares} awaiting spares`],
        ['Ageing > 7 days', num(s.agingOver7Days), 'Still open after a week'],
        ['PM overdue', num(s.pmOverdue), `${s.pmDueSoon} due soon`],
        ['Gate passes out', num(s.gatePassesOut), `${s.gatePassesOverdue} past return date`],
        ['Owed to garages', inr(s.owedToGarages), `${s.unpaidBills} unpaid bills`],
        ['Spend', inr(s.spend), `${s.closed} closed · ${s.avgTurnaroundDays ?? '—'} days avg turnaround`],
      ]
    : [];
  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
        <Box>
          <Typography variant="h5">Workshop</Typography>
          <Typography color="text.secondary">Job cards, preventive maintenance, gate passes and garage bills.</Typography>
        </Box>
        <ToggleButtonGroup size="small" exclusive value={days} onChange={(_, v) => v && setDays(v)}>
          {[7, 30, 90].map((d) => <ToggleButton key={d} value={d}>{d} days</ToggleButton>)}
        </ToggleButtonGroup>
      </Stack>
      <Grid container spacing={2}>
        {kpis.map(([k, v, sub]) => (
          <Grid key={k} size={{ xs: 6, md: 2 }}>
            <Card sx={{ height: '100%' }}><CardContent><Typography variant="body2" color="text.secondary">{k}</Typography><Typography variant="h6">{v}</Typography><Typography variant="caption" color="text.secondary">{sub}</Typography></CardContent></Card>
          </Grid>
        ))}
      </Grid>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6">Spend by job type</Typography>
              <Typography variant="body2" color="text.secondary">Parts {inr(s?.partsSpend)} · labour {inr(s?.labourSpend)}</Typography>
              <Box sx={{ height: 200 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={s?.spendByJobType.map((x) => ({ ...x, name: JOB_TYPES.find((j) => j.value === x.name)?.label ?? x.name })) ?? []} dataKey="value" nameKey="name" outerRadius={75} label>
                      {(s?.spendByJobType ?? []).map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => inr(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6">Costliest vehicles</Typography>
              <List dense>
                {s?.costliestVehicles.length === 0 && <Typography color="text.secondary">No closed jobs in this period.</Typography>}
                {s?.costliestVehicles.map((v) => (
                  <ListItem key={v.vehicleNo} disableGutters divider><ListItemText primary={v.vehicleNo} secondary={`${v.cards} job cards`} /><b>{inr(v.spend)}</b></ListItem>
                ))}
              </List>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6">Maintenance due next</Typography>
              <List dense>
                {s?.pmNext.length === 0 && <Typography color="text.secondary">Nothing overdue or due soon.</Typography>}
                {s?.pmNext.map((p) => (
                  <ListItem key={p.id} disableGutters divider>
                    <ListItemText primary={`${p.vehicleNo} · ${p.task}`} secondary={[p.kmLeft !== null ? `${num(p.kmLeft)} km` : null, p.daysLeft !== null ? `${p.daysLeft} days` : null].filter(Boolean).join(' · ')} />
                    <StatusChip status={p.status === 'overdue' ? 'overdue' : 'pending_approval'} />
                  </ListItem>
                ))}
              </List>
              <Button size="small" onClick={() => navigate('/pm-schedules')}>See all</Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      <Card>
        <CardContent><Typography variant="h6">Open job cards</Typography></CardContent>
        <Table size="small">
          <TableHead><TableRow>{['Job card', 'Vehicle', 'Service', 'Opened', 'Status'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
          <TableBody>
            {s?.openJobList.map((j) => (
              <TableRow key={j.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate('/job-cards')}>
                <TableCell>{j.jcNo}</TableCell><TableCell>{j.vehicleNo}</TableCell><TableCell>{j.serviceType}</TableCell><TableCell>{dayjs(j.openedAt).format('D MMM')}</TableCell><TableCell><StatusChip status={j.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </Stack>
  );
}

/* ---------------------------------------------------------- job cards */

interface JobCard {
  id: number;
  jcNo: string;
  vehicleNo: string;
  driverName: string | null;
  jobType: string;
  serviceType: string;
  storeId: number | null;
  partyId: number | null;
  runningKm: number | null;
  problem: string;
  priority: string;
  estimatedCost: number | null;
  labourCost: number;
  partsCost: number;
  parts: { itemId: number; qty: number }[];
  status: string;
  workDone: string | null;
  openedAt: string;
}

export function JobCardsPage() {
  const n = useNames();
  const access = useAccess();
  const meta = useMeta();
  const [dialog, ask] = useFormDialog();
  const edit = access.can('job_card', 'edit');
  const config: EntityConfig<JobCard> = {
    title: 'Job Cards',
    singular: 'job card',
    subtitle: 'Vehicle visits to the own workshop, a market garage or an AMC provider.',
    endpoint: '/erp/workshop/job-cards',
    queryKey: 'job-cards',
    docType: 'job_card',
    defaults: { jobType: 'own_workshop', priority: 'normal', labourCost: 0 },
    searchText: (j) => `${j.jcNo} ${j.vehicleNo} ${j.driverName ?? ''} ${j.serviceType} ${j.problem}`,
    canEditRow: (j) => !['completed', 'cancelled'].includes(j.status),
    columns: [
      { label: 'Job card', render: (j) => <Box><b>{j.jcNo}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{date(j.openedAt)}</Typography></Box>, csv: (j) => j.jcNo },
      { label: 'Vehicle', render: (j) => <Box>{j.vehicleNo}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{j.driverName ?? ''}</Typography></Box>, csv: (j) => j.vehicleNo },
      { label: 'Where', render: (j) => <Box>{JOB_TYPES.find((t) => t.value === j.jobType)?.label}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{j.partyId ? n.party(j.partyId) : ''}</Typography></Box>, csv: (j) => j.jobType },
      { label: 'Service & problem', render: (j) => <Box>{j.serviceType}{j.priority === 'high' && <Chip size="small" color="error" label="High" sx={{ ml: 1 }} />}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{j.problem}</Typography></Box>, csv: (j) => `${j.serviceType}: ${j.problem}` },
      { label: 'Cost', render: (j) => <Box>{inr(j.partsCost + j.labourCost)}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>est. {inr(j.estimatedCost)}</Typography></Box>, csv: (j) => j.partsCost + j.labourCost },
      { label: 'Status', render: (j) => <StatusChip status={j.status} />, csv: (j) => j.status },
    ],
    fields: [
      { section: 'Vehicle', ...vehicleField() },
      { section: 'Vehicle', path: 'driverName', label: 'Driver' },
      { section: 'Vehicle', path: 'runningKm', label: 'Running km', type: 'number' },
      { section: 'Vehicle', path: 'inspectedBy', label: 'Inspected by' },
      { section: 'Job', path: 'jobType', label: 'Job type', type: 'select', required: true, options: JOB_TYPES },
      { section: 'Job', path: 'serviceType', label: 'Service type', type: 'select', required: true, options: (meta.data?.serviceTypes ?? []).map((s) => ({ value: s, label: s })) },
      { section: 'Job', path: 'partyId', label: 'Garage / AMC provider', type: 'autocomplete', options: partyOptions('garage'), optionsKey: 'garage-options', visible: (v) => v.jobType !== 'own_workshop' },
      { section: 'Job', path: 'storeId', label: 'Parts from store', type: 'select', options: storeOptions, optionsKey: 'store-options' },
      { section: 'Job', path: 'priority', label: 'Priority', type: 'select', options: opts([['normal', 'Normal'], ['high', 'High']]) },
      { section: 'Job', path: 'estimatedCost', label: 'Estimated cost (₹)', type: 'number', helper: 'Decides whether approval is needed' },
      { section: 'Job', path: 'problem', label: 'Problem / work requested', type: 'textarea', required: true },
    ],
    rowActions: (j, run) => (
      <>
        {['draft', 'rejected'].includes(j.status) && access.can('job_card', 'create') && <Button size="small" onClick={() => run(() => post(`/erp/workshop/job-cards/${j.id}/submit`))}>Submit</Button>}
        {edit && ['open', 'awaiting_spares'].includes(j.status) && <Button size="small" onClick={() => run(() => post(`/erp/workshop/job-cards/${j.id}/start`))}>Start</Button>}
        {edit && ['open', 'in_progress', 'awaiting_spares'].includes(j.status) && (
          <>
            <Button
              size="small"
              onClick={async () => {
                const v = await ask({
                  title: `Issue parts to ${j.vehicleNo}`,
                  initial: { storeId: j.storeId ?? '', lines: [] },
                  fields: [
                    { path: 'storeId', label: 'From store', type: 'select', required: true, options: storeOptions, optionsKey: 'store-options' },
                    { path: 'lines', label: 'Parts', type: 'lines', newLine: { qty: 1 }, lineFields: [{ path: 'itemId', label: 'Item', type: 'autocomplete', required: true, options: itemOptions, optionsKey: 'item-options', fullWidth: true }, { path: 'qty', label: 'Qty', type: 'number', required: true }, { path: 'serials', label: 'Serials', type: 'list' }] },
                  ],
                });
                if (v) run(() => post(`/erp/workshop/job-cards/${j.id}/parts`, v));
              }}
            >
              Parts
            </Button>
            {j.status === 'in_progress' && <Button size="small" onClick={() => run(() => post(`/erp/workshop/job-cards/${j.id}/await-spares`))}>Awaiting spares</Button>}
            <Button
              size="small"
              variant="contained"
              onClick={async () => {
                const v = await ask({
                  title: `Complete ${j.jcNo}`,
                  initial: { labourCost: j.labourCost, runningKm: j.runningKm ?? '' },
                  fields: [
                    { path: 'workDone', label: 'Work done', type: 'textarea', required: true },
                    { path: 'labourCost', label: 'Labour cost (₹)', type: 'number' },
                    { path: 'runningKm', label: 'Odometer at completion (km)', type: 'number' },
                  ],
                });
                if (v) run(() => post(`/erp/workshop/job-cards/${j.id}/complete`, v));
              }}
            >
              Complete
            </Button>
          </>
        )}
        {edit && !['completed', 'cancelled'].includes(j.status) && <Button size="small" color="inherit" onClick={() => window.confirm(`Cancel ${j.jcNo}?`) && run(() => post(`/erp/workshop/job-cards/${j.id}/cancel`))}>Cancel</Button>}
      </>
    ),
  };
  return (
    <>
      <EntityPage config={config} />
      {dialog}
    </>
  );
}

/* -------------------------------------------------------- PM schedules */

interface PmDue {
  id: number;
  vehicleNo: string;
  task: string;
  category: string | null;
  intervalKm: number | null;
  intervalDays: number | null;
  lastDoneAt: string | null;
  lastDoneKm: number | null;
  currentKm: number | null;
  nextDueKm: number | null;
  nextDueDate: string | null;
  kmLeft: number | null;
  daysLeft: number | null;
  status: 'overdue' | 'due_soon' | 'ok' | 'unknown';
}

const pmFields: Field[] = [
  vehicleField(),
  { path: 'task', label: 'Service task', required: true, fullWidth: true },
  { path: 'category', label: 'Category' },
  { path: 'intervalKm', label: 'Every (km)', type: 'number' },
  { path: 'intervalDays', label: 'Every (days)', type: 'number' },
  { path: 'lastDoneAt', label: 'Last done on', type: 'date' },
  { path: 'lastDoneKm', label: 'Last done at (km)', type: 'number' },
];

export function PmSchedulesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const access = useAccess();
  const [vehicle, setVehicle] = useState('');
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [dialog, ask] = useFormDialog();
  const list = useQuery({ queryKey: ['pm-due', vehicle], queryFn: () => http<PmDue[]>(`/erp/workshop/pm-due${vehicle ? `?vehicleNo=${encodeURIComponent(vehicle)}` : ''}`) });
  const vehicles = useQuery({ queryKey: ['options', 'vehicle-name-options'], queryFn: vehicleOptions });
  const refresh = () => qc.invalidateQueries({ queryKey: ['pm-due'] });
  const save = useMutation({
    mutationFn: (v: Record<string, unknown>) => http(v.id ? `/erp/workshop/pm-schedules/${v.id}` : '/erp/workshop/pm-schedules', { method: v.id ? 'PUT' : 'POST', body: JSON.stringify(v) }),
    onSuccess: () => setEditing(null),
    onSettled: refresh,
  });
  const act = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSettled: refresh });
  const rows = list.data ?? [];
  const count = (s: string) => rows.filter((r) => r.status === s).length;

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
        <Box>
          <Typography variant="h5">PM Schedules</Typography>
          <Typography color="text.secondary">Preventive maintenance by kilometres (GPS odometer) or days since the last service, whichever comes first.</Typography>
        </Box>
        {access.can('pm_schedule', 'create') && (
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              onClick={async () => {
                const v = await ask({ title: 'Create the standard PM schedule for a vehicle', fields: [vehicleField()] });
                if (v) act.mutate(() => post('/erp/workshop/pm-seed', v));
              }}
            >
              Seed defaults
            </Button>
            <Button variant="contained" onClick={() => { save.reset(); setEditing({}); }}>New schedule</Button>
          </Stack>
        )}
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
        <TextField select size="small" label="Vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value)} sx={{ minWidth: 240 }}>
          <MenuItem value="">All vehicles</MenuItem>
          {vehicles.data?.map((v) => <MenuItem key={v.value} value={String(v.value)}>{v.label}</MenuItem>)}
        </TextField>
        {[['Overdue', 'overdue'], ['Due soon', 'due_soon'], ['Healthy', 'ok']].map(([l, s]) => <Chip key={s} label={`${l}: ${count(s)}`} color={s === 'overdue' ? 'error' : s === 'due_soon' ? 'warning' : 'success'} variant="outlined" />)}
      </Stack>
      {act.isError && <Alert severity="error">{errorMessage(act.error)}</Alert>}
      {act.data !== undefined && !act.isError && Array.isArray(act.data) && <Alert severity="success">Created {act.data.length} schedules.</Alert>}
      <Card>
        <Table size="small">
          <TableHead><TableRow>{['Vehicle', 'Task', 'Interval', 'Last done', 'Next due', 'Due status', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={7}><Typography color="text.secondary" sx={{ py: 2 }}>No schedules yet. Use “Seed defaults” to add the usual tasks for a vehicle.</Typography></TableCell></TableRow>}
            {rows.map((p) => (
              <TableRow key={p.id} hover>
                <TableCell>{p.vehicleNo}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{p.currentKm !== null ? `${num(p.currentKm)} km now` : 'no GPS odometer'}</Typography></TableCell>
                <TableCell>{p.task}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{p.category ?? ''}</Typography></TableCell>
                <TableCell>{[p.intervalKm ? `${num(p.intervalKm)} km` : null, p.intervalDays ? `${p.intervalDays} days` : null].filter(Boolean).join(' or ')}</TableCell>
                <TableCell>{p.lastDoneKm !== null ? `${num(p.lastDoneKm)} km` : '—'}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{date(p.lastDoneAt)}</Typography></TableCell>
                <TableCell>{p.nextDueKm !== null ? `${num(p.nextDueKm)} km` : '—'}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{date(p.nextDueDate)}</Typography></TableCell>
                <TableCell>
                  <StatusChip status={p.status === 'ok' ? 'completed' : p.status === 'due_soon' ? 'pending_approval' : p.status === 'overdue' ? 'overdue' : 'draft'} />
                  <Typography variant="caption" sx={{ display: 'block' }}>
                    {p.kmLeft !== null && (p.kmLeft < 0 ? `${num(-p.kmLeft)} km over` : `${num(p.kmLeft)} km left`)}
                    {p.daysLeft !== null && ` · ${p.daysLeft < 0 ? `${-p.daysLeft} days late` : `${p.daysLeft} days`}`}
                  </Typography>
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  {access.can('job_card', 'create') && <Button size="small" onClick={() => act.mutate(async () => { await post(`/erp/workshop/pm-schedules/${p.id}/job-card`); navigate('/job-cards'); })}>Job card</Button>}
                  {access.can('pm_schedule', 'edit') && <Button size="small" onClick={() => { save.reset(); setEditing(p as unknown as Record<string, unknown>); }}>Edit</Button>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {editing && (
        <EntityForm title={editing.id ? 'Edit PM schedule' : 'New PM schedule'} fields={pmFields} initial={editing} isNew={!editing.id} onCancel={() => setEditing(null)} onSubmit={(v) => save.mutate({ ...v, id: editing.id })} busy={save.isPending} error={save.isError ? errorMessage(save.error) : null} />
      )}
      {dialog}
    </Stack>
  );
}

/* --------------------------------------------------------- gate passes */

interface GatePass {
  id: number;
  gpNo: string;
  kind: string;
  fromStoreId: number;
  partyId: number;
  vehicleNo: string | null;
  expectedReturn: string | null;
  lines: { description: string; qty: number; serials: string[]; reason: string | null }[];
  estimatedValue: number | null;
  status: string;
  createdAt: string;
}

export function GatePassesPage() {
  const n = useNames();
  const access = useAccess();
  const overdue = (g: GatePass) => g.status === 'out' && g.expectedReturn && dayjs(g.expectedReturn).isBefore(dayjs());
  const config: EntityConfig<GatePass> = {
    title: 'Gate Passes',
    singular: 'gate pass',
    subtitle: 'Material leaving a store: returnable (repair, machining), on a warranty claim, or a plain transfer.',
    endpoint: '/erp/workshop/gate-passes',
    queryKey: 'gate-passes',
    docType: 'gate_pass',
    defaults: { kind: 'returnable', lines: [] },
    searchText: (g) => `${g.gpNo} ${g.vehicleNo ?? ''} ${n.party(g.partyId)} ${g.lines.map((l) => l.description).join(' ')}`,
    canEditRow: (g) => ['pending_approval', 'rejected'].includes(g.status),
    columns: [
      { label: 'Pass', render: (g) => <Box><b>{g.gpNo}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{date(g.createdAt)}</Typography></Box>, csv: (g) => g.gpNo },
      { label: 'Kind', render: (g) => ({ returnable: 'Returnable', transfer: 'Plain transfer', claim: 'Claim / warranty' })[g.kind] ?? g.kind },
      { label: 'From store', render: (g) => n.store(g.fromStoreId) },
      { label: 'Party', render: (g) => n.party(g.partyId) },
      { label: 'Vehicle', render: (g) => g.vehicleNo ?? '—' },
      { label: 'Items', render: (g) => g.lines.map((l) => `${num(l.qty)} × ${l.description}`).join(', ') },
      { label: 'Expected back', render: (g) => date(g.expectedReturn) },
      { label: 'Status', render: (g) => <StatusChip status={overdue(g) ? 'overdue' : g.status} />, csv: (g) => g.status },
    ],
    fields: [
      { path: 'kind', label: 'Kind', type: 'select', required: true, options: opts([['returnable', 'Returnable'], ['transfer', 'Plain transfer'], ['claim', 'Claim / warranty']]) },
      { path: 'fromStoreId', label: 'From store', type: 'select', required: true, options: storeOptions, optionsKey: 'store-options' },
      { path: 'partyId', label: 'Party / vendor', type: 'autocomplete', required: true, options: partyOptions('vendor'), optionsKey: 'vendor-options' },
      { ...vehicleField(false), label: 'Vehicle (optional)' },
      { path: 'expectedReturn', label: 'Expected return', type: 'datetime', visible: (v) => v.kind !== 'transfer' },
      { path: 'estimatedValue', label: 'Estimated value (₹)', type: 'number' },
      {
        path: 'lines',
        label: 'Items',
        type: 'lines',
        newLine: { qty: 1 },
        lineFields: [
          { path: 'description', label: 'Item / part', required: true, fullWidth: true },
          { path: 'qty', label: 'Qty', type: 'number', required: true },
          { path: 'serials', label: 'Serials', type: 'list' },
          { path: 'reason', label: 'Reason', type: 'select', options: opts([['Machining', 'Lathe / machining'], ['Retreading', 'Retreading'], ['Warranty claim', 'Warranty claim'], ['Calibration', 'Testing / calibration'], ['Reconditioning', 'Reconditioning'], ['Scrap', 'Scrap / disposal']]) },
        ],
      },
      { path: 'remark', label: 'Remark', type: 'textarea' },
    ],
    rowActions: (g, run) => (g.status === 'out' && access.can('gate_pass', 'edit') ? <Button size="small" variant="contained" onClick={() => run(() => post(`/erp/workshop/gate-passes/${g.id}/return`))}>{g.kind === 'transfer' ? 'Close' : 'Returned'}</Button> : null),
  };
  return <EntityPage config={config} />;
}

/* -------------------------------------------------------- repair bills */

interface Bill {
  id: number;
  rbNo: string;
  vendorBillNo: string | null;
  partyId: number;
  vehicleNo: string;
  billDate: string;
  taxable: number;
  gstRate: number;
  interState: number;
  cgst: number;
  sgst: number;
  igst: number;
  tdsRate: number;
  tds: number;
  netPayable: number;
  status: string;
  paymentRef: string | null;
}

export function RepairBillsPage() {
  const n = useNames();
  const qc = useQueryClient();
  const access = useAccess();
  const [dialog, ask] = useFormDialog();
  const [files, setFiles] = useState<Bill | null>(null);
  const config: EntityConfig<Bill> = {
    title: 'Repair Bills',
    singular: 'repair bill',
    subtitle: 'Market garage bills. GST is split and TDS u/s 194C deducted when the bill is saved.',
    endpoint: '/erp/workshop/repair-bills',
    queryKey: 'repair-bills',
    docType: 'repair_bill',
    defaults: { gstRate: 18, interState: 0, tdsRate: 2 },
    searchText: (b) => `${b.rbNo} ${b.vendorBillNo ?? ''} ${b.vehicleNo} ${n.party(b.partyId)}`,
    canEditRow: (b) => ['pending_approval', 'rejected'].includes(b.status),
    columns: [
      { label: 'Bill', render: (b) => <Box><b>{b.rbNo}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{b.vendorBillNo ?? ''} · {date(b.billDate)}</Typography></Box>, csv: (b) => b.rbNo },
      { label: 'Garage', render: (b) => n.party(b.partyId) },
      { label: 'Vehicle', render: (b) => b.vehicleNo },
      { label: 'Taxable', render: (b) => inr(b.taxable), csv: (b) => b.taxable },
      { label: 'GST', render: (b) => (b.igst ? `IGST ${inr(b.igst)}` : `CGST ${inr(b.cgst)} + SGST ${inr(b.sgst)}`), csv: (b) => b.cgst + b.sgst + b.igst },
      { label: 'TDS', render: (b) => `−${inr(b.tds)} (${b.tdsRate}%)`, csv: (b) => b.tds },
      { label: 'Net payable', render: (b) => <b>{inr(b.netPayable)}</b>, csv: (b) => b.netPayable },
      { label: 'Status', render: (b) => <StatusChip status={b.status} />, csv: (b) => b.status },
    ],
    fields: [
      { path: 'partyId', label: 'Garage / vendor', type: 'autocomplete', required: true, options: partyOptions('garage'), optionsKey: 'garage-options' },
      vehicleField(),
      { path: 'vendorBillNo', label: 'Garage invoice no.' },
      { path: 'billDate', label: 'Bill date', type: 'date' },
      { path: 'taxable', label: 'Taxable amount (₹)', type: 'number', required: true },
      { path: 'gstRate', label: 'GST %', type: 'select', options: [0, 5, 12, 18, 28].map((r) => ({ value: r, label: `${r}%` })) },
      { path: 'interState', label: 'Garage in another state (IGST)', type: 'select', options: [{ value: 0, label: 'No: CGST + SGST' }, { value: 1, label: 'Yes: IGST' }] },
      { path: 'tdsRate', label: 'TDS u/s 194C', type: 'select', options: [{ value: 2, label: '2% (company / firm)' }, { value: 1, label: '1% (individual / HUF)' }, { value: 0, label: 'None' }] },
      { path: 'description', label: 'Parts replaced, labour and invoice details', type: 'textarea' },
    ],
    rowActions: (b, run) => (
      <>
        <Button size="small" onClick={() => setFiles(b)}>Files</Button>
        {b.status === 'approved' && access.can('repair_bill', 'edit') && (
          <Button
            size="small"
            variant="contained"
            onClick={async () => {
              const v = await ask({ title: `Pay ${inr(b.netPayable)} to ${n.party(b.partyId)}`, fields: [{ path: 'paymentRef', label: 'Payment reference (UTR / cheque)' }] });
              if (v) run(() => post(`/erp/workshop/repair-bills/${b.id}/pay`, v));
            }}
          >
            Pay
          </Button>
        )}
      </>
    ),
  };
  const editable = files && ['pending_approval', 'rejected'].includes(files.status) && access.can('repair_bill', 'edit');
  return (
    <>
      <EntityPage config={config} />
      {dialog}
      {files && (
        <AttachmentsDialog
          title={`Files · ${files.rbNo}`}
          docType="repair_bill"
          docId={files.id}
          note={editable ? 'Attach the garage invoice, then use “Read with AI” to fill the amounts.' : undefined}
          onClose={() => setFiles(null)}
          ai={{
            kind: 'repair_bill',
            applyLabel: editable ? 'Fill bill details' : undefined,
            onApply: editable
              ? async (f) => {
                  const body: Record<string, unknown> = {};
                  if (typeof f.invoiceNo === 'string') body.vendorBillNo = f.invoiceNo;
                  if (typeof f.billDate === 'string') body.billDate = f.billDate;
                  if (typeof f.taxable === 'number') body.taxable = f.taxable;
                  if (typeof f.gstRate === 'number' && [0, 5, 12, 18, 28].includes(f.gstRate)) body.gstRate = f.gstRate;
                  if (typeof f.igst === 'number') body.interState = f.igst > 0 ? 1 : 0;
                  await http(`/erp/workshop/repair-bills/${files.id}`, { method: 'PUT', body: JSON.stringify(body) });
                  void qc.invalidateQueries({ queryKey: ['repair-bills'] });
                }
              : undefined,
          }}
        />
      )}
    </>
  );
}

/* ----------------------------------------------------- tool checklists */

interface Checklist {
  id: number;
  tcNo: string;
  auditType: string;
  vehicleNo: string;
  driverName: string;
  inspector: string | null;
  auditDate: string;
  tools: { tool: string; present: boolean }[];
  missingCount: number;
}

export function ToolChecklistsPage() {
  const access = useAccess();
  const meta = useMeta();
  const [dialog, ask] = useFormDialog();
  const config: EntityConfig<Checklist> = {
    title: 'Tools Checklists',
    singular: 'checklist',
    subtitle: 'Driver toolkit handover (out) and return (in) audits. Missing tools can be charged to the driver.',
    endpoint: '/erp/workshop/tool-checklists',
    queryKey: 'tool-checklists',
    docType: 'tool_checklist',
    defaults: { auditType: 'handover', tools: (meta.data?.tools ?? []).map((tool) => ({ tool, present: true })) },
    searchText: (c) => `${c.tcNo} ${c.vehicleNo} ${c.driverName} ${c.inspector ?? ''}`,
    columns: [
      { label: 'Checklist', render: (c) => <Box><b>{c.tcNo}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{dayjs(c.auditDate).format('D MMM YYYY, HH:mm')}</Typography></Box>, csv: (c) => c.tcNo },
      { label: 'Audit', render: (c) => (c.auditType === 'handover' ? 'Handover (out)' : 'Return (in)') },
      { label: 'Vehicle', render: (c) => c.vehicleNo },
      { label: 'Driver', render: (c) => c.driverName },
      { label: 'Tools', render: (c) => `${c.tools.length - c.missingCount} of ${c.tools.length} present` },
      { label: 'Missing', render: (c) => (c.missingCount ? c.tools.filter((t) => !t.present).map((t) => t.tool).join(', ') : '—') },
      { label: 'Inspector', render: (c) => c.inspector ?? '—' },
      { label: 'Result', render: (c) => <StatusChip status={c.missingCount ? 'overdue' : 'completed'} />, csv: (c) => (c.missingCount ? 'Missing items' : 'All clean') },
    ],
    fields: [
      { path: 'auditType', label: 'Audit', type: 'select', required: true, options: opts([['handover', 'Handover (out)'], ['return', 'Return (in)']]) },
      vehicleField(),
      { path: 'driverName', label: 'Driver', required: true },
      { path: 'inspector', label: 'Inspector' },
      { path: 'auditDate', label: 'Date & time', type: 'datetime' },
      { path: 'tools', label: 'Toolkit', type: 'lines', newLine: { present: true }, lineFields: [{ path: 'tool', label: 'Tool', required: true, fullWidth: true }, { path: 'present', label: 'Present', type: 'switch' }] },
      { path: 'remarks', label: 'Remarks / shortages', type: 'textarea' },
    ],
    rowActions: (c, run) =>
      c.missingCount > 0 && access.can('driver_charge', 'create') ? (
        <Button
          size="small"
          onClick={async () => {
            const missing = c.tools.filter((t) => !t.present).map((t) => t.tool).join(', ');
            const v = await ask({
              title: `Charge ${c.driverName} for missing tools`,
              initial: { amount: '', recoveryPlan: 'one_time', instalments: 1 },
              fields: [
                { path: 'amount', label: 'Amount (₹)', type: 'number', required: true },
                { path: 'recoveryPlan', label: 'Recovery', type: 'select', options: opts([['one_time', 'One-time payroll deduction'], ['instalments', 'Instalments']]) },
                { path: 'instalments', label: 'Instalments', type: 'number', visible: (x) => x.recoveryPlan === 'instalments' },
              ],
            });
            if (v) run(() => post('/erp/workshop/driver-charges', { ...v, driverName: c.driverName, vehicleNo: c.vehicleNo, category: 'missing_tool', refNo: c.tcNo, incidentDate: c.auditDate, description: `Missing on ${c.auditType}: ${missing}` }));
          }}
        >
          Raise charge
        </Button>
      ) : null,
  };
  return (
    <>
      {meta.data && <EntityPage config={config} />}
      {dialog}
    </>
  );
}

/* ------------------------------------------------------ driver charges */

interface Charge {
  id: number;
  dcNo: string;
  driverName: string;
  incidentDate: string;
  category: string;
  vehicleNo: string | null;
  amount: number;
  recovered: number;
  refNo: string | null;
  description: string;
  recoveryPlan: string;
  instalments: number;
  status: string;
}

export function DriverChargesPage() {
  const access = useAccess();
  const [dialog, ask] = useFormDialog();
  const edit = access.can('driver_charge', 'edit');
  const config: EntityConfig<Charge> = {
    title: 'Driver Charges',
    singular: 'charge',
    subtitle: 'Missing tools, vehicle damage and other debits, recovered through payroll.',
    endpoint: '/erp/workshop/driver-charges',
    queryKey: 'driver-charges',
    docType: 'driver_charge',
    defaults: { category: 'missing_tool', recoveryPlan: 'one_time', instalments: 1 },
    searchText: (c) => `${c.dcNo} ${c.driverName} ${c.vehicleNo ?? ''} ${c.refNo ?? ''} ${c.description}`,
    canEditRow: (c) => ['pending_approval', 'rejected'].includes(c.status),
    columns: [
      { label: 'Charge', render: (c) => <Box><b>{c.dcNo}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{date(c.incidentDate)}</Typography></Box>, csv: (c) => c.dcNo },
      { label: 'Driver', render: (c) => c.driverName },
      { label: 'Category', render: (c) => c.category.replace(/_/g, ' ') },
      { label: 'Vehicle / ref', render: (c) => [c.vehicleNo, c.refNo].filter(Boolean).join(' · ') || '—' },
      { label: 'Details', render: (c) => c.description },
      { label: 'Amount', render: (c) => <Box><b>{inr(c.amount)}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>recovered {inr(c.recovered)}{c.recoveryPlan === 'instalments' ? ` · ${c.instalments} instalments` : ''}</Typography></Box>, csv: (c) => c.amount },
      { label: 'Status', render: (c) => <StatusChip status={c.status} />, csv: (c) => c.status },
    ],
    fields: [
      { path: 'driverName', label: 'Driver', required: true },
      { path: 'incidentDate', label: 'Incident date', type: 'date' },
      { path: 'category', label: 'Category', type: 'select', required: true, options: opts([['missing_tool', 'Missing tool (from checklist)'], ['vehicle_damage', 'Vehicle damage'], ['fuel_shortage', 'Fuel shortage'], ['other', 'Other']]) },
      { ...vehicleField(false), label: 'Vehicle' },
      { path: 'amount', label: 'Amount (₹)', type: 'number', required: true },
      { path: 'refNo', label: 'Reference / audit no.' },
      { path: 'recoveryPlan', label: 'Recovery', type: 'select', options: opts([['one_time', 'One-time payroll deduction'], ['instalments', 'Instalments']]) },
      { path: 'instalments', label: 'Instalments', type: 'number', visible: (v) => v.recoveryPlan === 'instalments' },
      { path: 'description', label: 'What happened', type: 'textarea', required: true },
    ],
    rowActions: (c, run) =>
      edit && c.status === 'approved' ? (
        <>
          <Button
            size="small"
            onClick={async () => {
              const left = c.amount - c.recovered;
              const v = await ask({ title: `Recover from ${c.driverName}`, initial: { amount: c.recoveryPlan === 'instalments' ? Math.min(left, Math.ceil(c.amount / c.instalments)) : left }, fields: [{ path: 'amount', label: `Amount (₹, ${inr(left)} left)`, type: 'number', required: true }] });
              if (v) run(() => post(`/erp/workshop/driver-charges/${c.id}/recover`, v));
            }}
          >
            Recover
          </Button>
          <Button
            size="small"
            color="inherit"
            onClick={async () => {
              const v = await ask({ title: `Waive ${c.dcNo}`, fields: [{ path: 'reason', label: 'Reason', type: 'textarea', required: true }] });
              if (v) run(() => post(`/erp/workshop/driver-charges/${c.id}/waive`, v));
            }}
          >
            Waive
          </Button>
        </>
      ) : null,
  };
  return (
    <>
      <EntityPage config={config} />
      {dialog}
    </>
  );
}
