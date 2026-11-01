import { Alert, Box, Button, Card, CardContent, Chip, Grid, List, ListItem, ListItemText, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, ToggleButton, ToggleButtonGroup, Tooltip as MuiTooltip, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { http } from '../../api/http';
import { EntityPage, type EntityConfig, errorMessage, type Option } from '../../components/EntityPage';
import { useFormDialog } from '../../components/useFormDialog';
import { useAccess } from '../../lib/access';
import { inr, num, partyOptions, StatusChip, useNames } from '../inventory/shared';

const post = (url: string, body?: unknown) => http(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const COLORS = ['#0b5cad', '#f57c00', '#2e7d32', '#6a1b9a', '#c62828', '#00838f'];
const TABS = ['overview', 'team', 'tasks', 'attendance', 'claims', 'performance'] as const;
const ROLES: Option[] = [{ value: 'technician', label: 'Technician' }, { value: 'collection', label: 'Collection agent' }, { value: 'sales', label: 'Sales executive' }];
const KINDS: Option[] = [{ value: 'installation', label: 'Installation' }, { value: 'service', label: 'Service visit' }, { value: 'collection', label: 'Payment collection' }, { value: 'sales_visit', label: 'Sales visit' }, { value: 'other', label: 'Other' }];
const CATEGORIES: Option[] = ['travel', 'fuel', 'food', 'lodging', 'tools', 'phone', 'other'].map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) }));
const label = (opts: Option[], v: string) => opts.find((o) => o.value === v)?.label ?? v;
const STAFF_STATUS: Record<string, { label: string; color: 'success' | 'primary' | 'default' | 'warning' }> = {
  on_task: { label: 'On task', color: 'primary' },
  available: { label: 'Available', color: 'success' },
  checked_out: { label: 'Checked out', color: 'default' },
  not_checked_in: { label: 'Not checked in', color: 'warning' },
};

export interface Staff { id: number; name: string; role: string; team: string | null; city: string | null; phone: string | null; traccarDeviceId: number | null; monthlyTarget: number | null; status: string }
interface Task { id: number; ftNo: string; staffId: number; partyId: number | null; kind: string; title: string; address: string | null; city: string | null; dueAt: string; status: string; startedAt: string | null; completedAt: string | null; amountCollected: number | null; rating: number | null; outcome: string | null }
interface Claim { id: number; expNo: string; staffId: number; date: string; category: string; description: string; amount: number; status: string; paidAt: string | null }
interface Overview {
  onDuty: number;
  staff: number;
  tasksToday: number;
  doneToday: number;
  collectedToday: number;
  lateCheckIns: number;
  claimsPending: number;
  claimsPendingAmount: number;
  avgRating: number | null;
  teamScore: number | null;
  cities: string[];
  team: { staffId: number; name: string; role: string; city: string | null; phone: string | null; status: string; checkIn: string | null; tasksToday: number }[];
  todaysTasks: Task[];
  byHour: { hour: string; due: number; done: number }[];
  recentlyCompleted: Task[];
}
interface Attendance { dates: string[]; lateAfter: string; staff: { staffId: number; name: string; city: string | null; days: { date: string; checkIn: string | null; checkOut: string | null; hours: number | null; km: number | null; late: boolean }[]; present: number; km: number }[] }
interface Perf { staffId: number; name: string; role: string; team: string | null; city: string | null; visits: number; open: number; completion: number | null; onTime: number | null; rating: number | null; collected: number; km: number; target: number | null; score: number | null }

const staffOptions = async (): Promise<Option[]> => (await http<Staff[]>('/erp/field/staff?status=active')).map((s) => ({ value: s.id, label: `${s.name} (${s.city ?? label(ROLES, s.role)})` }));
const useStaffNames = () => {
  const q = useQuery({ queryKey: ['field', 'staff-all'], queryFn: () => http<Staff[]>('/erp/field/staff') });
  const m = new Map(q.data?.map((s) => [s.id, s.name]));
  return (id: number) => m.get(id) ?? `#${id}`;
};

function Kpis({ items }: { items: [string, string, string?][] }) {
  return (
    <Grid container spacing={2}>
      {items.map(([k, v, sub]) => (
        <Grid key={k} size={{ xs: 6, md: 3 }}>
          <Card sx={{ height: '100%' }}><CardContent><Typography variant="body2" color="text.secondary">{k}</Typography><Typography variant="h6">{v}</Typography>{sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}</CardContent></Card>
        </Grid>
      ))}
    </Grid>
  );
}

/** Start / Complete / Cancel buttons for a task, shared by the overview and the task list. */
function useTaskActions() {
  const [dialog, ask] = useFormDialog();
  const buttons = (t: Task, run: (fn: () => Promise<unknown>) => void) => (
    <>
      {t.status === 'assigned' && <Button size="small" onClick={() => run(() => post(`/erp/field/tasks/${t.id}/start`))}>Start</Button>}
      {['assigned', 'in_progress'].includes(t.status) && (
        <>
          <Button
            size="small"
            variant="contained"
            onClick={async () => {
              const v = await ask({
                title: `Complete ${t.ftNo}`,
                fields: [
                  { path: 'outcome', label: 'Outcome', type: 'textarea', required: true },
                  { path: 'amountCollected', label: 'Amount collected (SAR)', type: 'number', required: t.kind === 'collection', helper: t.kind === 'collection' ? 'Enter 0 if nothing was collected' : undefined },
                  { path: 'rating', label: 'Customer rating', type: 'select', options: [5, 4, 3, 2, 1].map((r) => ({ value: r, label: '★'.repeat(r) })) },
                ],
              });
              if (v) run(() => post(`/erp/field/tasks/${t.id}/complete`, v));
            }}
          >
            Complete
          </Button>
          <Button
            size="small"
            color="inherit"
            onClick={async () => {
              const v = await ask({ title: `Cancel ${t.ftNo}`, fields: [{ path: 'reason', label: 'Reason', type: 'textarea', required: true }] });
              if (v) run(() => post(`/erp/field/tasks/${t.id}/cancel`, v));
            }}
          >
            Cancel
          </Button>
        </>
      )}
    </>
  );
  return { dialog, buttons, ask };
}

export function FieldStaffPage() {
  const [params, setParams] = useSearchParams();
  const tab = Math.max(0, TABS.indexOf((params.get('tab') ?? 'overview') as (typeof TABS)[number]));
  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5">Field Staff Ops</Typography>
        <Typography color="text.secondary">Technicians, collection agents and sales executives: tasks, attendance, claims and performance.</Typography>
      </Box>
      <Tabs value={tab} onChange={(_, v) => setParams({ tab: TABS[v] })} variant="scrollable">
        <Tab label="Live overview" />
        <Tab label="Team" />
        <Tab label="Tasks" />
        <Tab label="Attendance" />
        <Tab label="Expense claims" />
        <Tab label="Performance" />
      </Tabs>
      {tab === 0 && <OverviewTab />}
      {tab === 1 && <TeamTab />}
      {tab === 2 && <TasksTab />}
      {tab === 3 && <AttendanceTab />}
      {tab === 4 && <ClaimsTab />}
      {tab === 5 && <PerformanceTab />}
    </Stack>
  );
}

/* ------------------------------------------------------------ overview */

function OverviewTab() {
  const qc = useQueryClient();
  const access = useAccess();
  const edit = access.can('field_staff', 'edit');
  const o = useQuery({ queryKey: ['field', 'overview'], queryFn: () => http<Overview>('/erp/field/overview'), refetchInterval: 60_000 });
  const act = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSettled: () => qc.invalidateQueries({ queryKey: ['field'] }) });
  const { dialog, buttons, ask } = useTaskActions();
  const name = useStaffNames();
  const d = o.data;
  if (o.isError) return <Alert severity="error">{errorMessage(o.error)}</Alert>;
  if (!d) return <Typography color="text.secondary">Loading…</Typography>;
  const run = (fn: () => Promise<unknown>) => act.mutate(fn);
  return (
    <Stack spacing={2}>
      <Kpis
        items={[
          ['On duty', `${d.onDuty} / ${d.staff}`, d.cities.length ? `${d.cities.length} cities: ${d.cities.join(', ')}` : undefined],
          ['Tasks today', num(d.tasksToday), `${d.doneToday} done`],
          ['Collected today', inr(d.collectedToday)],
          ['Late check-ins', num(d.lateCheckIns), 'after 09:30'],
          ['Claims awaiting approval', num(d.claimsPending), inr(d.claimsPendingAmount)],
          ['Customer rating', d.avgRating !== null ? `${d.avgRating} ★` : '—', 'last 30 days'],
          ['Team score', d.teamScore !== null ? `${d.teamScore}/100` : '—', 'completion, on time, rating, target'],
        ]}
      />
      {act.isError && <Alert severity="error" onClose={() => act.reset()}>{errorMessage(act.error)}</Alert>}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6">Team status</Typography>
              <List dense sx={{ maxHeight: 380, overflow: 'auto' }}>
                {d.team.length === 0 && <Typography color="text.secondary">No active staff. Add people on the Team tab.</Typography>}
                {d.team.map((t) => (
                  <ListItem key={t.staffId} disableGutters divider secondaryAction={edit && (
                    t.status === 'not_checked_in' ? (
                      <Button size="small" onClick={() => run(() => post('/erp/field/check-in', { staffId: t.staffId }))}>Check in</Button>
                    ) : t.status !== 'checked_out' ? (
                      <Button
                        size="small"
                        onClick={async () => {
                          const v = await ask({ title: `Check out ${t.name}`, fields: [{ path: 'km', label: 'Km travelled today', type: 'number' }] });
                          if (v) run(() => post('/erp/field/check-out', { staffId: t.staffId, ...v }));
                        }}
                      >
                        Check out
                      </Button>
                    ) : null
                  )}>
                    <ListItemText
                      primary={<Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><span>{t.name}</span><Chip size="small" label={STAFF_STATUS[t.status]?.label ?? t.status} color={STAFF_STATUS[t.status]?.color ?? 'default'} /></Stack>}
                      secondary={[label(ROLES, t.role), t.city, t.checkIn ? `in ${dayjs(t.checkIn).format('HH:mm')}` : null, `${t.tasksToday} tasks`].filter(Boolean).join(' · ')}
                    />
                  </ListItem>
                ))}
              </List>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6">Tasks through the day</Typography>
              <Box sx={{ height: 200 }}>
                <ResponsiveContainer>
                  <BarChart data={d.byHour}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="hour" fontSize={11} />
                    <YAxis allowDecimals={false} fontSize={12} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="due" name="Due" fill={COLORS[0]} />
                    <Bar dataKey="done" name="Done" fill={COLORS[2]} />
                  </BarChart>
                </ResponsiveContainer>
              </Box>
              <Typography variant="subtitle1" sx={{ mt: 1, fontWeight: 600 }}>Today's tasks</Typography>
              <Table size="small">
                <TableBody>
                  {d.todaysTasks.length === 0 && <TableRow><TableCell><Typography color="text.secondary">Nothing due today.</Typography></TableCell></TableRow>}
                  {d.todaysTasks.map((t) => (
                    <TableRow key={t.id} hover>
                      <TableCell>{dayjs(t.dueAt).format('HH:mm')}</TableCell>
                      <TableCell>{t.title}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t.ftNo} · {name(t.staffId)} · {label(KINDS, t.kind)}</Typography></TableCell>
                      <TableCell><StatusChip status={t.status} /></TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{edit && buttons(t, run)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      <Card>
        <CardContent>
          <Typography variant="h6">Recently completed</Typography>
          <List dense>
            {d.recentlyCompleted.length === 0 && <Typography color="text.secondary">No completed tasks yet.</Typography>}
            {d.recentlyCompleted.map((t) => (
              <ListItem key={t.id} disableGutters divider>
                <ListItemText primary={`${t.title} · ${name(t.staffId)}`} secondary={[t.completedAt ? dayjs(t.completedAt).format('D MMM HH:mm') : null, t.outcome, t.amountCollected ? inr(t.amountCollected) : null, t.rating ? '★'.repeat(t.rating) : null].filter(Boolean).join(' · ')} />
              </ListItem>
            ))}
          </List>
        </CardContent>
      </Card>
      {dialog}
    </Stack>
  );
}

/* ---------------------------------------------------------------- team */

function TeamTab() {
  const config: EntityConfig<Staff> = {
    title: 'Team',
    singular: 'member',
    subtitle: 'Field staff directory. Link a phone tracker (Traccar device id) to see them on the map.',
    endpoint: '/erp/field/staff',
    queryKey: 'field-staff',
    docType: 'field_staff',
    defaults: { role: 'technician', status: 'active' },
    searchText: (s) => `${s.name} ${s.team ?? ''} ${s.city ?? ''} ${s.phone ?? ''}`,
    columns: [
      { label: 'Person', render: (s) => <Box><b>{s.name}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{s.phone ?? ''}</Typography></Box>, csv: (s) => s.name },
      { label: 'Role', render: (s) => label(ROLES, s.role), csv: (s) => s.role },
      { label: 'Team', render: (s) => s.team ?? '—', csv: (s) => s.team },
      { label: 'City', render: (s) => s.city ?? '—', csv: (s) => s.city },
      { label: 'Monthly target', render: (s) => (s.monthlyTarget ? `${s.monthlyTarget} visits` : '—'), csv: (s) => s.monthlyTarget },
      { label: 'Status', render: (s) => <StatusChip status={s.status === 'active' ? 'active' : 'cancelled'} />, csv: (s) => s.status },
    ],
    fields: [
      { path: 'name', label: 'Full name', required: true },
      { path: 'role', label: 'Role', type: 'select', required: true, options: ROLES },
      { path: 'team', label: 'Team', helper: 'e.g. Installation, Collections' },
      { path: 'city', label: 'Base city' },
      { path: 'phone', label: 'Phone' },
      { path: 'monthlyTarget', label: 'Monthly target (visits)', type: 'number' },
      { path: 'traccarDeviceId', label: 'Phone tracker (Traccar device id)', type: 'number' },
      { path: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
    ],
  };
  return <EntityPage config={config} />;
}

/* --------------------------------------------------------------- tasks */

function TasksTab() {
  const n = useNames();
  const name = useStaffNames();
  const access = useAccess();
  const [status, setStatus] = useState('open');
  const { dialog, buttons } = useTaskActions();
  const edit = access.can('field_staff', 'edit');
  const config: EntityConfig<Task> = {
    title: 'Tasks',
    singular: 'task',
    subtitle: 'Installations, service visits, collections and sales calls.',
    endpoint: '/erp/field/tasks',
    queryKey: 'field-tasks',
    docType: 'field_staff',
    defaults: { kind: 'installation' },
    searchText: (t) => `${t.ftNo} ${t.title} ${t.city ?? ''} ${t.address ?? ''} ${name(t.staffId)}`,
    rowFilter: (t) => !status || (status === 'open' ? ['assigned', 'in_progress'].includes(t.status) : t.status === status),
    toolbar: (
      <ToggleButtonGroup size="small" exclusive value={status} onChange={(_, v) => v !== null && setStatus(v)}>
        {[['open', 'Open'], ['done', 'Done'], ['cancelled', 'Cancelled'], ['', 'All']].map(([v, l]) => <ToggleButton key={v} value={v}>{l}</ToggleButton>)}
      </ToggleButtonGroup>
    ),
    canEditRow: (t) => !['done', 'cancelled'].includes(t.status),
    columns: [
      { label: 'Task', render: (t) => <Box><b>{t.title}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t.ftNo} · {label(KINDS, t.kind)}{t.partyId ? ` · ${n.party(t.partyId)}` : ''}</Typography></Box>, csv: (t) => `${t.ftNo} ${t.title}` },
      { label: 'Assigned to', render: (t) => name(t.staffId), csv: (t) => name(t.staffId) },
      { label: 'Where', render: (t) => [t.address, t.city].filter(Boolean).join(', ') || '—', csv: (t) => [t.address, t.city].filter(Boolean).join(', ') },
      { label: 'Due', render: (t) => <Typography variant="body2" color={['assigned', 'in_progress'].includes(t.status) && dayjs(t.dueAt).isBefore(dayjs()) ? 'error' : undefined}>{dayjs(t.dueAt).format('D MMM HH:mm')}</Typography>, csv: (t) => t.dueAt },
      { label: 'Result', render: (t) => <Box>{t.outcome ?? ''}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{[t.amountCollected !== null ? inr(t.amountCollected) : null, t.rating ? '★'.repeat(t.rating) : null].filter(Boolean).join(' · ')}</Typography></Box>, csv: (t) => t.outcome },
      { label: 'Status', render: (t) => <StatusChip status={t.status} />, csv: (t) => t.status },
    ],
    fields: [
      { path: 'staffId', label: 'Assign to', type: 'autocomplete', required: true, options: staffOptions, optionsKey: 'field-staff-options' },
      { path: 'kind', label: 'Type', type: 'select', required: true, options: KINDS },
      { path: 'title', label: 'Task', required: true, fullWidth: true },
      { path: 'partyId', label: 'Customer', type: 'autocomplete', options: partyOptions('customer'), optionsKey: 'customer-options' },
      { path: 'dueAt', label: 'Due', type: 'datetime', required: true },
      { path: 'address', label: 'Address', fullWidth: true },
      { path: 'city', label: 'City', helper: 'Defaults to the person’s base city' },
    ],
    rowActions: (t, run) => edit && buttons(t, run),
  };
  return (
    <>
      <EntityPage config={config} />
      {dialog}
    </>
  );
}

/* ---------------------------------------------------------- attendance */

function AttendanceTab() {
  const [days, setDays] = useState(14);
  const q = useQuery({ queryKey: ['field', 'attendance', days], queryFn: () => http<Attendance>(`/erp/field/attendance?days=${days}`) });
  const a = q.data;
  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
        <Typography color="text.secondary">Check-in and check-out times (KSA time). Check-ins after {a?.lateAfter ?? '08:30'} are late.</Typography>
        <ToggleButtonGroup size="small" exclusive value={days} onChange={(_, v) => v && setDays(v)}>
          {[7, 14, 30].map((d) => <ToggleButton key={d} value={d}>{d} days</ToggleButton>)}
        </ToggleButtonGroup>
      </Stack>
      {q.isError && <Alert severity="error">{errorMessage(q.error)}</Alert>}
      <Card>
        <TableContainer sx={{ maxHeight: 560 }}>
          <Table size="small" stickyHeader sx={{ '& td, & th': { px: 0.75, textAlign: 'center' } }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700, textAlign: 'left !important', minWidth: 150 }}>Person</TableCell>
                {a?.dates.map((d) => <TableCell key={d} sx={{ fontWeight: 700 }}>{dayjs(d).format('D')}<Typography variant="caption" sx={{ display: 'block' }}>{dayjs(d).format('dd')}</Typography></TableCell>)}
                <TableCell sx={{ fontWeight: 700 }}>Days</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Km</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {a?.staff.length === 0 && <TableRow><TableCell colSpan={(a?.dates.length ?? 0) + 3}><Typography color="text.secondary">No active staff.</Typography></TableCell></TableRow>}
              {a?.staff.map((s) => (
                <TableRow key={s.staffId} hover>
                  <TableCell sx={{ textAlign: 'left !important' }}>{s.name}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{s.city ?? ''}</Typography></TableCell>
                  {s.days.map((d) => (
                    <TableCell key={d.date} sx={{ bgcolor: d.checkIn ? (d.late ? 'warning.light' : 'success.light') : undefined, fontSize: 11, whiteSpace: 'nowrap' }}>
                      {d.checkIn ? (
                        <MuiTooltip title={`${d.checkIn}–${d.checkOut ?? '…'}${d.hours !== null ? ` · ${d.hours} h` : ''}${d.km !== null ? ` · ${d.km} km` : ''}${d.late ? ' · late' : ''}`}>
                          <span>{d.checkIn}<br />{d.checkOut ?? '…'}</span>
                        </MuiTooltip>
                      ) : '·'}
                    </TableCell>
                  ))}
                  <TableCell>{s.present}</TableCell>
                  <TableCell>{num(s.km)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </Stack>
  );
}

/* -------------------------------------------------------------- claims */

function ClaimsTab() {
  const name = useStaffNames();
  const access = useAccess();
  const [status, setStatus] = useState('');
  const config: EntityConfig<Claim> = {
    title: 'Expense claims',
    singular: 'claim',
    subtitle: 'Travel, fuel, food and other field expenses. Claims above the approval limit go to the Pending Inbox.',
    endpoint: '/erp/field/claims',
    queryKey: 'expense-claims',
    docType: 'expense_claim',
    defaults: { category: 'travel', date: dayjs().format('YYYY-MM-DD') } as Partial<Claim>,
    searchText: (c) => `${c.expNo} ${c.description} ${name(c.staffId)} ${c.category}`,
    rowFilter: (c) => !status || c.status === status,
    toolbar: (
      <ToggleButtonGroup size="small" exclusive value={status} onChange={(_, v) => v !== null && setStatus(v)}>
        {[['', 'All'], ['pending_approval', 'Pending'], ['approved', 'Approved'], ['paid', 'Paid'], ['rejected', 'Rejected']].map(([v, l]) => <ToggleButton key={v} value={v}>{l}</ToggleButton>)}
      </ToggleButtonGroup>
    ),
    canEditRow: (c) => ['pending_approval', 'rejected'].includes(c.status),
    columns: [
      { label: 'Claim', render: (c) => <Box><b>{c.expNo}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{dayjs(c.date).format('D MMM YYYY')}</Typography></Box>, csv: (c) => c.expNo },
      { label: 'Staff', render: (c) => name(c.staffId), csv: (c) => name(c.staffId) },
      { label: 'Category', render: (c) => label(CATEGORIES, c.category), csv: (c) => c.category },
      { label: 'Description', render: (c) => c.description, csv: (c) => c.description },
      { label: 'Amount', render: (c) => inr(c.amount), csv: (c) => c.amount },
      { label: 'Status', render: (c) => <StatusChip status={c.status} />, csv: (c) => c.status },
    ],
    fields: [
      { path: 'staffId', label: 'Staff member', type: 'autocomplete', required: true, options: staffOptions, optionsKey: 'field-staff-options' },
      { path: 'date', label: 'Date', type: 'day', required: true },
      { path: 'category', label: 'Category', type: 'select', required: true, options: CATEGORIES },
      { path: 'amount', label: 'Amount (SAR)', type: 'number', required: true },
      { path: 'description', label: 'Description', type: 'textarea', required: true },
    ],
    rowActions: (c, run) => c.status === 'approved' && access.can('expense_claim', 'edit') && <Button size="small" variant="contained" onClick={() => run(() => post(`/erp/field/claims/${c.id}/pay`))}>Pay</Button>,
  };
  return <EntityPage config={config} />;
}

/* --------------------------------------------------------- performance */

function PerformanceTab() {
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ['field', 'performance', days], queryFn: () => http<Perf[]>(`/erp/field/performance?days=${days}`) });
  const rows = q.data ?? [];
  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
        <Typography color="text.secondary">Score = completion 40%, on time 30%, rating 20%, monthly target 10%.</Typography>
        <ToggleButtonGroup size="small" exclusive value={days} onChange={(_, v) => v && setDays(v)}>
          {[7, 30, 90].map((d) => <ToggleButton key={d} value={d}>{d} days</ToggleButton>)}
        </ToggleButtonGroup>
      </Stack>
      {q.isError && <Alert severity="error">{errorMessage(q.error)}</Alert>}
      <Card>
        <CardContent>
          <Typography variant="h6">Visits by person</Typography>
          <Box sx={{ height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" fontSize={11} />
                <YAxis allowDecimals={false} fontSize={12} />
                <Tooltip />
                <Legend />
                <Bar dataKey="visits" name="Visits done" fill={COLORS[0]} />
                <Bar dataKey="open" name="Open" fill={COLORS[1]} />
                <Bar dataKey="target" name="Target" fill={COLORS[5]} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </CardContent>
      </Card>
      <Card sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead><TableRow>{['#', 'Person', 'Team / city', 'Visits', 'Completion', 'On time', 'Rating', 'Collected', 'Km', 'Target', 'Score'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
          <TableBody>
            {q.isSuccess && rows.length === 0 && <TableRow><TableCell colSpan={11}><Typography color="text.secondary">No active staff.</Typography></TableCell></TableRow>}
            {rows.map((p, i) => (
              <TableRow key={p.staffId} hover>
                <TableCell>{i + 1}</TableCell>
                <TableCell>{p.name}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{label(ROLES, p.role)}</Typography></TableCell>
                <TableCell>{[p.team, p.city].filter(Boolean).join(' · ') || '—'}</TableCell>
                <TableCell>{p.visits}</TableCell>
                <TableCell>{p.completion !== null ? `${p.completion}%` : '—'}</TableCell>
                <TableCell>{p.onTime !== null ? `${p.onTime}%` : '—'}</TableCell>
                <TableCell>{p.rating !== null ? `${p.rating} ★` : '—'}</TableCell>
                <TableCell>{inr(p.collected)}</TableCell>
                <TableCell>{num(p.km)}</TableCell>
                <TableCell>{p.target ?? '—'}</TableCell>
                <TableCell>{p.score !== null ? <Chip size="small" color={p.score >= 80 ? 'success' : p.score >= 60 ? 'warning' : 'error'} label={p.score} /> : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </Stack>
  );
}
