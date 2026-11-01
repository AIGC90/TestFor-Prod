import { Alert, Box, Button, Card, CardContent, Chip, Grid, List, ListItem, ListItemText, Menu, MenuItem, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, ToggleButton, ToggleButtonGroup, Tooltip as MuiTooltip, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Fragment, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { http } from '../../api/http';
import { EntityPage, type EntityConfig, errorMessage } from '../../components/EntityPage';
import { useFormDialog } from '../../components/useFormDialog';
import { useAccess } from '../../lib/access';
import { downloadCsv } from '../../lib/csv';
import { inr, num, StatusChip } from '../inventory/shared';

const post = (url: string, body?: unknown) => http(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const COLORS = ['#0b5cad', '#f57c00', '#2e7d32', '#6a1b9a', '#c62828', '#00838f'];
const CODES = ['P', 'H', 'L', 'A', 'WO'] as const;
const CODE_LABEL: Record<string, string> = { P: 'Present', H: 'Half day', L: 'Paid leave', A: 'Absent', WO: 'Weekly off' };
const CODE_COLOR: Record<string, string> = { P: '#2e7d32', H: '#f57c00', L: '#0b5cad', A: '#c62828', WO: '#757575' };
const TABS = ['overview', 'drivers', 'hours', 'attendance', 'payroll'] as const;
const thisMonth = () => dayjs().format('YYYY-MM');
const lastMonth = () => dayjs().subtract(1, 'month').format('YYYY-MM');

/** Aadhar shown as XXXX XXXX 1234. */
export const maskAadhar = (a: string | null | undefined) => (a ? `XXXX XXXX ${a.slice(-4)}` : '—');

export interface DriverProfile {
  id: number;
  traccarDriverId: number | null;
  name: string;
  phone: string | null;
  licenceNo: string | null;
  licenceExpiry: string | null;
  aadhar: string | null;
  monthlySalary: number;
  dailyBata: number;
  tripAllowance: number;
  status: string;
  joinedOn: string | null;
  notes: string | null;
}
interface Roster {
  drivers: (DriverProfile & { vehicleNo: string | null; since: string | null; today: string | null })[];
  standby: { id: number; name: string }[];
  vehiclesWithoutDriver: { deviceId: number; vehicleNo: string; status: string | null }[];
}
interface Overview {
  onRoll: number;
  onTrucks: number;
  standby: number;
  presentToday: number;
  absentToday: number;
  leaveToday: number;
  notMarkedToday: number;
  trucksWithoutDriver: number;
  avgDrivingHours: number | null;
  drivingLimit: number;
  overLimitDrivers: number;
  complianceAlerts: number;
  avgScore: number | null;
  payroll: PayrollRun | null;
  payrollTrend: { month: string; gross: number; net: number; status: string }[];
  attendance30: { date: string; present: number; absent: number; leave: number }[];
  topDrivers: { driverId: number; name: string; km: number; score: number }[];
  scoreBands: { band: string; drivers: number }[];
  licence: { driverId: number; name: string; licenceNo: string | null; licenceExpiry: string | null; issue: string }[];
  roster: { driverId: number; name: string; vehicleNo: string | null; today: string | null; score: number | null; km: number }[];
}
interface PayrollLine {
  driverId: number;
  name: string;
  presentDays: number;
  paidDays: number;
  trips: number;
  basic: number;
  bata: number;
  tripPay: number;
  gross: number;
  chargeDeductions: { chargeId: number; dcNo: string; amount: number }[];
  deductions: number;
  net: number;
}
interface PayrollRun { id: number; prNo: string; month: string; lines: PayrollLine[]; gross: number; deductions: number; net: number; status: string; paidAt: string | null; paymentRef: string | null }
interface Preview { month: string; days: number; lines: PayrollLine[]; gross: number; deductions: number; net: number; unmarked: string[] }
interface AttendanceGrid { month: string; days: number; drivers: { driverId: number; name: string; codes: Record<string, string>; totals: { present: number; paid: number; absent: number; leave: number; weeklyOff: number; marked: number } }[] }
interface Hours { driverId: number; name: string; daysWorked: number; totalHours: number; avgPerDay: number; maxDay: number; daysOverLimit: number; km: number; last7: { date: string; hours: number }[]; compliant: boolean }

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

const exportPayroll = async (month: string) => {
  const p = await http<Preview>(`/erp/drivers/payroll/preview?month=${month}`);
  downloadCsv(`payroll-${month}.csv`, [
    ['Driver', 'Present days', 'Paid days', 'Trips', 'Basic', 'Bata', 'Trip pay', 'Gross', 'Deductions', 'Net'],
    ...p.lines.map((l) => [l.name, l.presentDays, l.paidDays, l.trips, l.basic, l.bata, l.tripPay, l.gross, l.deductions, l.net]),
  ]);
};
const exportAttendance = async (month: string) => {
  const g = await http<AttendanceGrid>(`/erp/drivers/attendance?month=${month}`);
  const dates = Array.from({ length: g.days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  downloadCsv(`attendance-${month}.csv`, [
    ['Driver', ...dates.map((d) => d.slice(8)), 'Present', 'Paid', 'Absent'],
    ...g.drivers.map((d) => [d.name, ...dates.map((x) => d.codes[x] ?? ''), d.totals.present, d.totals.paid, d.totals.absent]),
  ]);
};

export function DriverManagementPage() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const access = useAccess();
  const tab = Math.max(0, TABS.indexOf((params.get('tab') ?? 'overview') as (typeof TABS)[number]));
  const act = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSettled: () => qc.invalidateQueries({ queryKey: ['drivers'] }) });
  const done = act.data as { created?: number; linked?: number; assigned?: number } | undefined;
  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
        <Box>
          <Typography variant="h5">Driver Management</Typography>
          <Typography color="text.secondary">Assignment, working hours, attendance and payroll.</Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
          {access.can('payroll', 'create') && <Button variant="outlined" onClick={() => act.mutate(() => post('/erp/drivers/sync'))}>Sync from Traccar</Button>}
          {access.can('payroll', 'edit') && <Button variant="outlined" onClick={() => act.mutate(() => post('/erp/drivers/auto-assign'))}>Auto-assign waiting trucks</Button>}
          <Button onClick={() => act.mutate(() => exportPayroll(lastMonth()))}>Export payroll</Button>
          <Button onClick={() => act.mutate(() => exportAttendance(thisMonth()))}>Export attendance</Button>
        </Stack>
      </Stack>
      {act.isError && <Alert severity="error" onClose={() => act.reset()}>{errorMessage(act.error)}</Alert>}
      {done?.created !== undefined && <Alert severity="success" onClose={() => act.reset()}>Synced: {done.created} new profiles, {done.linked ?? 0} linked by name.</Alert>}
      {done?.assigned !== undefined && <Alert severity="success" onClose={() => act.reset()}>Assigned {done.assigned} standby drivers to trucks.</Alert>}
      <Tabs value={tab} onChange={(_, v) => setParams({ tab: TABS[v] })} variant="scrollable">
        <Tab label="Overview" />
        <Tab label="Drivers & assignment" />
        <Tab label="Working hours" />
        <Tab label="Attendance" />
        <Tab label="Payroll" />
      </Tabs>
      {tab === 0 && <OverviewTab />}
      {tab === 1 && <DriversTab />}
      {tab === 2 && <HoursTab />}
      {tab === 3 && <AttendanceTab />}
      {tab === 4 && <PayrollTab />}
    </Stack>
  );
}

/* ------------------------------------------------------------ overview */

function OverviewTab() {
  const o = useQuery({ queryKey: ['drivers', 'overview'], queryFn: () => http<Overview>('/erp/drivers/overview') });
  const d = o.data;
  if (o.isError) return <Alert severity="error">{errorMessage(o.error)}</Alert>;
  if (!d) return <Typography color="text.secondary">Loading…</Typography>;
  return (
    <Stack spacing={2}>
      <Kpis
        items={[
          ['Drivers on roll', num(d.onRoll), `${d.onTrucks} on trucks · ${d.standby} standby`],
          ['On duty today', num(d.presentToday), `${d.absentToday} absent · ${d.leaveToday} leave/off · ${d.notMarkedToday} not marked`],
          ['Trucks without driver', num(d.trucksWithoutDriver)],
          ['Avg driving / day', d.avgDrivingHours !== null ? `${d.avgDrivingHours} h` : '—', `limit ${d.drivingLimit} h · ${d.overLimitDrivers} over limit (7 days)`],
          ['Compliance alerts', num(d.complianceAlerts), 'licence missing or expiring'],
          ['Payroll', d.payroll ? inr(d.payroll.net) : '—', d.payroll ? `${d.payroll.month} · gross ${inr(d.payroll.gross)} · ${d.payroll.status.replace(/_/g, ' ')}` : 'not run yet'],
          ['Average score', d.avgScore !== null ? `${d.avgScore}/100` : '—', 'last 30 days, from GPS events'],
        ]}
      />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Card>
            <CardContent>
              <Typography variant="h6">Attendance, last 30 days</Typography>
              <Box sx={{ height: 240 }}>
                <ResponsiveContainer>
                  <BarChart data={d.attendance30.map((a) => ({ ...a, label: dayjs(a.date).format('D MMM') }))}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" fontSize={11} />
                    <YAxis allowDecimals={false} fontSize={12} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="present" name="Present" stackId="a" fill={CODE_COLOR.P} />
                    <Bar dataKey="leave" name="Leave / off" stackId="a" fill={CODE_COLOR.L} />
                    <Bar dataKey="absent" name="Absent" stackId="a" fill={CODE_COLOR.A} />
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6">Score distribution</Typography>
              <Box sx={{ height: 240 }}>
                <ResponsiveContainer>
                  <BarChart data={d.scoreBands}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="band" fontSize={12} />
                    <YAxis allowDecimals={false} fontSize={12} />
                    <Tooltip />
                    <Bar dataKey="drivers" name="Drivers" fill={COLORS[0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6">Top drivers</Typography>
              <List dense>
                {d.topDrivers.length === 0 && <Typography color="text.secondary">No scored drivers yet.</Typography>}
                {d.topDrivers.map((t, i) => (
                  <ListItem key={t.driverId} disableGutters divider>
                    <ListItemText primary={`${i + 1}. ${t.name}`} secondary={`${num(t.km)} km`} />
                    <Chip size="small" color={t.score >= 90 ? 'success' : t.score >= 70 ? 'warning' : 'error'} label={t.score} />
                  </ListItem>
                ))}
              </List>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6">Licence & compliance</Typography>
              <List dense sx={{ maxHeight: 300, overflow: 'auto' }}>
                {d.licence.length === 0 && <Typography color="text.secondary">All licences are on file and valid.</Typography>}
                {d.licence.map((l) => (
                  <ListItem key={l.driverId} disableGutters divider>
                    <ListItemText primary={l.name} secondary={[l.issue, l.licenceNo, l.licenceExpiry ? dayjs(l.licenceExpiry).format('D MMM YYYY') : null].filter(Boolean).join(' · ')} />
                  </ListItem>
                ))}
              </List>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6">Today's roster</Typography>
              <Table size="small">
                <TableHead><TableRow>{['Driver', 'Vehicle', 'Today', 'Score'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
                <TableBody>
                  {d.roster.map((r) => (
                    <TableRow key={r.driverId}>
                      <TableCell>{r.name}</TableCell>
                      <TableCell>{r.vehicleNo ?? <Typography variant="caption" color="text.secondary">standby</Typography>}</TableCell>
                      <TableCell>{r.today ? <Chip size="small" label={CODE_LABEL[r.today]} sx={{ bgcolor: CODE_COLOR[r.today], color: '#fff' }} /> : '—'}</TableCell>
                      <TableCell>{r.score ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Stack>
  );
}

/* ------------------------------------------------- drivers & assignment */

function AssignSelect({ driver, roster, onAssign }: { driver: Roster['drivers'][number] | undefined; roster: Roster | undefined; onAssign: (vehicleNo: string) => void }) {
  const free = roster?.vehiclesWithoutDriver.map((v) => v.vehicleNo.toUpperCase()) ?? [];
  const taken = roster?.drivers.filter((d) => d.vehicleNo && d.id !== driver?.id).map((d) => d.vehicleNo!) ?? [];
  return (
    <TextField
      select
      size="small"
      label="Vehicle"
      value={driver?.vehicleNo ?? ''}
      onChange={(e) => e.target.value && onAssign(e.target.value)}
      sx={{ minWidth: 170 }}
      slotProps={{ inputLabel: { shrink: true } }}
    >
      <MenuItem value="" disabled>Choose…</MenuItem>
      {driver?.vehicleNo && <MenuItem value={driver.vehicleNo}>{driver.vehicleNo}</MenuItem>}
      {free.length > 0 && <MenuItem disabled><Typography variant="caption">Without driver</Typography></MenuItem>}
      {free.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
      {taken.length > 0 && <MenuItem disabled><Typography variant="caption">Reassign from another driver</Typography></MenuItem>}
      {taken.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
    </TextField>
  );
}

function DriversTab() {
  const qc = useQueryClient();
  const access = useAccess();
  const edit = access.can('payroll', 'edit');
  const roster = useQuery({ queryKey: ['drivers', 'roster'], queryFn: () => http<Roster>('/erp/drivers/roster') });
  const history = useQuery({ queryKey: ['drivers', 'assignments'], queryFn: () => http<{ id: number; driverName: string; vehicleNo: string; fromAt: string; toAt: string | null; remarks: string | null }[]>('/erp/drivers/assignments') });
  const byId = new Map(roster.data?.drivers.map((d) => [d.id, d]));
  const refresh = () => qc.invalidateQueries({ queryKey: ['drivers'] });
  const config: EntityConfig<DriverProfile> = {
    title: 'Driver profiles',
    singular: 'driver',
    subtitle: 'Pay, licence and KYC details. Profiles are linked to Traccar drivers by “Sync from Traccar”.',
    endpoint: '/erp/drivers/profiles',
    queryKey: 'driver-profiles',
    docType: 'payroll',
    defaults: { status: 'active', monthlySalary: 0, dailyBata: 0, tripAllowance: 0 },
    searchText: (d) => `${d.name} ${d.phone ?? ''} ${d.licenceNo ?? ''} ${byId.get(d.id)?.vehicleNo ?? ''}`,
    columns: [
      { label: 'Driver', render: (d) => <Box><b>{d.name}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{d.phone ?? ''}{d.traccarDriverId ? ' · linked' : ''}</Typography></Box>, csv: (d) => d.name },
      { label: 'Licence', render: (d) => <Box>{d.licenceNo ?? '—'}<Typography variant="caption" color={d.licenceExpiry && d.licenceExpiry < dayjs().format('YYYY-MM-DD') ? 'error' : 'text.secondary'} sx={{ display: 'block' }}>{d.licenceExpiry ? `exp. ${dayjs(d.licenceExpiry).format('D MMM YYYY')}` : ''}</Typography></Box>, csv: (d) => d.licenceNo },
      { label: 'Aadhar', render: (d) => maskAadhar(d.aadhar), csv: (d) => maskAadhar(d.aadhar) },
      { label: 'Pay', render: (d) => <Box>{inr(d.monthlySalary)}/month<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>bata {inr(d.dailyBata)}/day · {inr(d.tripAllowance)}/trip</Typography></Box>, csv: (d) => d.monthlySalary },
      { label: 'Vehicle', render: (d) => byId.get(d.id)?.vehicleNo ?? (d.status === 'active' ? <Chip size="small" label="Standby" variant="outlined" /> : '—'), csv: (d) => byId.get(d.id)?.vehicleNo ?? '' },
      { label: 'Status', render: (d) => <StatusChip status={d.status === 'active' ? 'active' : 'cancelled'} />, csv: (d) => d.status },
    ],
    fields: [
      { section: 'Driver', path: 'name', label: 'Name', required: true },
      { section: 'Driver', path: 'phone', label: 'Phone' },
      { section: 'Driver', path: 'licenceNo', label: 'Driving licence no.' },
      { section: 'Driver', path: 'licenceExpiry', label: 'Licence expiry', type: 'day' },
      { section: 'Driver', path: 'aadhar', label: 'Aadhar number', helper: '12 digits' },
      { section: 'Driver', path: 'joinedOn', label: 'Joined on', type: 'day' },
      { section: 'Driver', path: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
      { section: 'Pay', path: 'monthlySalary', label: 'Monthly salary (₹)', type: 'number' },
      { section: 'Pay', path: 'dailyBata', label: 'Daily bata (₹)', type: 'number', helper: 'Per day worked' },
      { section: 'Pay', path: 'tripAllowance', label: 'Trip allowance (₹)', type: 'number', helper: 'Per completed trip' },
      { section: 'Pay', path: 'notes', label: 'Notes', type: 'textarea' },
    ],
    rowActions: (d, run) =>
      edit &&
      d.status === 'active' && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <AssignSelect driver={byId.get(d.id)} roster={roster.data} onAssign={(vehicleNo) => run(async () => { await post('/erp/drivers/assign', { driverId: d.id, vehicleNo }); await refresh(); })} />
          {byId.get(d.id)?.vehicleNo && <Button size="small" color="inherit" onClick={() => run(async () => { await post(`/erp/drivers/${d.id}/unassign`); await refresh(); })}>Unassign</Button>}
        </Stack>
      ),
  };
  return (
    <Stack spacing={2}>
      <EntityPage config={config} />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6">Standby pool</Typography>
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mt: 1 }}>
                {roster.data?.standby.length === 0 && <Typography color="text.secondary">Every active driver has a truck.</Typography>}
                {roster.data?.standby.map((s) => <Chip key={s.id} label={s.name} />)}
              </Stack>
              <Typography variant="h6" sx={{ mt: 2 }}>Trucks without a driver</Typography>
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mt: 1 }}>
                {roster.data?.vehiclesWithoutDriver.length === 0 && <Typography color="text.secondary">None.</Typography>}
                {roster.data?.vehiclesWithoutDriver.map((v) => <Chip key={v.deviceId} variant="outlined" color={v.status === 'online' ? 'primary' : 'default'} label={v.vehicleNo} />)}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 8 }}>
          <Card>
            <CardContent><Typography variant="h6">Assignment history</Typography></CardContent>
            <TableContainer sx={{ maxHeight: 360 }}>
              <Table size="small" stickyHeader>
                <TableHead><TableRow>{['Driver', 'Vehicle', 'From', 'To', 'Remarks'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
                <TableBody>
                  {history.data?.length === 0 && <TableRow><TableCell colSpan={5}><Typography color="text.secondary">No assignments yet.</Typography></TableCell></TableRow>}
                  {history.data?.map((h) => (
                    <TableRow key={h.id} hover>
                      <TableCell>{h.driverName}</TableCell>
                      <TableCell>{h.vehicleNo}</TableCell>
                      <TableCell>{dayjs(h.fromAt).format('D MMM YYYY HH:mm')}</TableCell>
                      <TableCell>{h.toAt ? dayjs(h.toAt).format('D MMM YYYY HH:mm') : <Chip size="small" color="success" label="Current" />}</TableCell>
                      <TableCell>{h.remarks ?? ''}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </Grid>
      </Grid>
    </Stack>
  );
}

/* ------------------------------------------------------- working hours */

function Spark({ days, limit }: { days: { date: string; hours: number }[]; limit: number }) {
  const max = Math.max(limit, ...days.map((d) => d.hours));
  return (
    <Stack direction="row" spacing={0.25} sx={{ alignItems: 'flex-end', height: 28 }}>
      {days.map((d) => (
        <MuiTooltip key={d.date} title={`${dayjs(d.date).format('ddd D MMM')}: ${d.hours} h`}>
          <Box sx={{ width: 8, height: `${Math.max(2, (d.hours / max) * 28)}px`, bgcolor: d.hours > limit ? 'error.main' : d.hours ? 'primary.main' : 'action.disabled', borderRadius: 0.5 }} />
        </MuiTooltip>
      ))}
    </Stack>
  );
}

function HoursTab() {
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ['drivers', 'hours', days], queryFn: () => http<Hours[]>(`/erp/drivers/hours?days=${days}`) });
  const rows = q.data ?? [];
  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
        <Typography color="text.secondary">Driving time from GPS trips, credited to the driver who had the truck. Daily limit 9 h.</Typography>
        <ToggleButtonGroup size="small" exclusive value={days} onChange={(_, v) => v && setDays(v)}>
          {[7, 30, 90].map((d) => <ToggleButton key={d} value={d}>{d} days</ToggleButton>)}
        </ToggleButtonGroup>
      </Stack>
      {q.isError && <Alert severity="error">{errorMessage(q.error)}</Alert>}
      <Card sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead><TableRow>{['Driver', 'Days worked', 'Avg driving / day', 'Total hours', 'Longest day', 'Days over limit', 'Km', 'Last 7 days', 'Compliance'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
          <TableBody>
            {q.isSuccess && rows.length === 0 && <TableRow><TableCell colSpan={9}><Typography color="text.secondary">No drivers yet.</Typography></TableCell></TableRow>}
            {rows.map((h) => (
              <TableRow key={h.driverId} hover>
                <TableCell>{h.name}</TableCell>
                <TableCell>{h.daysWorked}</TableCell>
                <TableCell>{h.avgPerDay} h</TableCell>
                <TableCell>{h.totalHours} h</TableCell>
                <TableCell sx={{ color: h.maxDay > 9 ? 'error.main' : undefined }}>{h.maxDay} h</TableCell>
                <TableCell>{h.daysOverLimit}</TableCell>
                <TableCell>{num(h.km)}</TableCell>
                <TableCell><Spark days={h.last7} limit={9} /></TableCell>
                <TableCell><Chip size="small" color={h.compliant ? 'success' : 'error'} label={h.compliant ? 'Within limit' : 'Over limit'} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </Stack>
  );
}

/* ---------------------------------------------------------- attendance */

function AttendanceTab() {
  const qc = useQueryClient();
  const access = useAccess();
  const edit = access.can('payroll', 'edit');
  const [month, setMonth] = useState(thisMonth());
  const [changes, setChanges] = useState<Record<string, string>>({}); // `${driverId}|${date}` → code ('' clears)
  const [menu, setMenu] = useState<{ anchor: HTMLElement; driverId: number; date: string } | null>(null);
  const grid = useQuery({ queryKey: ['drivers', 'attendance', month], queryFn: () => http<AttendanceGrid>(`/erp/drivers/attendance?month=${month}`) });
  const save = useMutation({
    mutationFn: () => http('/erp/drivers/attendance', { method: 'PUT', body: JSON.stringify({ entries: Object.entries(changes).map(([k, code]) => ({ driverId: Number(k.split('|')[0]), date: k.split('|')[1], code })) }) }),
    onSuccess: () => setChanges({}),
    onSettled: () => qc.invalidateQueries({ queryKey: ['drivers'] }),
  });
  const g = grid.data;
  const today = dayjs().format('YYYY-MM-DD');
  const dates = g ? Array.from({ length: g.days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`) : [];
  const codeOf = (driverId: number, date: string, saved: Record<string, string>) => {
    const k = `${driverId}|${date}`;
    return k in changes ? changes[k] : (saved[date] ?? '');
  };
  const setCode = (driverId: number, date: string, code: string, saved: Record<string, string>) => {
    const k = `${driverId}|${date}`;
    setChanges((c) => {
      const next = { ...c };
      if ((saved[date] ?? '') === code) delete next[k];
      else next[k] = code;
      return next;
    });
  };
  const markAllToday = () => {
    if (!g) return;
    g.drivers.forEach((d) => !codeOf(d.driverId, today, d.codes) && setCode(d.driverId, today, 'P', d.codes));
  };
  const pending = Object.keys(changes).length;
  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' } }}>
        <TextField size="small" type="month" label="Month" value={month} onChange={(e) => { setMonth(e.target.value || thisMonth()); setChanges({}); }} slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: thisMonth() } }} />
        {edit && month === thisMonth() && <Button variant="outlined" onClick={markAllToday}>Mark all present today</Button>}
        {edit && <Button variant="contained" disabled={!pending || save.isPending} onClick={() => save.mutate()}>Save {pending ? `${pending} change${pending > 1 ? 's' : ''}` : ''}</Button>}
        {pending > 0 && <Button color="inherit" onClick={() => setChanges({})}>Discard</Button>}
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
          {CODES.map((c) => <Chip key={c} size="small" label={`${c} ${CODE_LABEL[c]}`} sx={{ bgcolor: CODE_COLOR[c], color: '#fff' }} />)}
        </Stack>
      </Stack>
      <Typography variant="caption" color="text.secondary">Click a day to cycle P → H → L → A → WO → blank; right-click to choose. Future days are locked, as is a month whose payroll is approved.</Typography>
      {save.isError && <Alert severity="error">{errorMessage(save.error)}</Alert>}
      {save.isSuccess && <Alert severity="success" onClose={() => save.reset()}>Attendance saved.</Alert>}
      <Card>
        <TableContainer sx={{ maxHeight: 560 }}>
          <Table size="small" stickyHeader sx={{ '& td, & th': { px: 0.5, textAlign: 'center' } }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700, textAlign: 'left !important', minWidth: 150, position: 'sticky', left: 0, zIndex: 3 }}>Driver</TableCell>
                {dates.map((d) => <TableCell key={d} sx={{ fontWeight: 700, color: dayjs(d).day() === 0 ? 'error.main' : undefined }}>{Number(d.slice(8))}<Typography variant="caption" sx={{ display: 'block' }}>{dayjs(d).format('dd')}</Typography></TableCell>)}
                {['P', 'Paid', 'A', 'Rate'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {g?.drivers.length === 0 && <TableRow><TableCell colSpan={dates.length + 5}><Typography color="text.secondary">No active drivers. Use “Sync from Traccar”.</Typography></TableCell></TableRow>}
              {g?.drivers.map((d) => {
                const codes = dates.map((x) => codeOf(d.driverId, x, d.codes));
                const present = codes.filter((c) => c === 'P').length + codes.filter((c) => c === 'H').length * 0.5;
                const paid = present + codes.filter((c) => c === 'L' || c === 'WO').length;
                const marked = codes.filter(Boolean).length;
                return (
                  <TableRow key={d.driverId} hover>
                    <TableCell sx={{ textAlign: 'left !important', position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1 }}>{d.name}</TableCell>
                    {dates.map((x, i) => {
                      const c = codes[i];
                      const future = x > today;
                      const changed = `${d.driverId}|${x}` in changes;
                      return (
                        <TableCell
                          key={x}
                          data-testid={`att-${d.driverId}-${x}`}
                          onClick={() => !future && edit && setCode(d.driverId, x, CODES[(CODES.indexOf(c as (typeof CODES)[number]) + 1) % (CODES.length + 1)] ?? '', d.codes)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            if (!future && edit) setMenu({ anchor: e.currentTarget, driverId: d.driverId, date: x });
                          }}
                          sx={{ cursor: future || !edit ? 'default' : 'pointer', bgcolor: future ? 'action.disabledBackground' : c ? CODE_COLOR[c] : undefined, color: c ? '#fff' : undefined, fontWeight: 600, fontSize: 12, outline: changed ? '2px solid #000' : undefined, outlineOffset: -2, minWidth: 26 }}
                        >
                          {c}
                        </TableCell>
                      );
                    })}
                    <TableCell>{present}</TableCell>
                    <TableCell>{paid}</TableCell>
                    <TableCell>{codes.filter((c) => c === 'A').length}</TableCell>
                    <TableCell>{marked ? `${Math.round((present / marked) * 100)}%` : '—'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}>
        {menu && [...CODES, ''].map((c) => (
          <MenuItem key={c || 'clear'} onClick={() => { const d = g!.drivers.find((x) => x.driverId === menu.driverId)!; setCode(menu.driverId, menu.date, c, d.codes); setMenu(null); }}>
            {c ? `${c} · ${CODE_LABEL[c]}` : 'Clear'}
          </MenuItem>
        ))}
      </Menu>
    </Stack>
  );
}

/* ------------------------------------------------------------- payroll */

function PayrollTab() {
  const qc = useQueryClient();
  const access = useAccess();
  const [month, setMonth] = useState(lastMonth());
  const [dialog, ask] = useFormDialog();
  const preview = useQuery({ queryKey: ['drivers', 'payroll-preview', month], queryFn: () => http<Preview>(`/erp/drivers/payroll/preview?month=${month}`), enabled: /^\d{4}-\d{2}$/.test(month) });
  const runs = useQuery({ queryKey: ['drivers', 'payroll-runs'], queryFn: () => http<PayrollRun[]>('/erp/drivers/payroll') });
  const act = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSettled: () => qc.invalidateQueries({ queryKey: ['drivers'] }) });
  const [open, setOpen] = useState<number | null>(null);
  const p = preview.data;
  const existing = runs.data?.find((r) => r.month === month);
  const ran = act.data as PayrollRun | undefined;
  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
        <TextField size="small" type="month" label="Month" value={month} onChange={(e) => setMonth(e.target.value || lastMonth())} slotProps={{ inputLabel: { shrink: true } }} />
        {access.can('payroll', 'create') && (
          <Button variant="contained" disabled={!p?.lines.length || act.isPending || (existing && !['draft', 'rejected'].includes(existing.status))} onClick={() => act.mutate(() => post('/erp/drivers/payroll', { month }))}>
            {existing && ['draft', 'rejected'].includes(existing.status) ? 'Re-run payroll' : 'Run payroll'}
          </Button>
        )}
        <Button onClick={() => exportPayroll(month)}>Export CSV</Button>
        {existing && <Typography variant="body2" component="div">{existing.prNo}: <StatusChip status={existing.status} /></Typography>}
      </Stack>
      {act.isError && <Alert severity="error" onClose={() => act.reset()}>{errorMessage(act.error)}</Alert>}
      {ran?.prNo && <Alert severity="success" onClose={() => act.reset()}>{ran.prNo} {ran.status === 'pending_approval' ? 'sent for approval' : ran.status.replace('_', ' ')}.</Alert>}
      {preview.isError && <Alert severity="error">{errorMessage(preview.error)}</Alert>}
      {p && p.unmarked.length > 0 && <Alert severity="warning">No attendance marked in {dayjs(`${month}-01`).format('MMMM YYYY')} for: {p.unmarked.join(', ')}. They will be paid for 0 days.</Alert>}
      {p && (
        <Card sx={{ overflowX: 'auto' }}>
          <CardContent>
            <Typography variant="h6">Preview · {dayjs(`${month}-01`).format('MMMM YYYY')} ({p.days} days)</Typography>
            <Typography variant="body2" color="text.secondary">Gross {inr(p.gross)} · deductions {inr(p.deductions)} · net {inr(p.net)}</Typography>
          </CardContent>
          <Table size="small">
            <TableHead><TableRow>{['Driver', 'Present', 'Paid days', 'Trips', 'Basic', 'Bata', 'Trip pay', 'Gross', 'Charge deductions', 'Net'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
            <TableBody>
              {p.lines.map((l) => (
                <TableRow key={l.driverId} hover>
                  <TableCell>{l.name}</TableCell>
                  <TableCell>{l.presentDays}</TableCell>
                  <TableCell>{l.paidDays}</TableCell>
                  <TableCell>{l.trips}</TableCell>
                  <TableCell>{inr(l.basic)}</TableCell>
                  <TableCell>{inr(l.bata)}</TableCell>
                  <TableCell>{inr(l.tripPay)}</TableCell>
                  <TableCell>{inr(l.gross)}</TableCell>
                  <TableCell>{l.chargeDeductions.length ? l.chargeDeductions.map((c) => <Typography key={c.chargeId} variant="caption" sx={{ display: 'block' }}>{c.dcNo}: {inr(c.amount)}</Typography>) : '—'}</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>{inr(l.net)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Card sx={{ overflowX: 'auto' }}>
        <CardContent><Typography variant="h6">Salary register</Typography></CardContent>
        <Table size="small">
          <TableHead><TableRow>{['Run', 'Month', 'Drivers', 'Gross', 'Deductions', 'Net', 'Status', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
          <TableBody>
            {runs.data?.length === 0 && <TableRow><TableCell colSpan={8}><Typography color="text.secondary">No payroll runs yet.</Typography></TableCell></TableRow>}
            {runs.data?.map((r) => (
              <Fragment key={r.id}>
                <TableRow hover sx={{ cursor: 'pointer' }} onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <TableCell><b>{r.prNo}</b></TableCell>
                  <TableCell>{dayjs(`${r.month}-01`).format('MMM YYYY')}</TableCell>
                  <TableCell>{r.lines.length}</TableCell>
                  <TableCell>{inr(r.gross)}</TableCell>
                  <TableCell>{inr(r.deductions)}</TableCell>
                  <TableCell>{inr(r.net)}</TableCell>
                  <TableCell><StatusChip status={r.status} />{r.paymentRef && <Typography variant="caption" sx={{ display: 'block' }}>{r.paymentRef}</Typography>}</TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    {r.status === 'approved' && access.can('payroll', 'edit') && (
                      <Button
                        size="small"
                        variant="contained"
                        onClick={async () => {
                          const v = await ask({ title: `Pay ${r.prNo} (${inr(r.net)})`, fields: [{ path: 'paymentRef', label: 'Payment reference (UTR / batch no.)' }] });
                          if (v) act.mutate(() => post(`/erp/drivers/payroll/${r.id}/pay`, v));
                        }}
                      >
                        Pay
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
                {open === r.id && (
                  <TableRow>
                    <TableCell colSpan={8} sx={{ bgcolor: 'action.hover' }}>
                      {r.lines.map((l) => (
                        <Typography key={l.driverId} variant="body2">{l.name}: {l.paidDays} paid days, gross {inr(l.gross)}, deductions {inr(l.deductions)}, net <b>{inr(l.net)}</b></Typography>
                      ))}
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </Card>
      {dialog}
    </Stack>
  );
}
