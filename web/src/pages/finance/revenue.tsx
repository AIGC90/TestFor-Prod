import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import LightbulbOutlined from '@mui/icons-material/LightbulbOutlined';
import { Alert, Box, Button, Card, CardContent, Chip, Grid, List, ListItem, ListItemIcon, ListItemText, MenuItem, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { type ReactNode, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import { http } from '../../api/http';
import { EntityPage, type EntityConfig, type Option } from '../../components/EntityPage';
import { useFormDialog } from '../../components/useFormDialog';
import { useAccess } from '../../lib/access';
import { downloadCsv } from '../../lib/csv';
import { inr, num, partyOptions, StatusChip, useNames } from '../inventory/shared';
import { vehicleOptions } from '../workshop/workshop';

const post = (url: string, body?: unknown) => http(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const COLORS = ['#0b5cad', '#f57c00', '#2e7d32', '#6a1b9a', '#c62828', '#00838f'];
const short = (n: number) => (Math.abs(n) >= 1e7 ? `₹${(n / 1e7).toFixed(1)}Cr` : Math.abs(n) >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L` : Math.abs(n) >= 1e3 ? `₹${(n / 1e3).toFixed(0)}k` : `₹${Math.round(n)}`);
const pctText = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);

/* --------------------------------------------------------------- period */

const PRESETS = [
  ['month', 'This month'],
  ['30', '30 days'],
  ['90', '90 days'],
  ['180', '6 months'],
  ['fy', 'FY to date'],
  ['365', '12 months'],
] as const;
type Preset = (typeof PRESETS)[number][0];

export function presetRange(p: Preset, now = dayjs()): { from: string; to: string } {
  const to = now.add(1, 'day').startOf('day');
  if (p === 'month') return { from: now.startOf('month').toISOString(), to: to.toISOString() };
  if (p === 'fy') {
    // Indian financial year starts on 1 April
    const fyStart = now.month() >= 3 ? now.month(3).startOf('month') : now.subtract(1, 'year').month(3).startOf('month');
    return { from: fyStart.toISOString(), to: to.toISOString() };
  }
  return { from: to.subtract(Number(p), 'day').toISOString(), to: to.toISOString() };
}

interface Costs { fuel: number; tolls: number; driverPay: number; maintenance: number; tyres: number; marketHire: number }
interface VehicleRow { vehicleNo: string; model: string | null; trips: number; km: number; revenue: number; costs: Costs; expenses: number; profit: number; margin: number | null; revenuePerKm: number | null; costPerKm: number | null; utilisation: number | null; runningHours: number; drivingHours: number; idleHours: number; kmPerLitre: number | null }
interface Lane { lane: string; trips: number; km: number; revenue: number; cost: number; contribution: number; margin: number | null; revenuePerKm: number | null }
export interface Analytics {
  period: { from: string; to: string; days: number; vehicleNo: string | null };
  kpis: { revenue: number; expenses: number; profit: number; margin: number | null; trips: number; km: number; revenuePerKm: number | null; costPerKm: number | null; utilisation: number | null; outstanding: number; overdue: number; dso: number | null; collected30: number; openInvoices: number; litres: number; kmPerLitre: number | null; idleLossPct: number | null };
  daily: { date: string; revenue: number; expenses: number; profit: number }[];
  expenseMix: { category: string; key: string; amount: number; perKm: number | null }[];
  costPerKmBreakdown: { category: string; key: string; amount: number; perKm: number | null }[];
  weekday: { day: string; revenue: number }[];
  topCustomers: { customerId: number; customer: string; trips: number; revenue: number }[];
  lanes: Lane[];
  vehicles: VehicleRow[];
  insights: string[];
}
const COST_LABEL: [keyof Costs, string][] = [['fuel', 'Fuel'], ['tolls', 'Tolls'], ['driverPay', 'Driver pay'], ['maintenance', 'Maintenance'], ['tyres', 'Tyres'], ['marketHire', 'Market hire']];

function useAnalytics(preset: Preset, vehicle: string) {
  const r = presetRange(preset);
  return useQuery({
    queryKey: ['finance-analytics', preset, vehicle],
    queryFn: () => http<Analytics>(`/erp/finance/analytics?from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}${vehicle ? `&vehicleNo=${encodeURIComponent(vehicle)}` : ''}`),
  });
}

function Filters({ preset, setPreset, vehicle, setVehicle, onExport }: { preset: Preset; setPreset: (p: Preset) => void; vehicle: string; setVehicle: (v: string) => void; onExport?: () => void }) {
  const vehicles = useQuery({ queryKey: ['options', 'vehicle-name-options'], queryFn: vehicleOptions });
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
      <TextField select size="small" label="Vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value)} sx={{ minWidth: 220 }}>
        <MenuItem value="">All vehicles</MenuItem>
        {vehicles.data?.map((v) => <MenuItem key={String(v.value)} value={String(v.value)}>{v.label}</MenuItem>)}
      </TextField>
      <TextField select size="small" label="Period" value={preset} onChange={(e) => setPreset(e.target.value as Preset)} sx={{ minWidth: 160 }}>
        {PRESETS.map(([k, l]) => <MenuItem key={k} value={k}>{l}</MenuItem>)}
      </TextField>
      {onExport && <Button startIcon={<FileDownloadOutlined />} onClick={onExport}>Export</Button>}
    </Stack>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="body2" color="text.secondary">{label}</Typography>
        <Typography variant="h6" sx={{ color: tone === 'good' ? 'success.main' : tone === 'bad' ? 'error.main' : undefined }}>{value}</Typography>
        {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, subtitle, height = 260, children }: { title: string; subtitle?: string; height?: number; children: ReactNode }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="h6">{title}</Typography>
        {subtitle && <Typography variant="body2" color="text.secondary">{subtitle}</Typography>}
        <Box sx={{ height, mt: 1 }}>{children}</Box>
      </CardContent>
    </Card>
  );
}

function SimpleTable<T>({ head, rows, cells, empty = 'Nothing in this period.' }: { head: string[]; rows: T[]; cells: (r: T) => ReactNode[]; empty?: string }) {
  return (
    <TableContainer>
      <Table size="small">
        <TableHead><TableRow>{head.map((h) => <TableCell key={h} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</TableCell>)}</TableRow></TableHead>
        <TableBody>
          {rows.length === 0 && <TableRow><TableCell colSpan={head.length}><Typography color="text.secondary" sx={{ py: 1 }}>{empty}</Typography></TableCell></TableRow>}
          {rows.map((r, i) => <TableRow key={i} hover>{cells(r).map((c, j) => <TableCell key={j}>{c}</TableCell>)}</TableRow>)}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

const margin = (m: number | null) => <Typography component="span" sx={{ fontWeight: 600, color: m === null ? 'text.secondary' : m < 0 ? 'error.main' : m < 10 ? 'warning.main' : 'success.main' }}>{pctText(m)}</Typography>;

function exportVehicles(a: Analytics | undefined) {
  if (!a) return;
  downloadCsv(`vehicle-pnl-${dayjs().format('YYYYMMDD')}.csv`, [
    ['Vehicle', 'Model', 'Trips', 'Km', 'Revenue', ...COST_LABEL.map(([, l]) => l), 'Expenses', 'Profit', 'Margin %', 'Revenue/km', 'Cost/km', 'Utilisation %', 'Km/L'],
    ...a.vehicles.map((v) => [v.vehicleNo, v.model, v.trips, v.km, v.revenue, ...COST_LABEL.map(([k]) => v.costs[k]), v.expenses, v.profit, v.margin, v.revenuePerKm, v.costPerKm, v.utilisation, v.kmPerLitre]),
  ]);
}

/* ------------------------------------------------------ revenue page */

export function RevenuePage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const [preset, setPreset] = useState<Preset>('30');
  const [vehicle, setVehicle] = useState('');
  const q = useAnalytics(preset, vehicle);
  const a = q.data;
  const k = a?.kpis;
  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
        <Box>
          <Typography variant="h5">Revenue & Financials</Typography>
          <Typography color="text.secondary">Trip revenue against fuel, tolls, driver pay, maintenance and tyres, with distance from GPS.</Typography>
        </Box>
        <Filters preset={preset} setPreset={setPreset} vehicle={vehicle} setVehicle={setVehicle} onExport={() => exportVehicles(a)} />
      </Stack>
      {q.isError && <Alert severity="error">{(q.error as Error).message}</Alert>}
      <Tabs value={tab} onChange={(_, v) => setParams({ tab: v })} variant="scrollable" allowScrollButtonsMobile>
        <Tab value="overview" label="Overview" />
        <Tab value="vehicles" label="Vehicles" />
        <Tab value="customers" label="Customers & routes" />
        <Tab value="expenses" label="Expenses" />
        <Tab value="receivables" label="Receivables & invoices" />
      </Tabs>
      {tab === 'overview' && a && k && (
        <Stack spacing={2}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 6, md: 3 }}><Kpi label="Revenue" value={inr(k.revenue)} sub={`${k.trips} trips · ${num(k.km)} km`} /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Kpi label="Operating expenses" value={inr(k.expenses)} sub={k.costPerKm !== null ? `₹${k.costPerKm}/km` : 'no GPS distance'} /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Kpi label="Net profit" value={inr(k.profit)} tone={k.profit < 0 ? 'bad' : 'good'} sub={`Margin ${pctText(k.margin)}`} /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Kpi label="Revenue / km" value={k.revenuePerKm !== null ? `₹${k.revenuePerKm}` : '—'} sub={`Utilisation ${pctText(k.utilisation)}`} /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Kpi label="Outstanding receivables" value={inr(k.outstanding)} sub={`${inr(k.overdue)} overdue · DSO ${k.dso ?? '—'} days`} tone={k.overdue > 0 ? 'bad' : undefined} /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Kpi label="Collected, 30 days" value={inr(k.collected30)} sub={`${k.openInvoices} open invoices`} /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Kpi label="Fuel economy" value={k.kmPerLitre !== null ? `${k.kmPerLitre} km/L` : '—'} sub={`${num(k.litres)} litres`} /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Kpi label="Idle loss" value={pctText(k.idleLossPct)} sub="engine on, not driving" /></Grid>
          </Grid>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 8 }}>
              <ChartCard title="Daily revenue, expenses and profit">
                <ResponsiveContainer>
                  <ComposedChart data={a.daily.map((d) => ({ ...d, label: dayjs(d.date).format('D MMM') }))}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" fontSize={11} minTickGap={16} />
                    <YAxis fontSize={11} tickFormatter={short} />
                    <Tooltip formatter={(v) => inr(Number(v))} />
                    <Legend />
                    <Bar dataKey="revenue" name="Revenue" fill={COLORS[0]} />
                    <Bar dataKey="expenses" name="Expenses" fill={COLORS[1]} />
                    <Line dataKey="profit" name="Profit" stroke={COLORS[2]} dot={false} strokeWidth={2} />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartCard>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Typography variant="h6">Key insights</Typography>
                  <List dense>
                    {a.insights.length === 0 && <Typography color="text.secondary">Not enough activity in this period.</Typography>}
                    {a.insights.map((t) => (
                      <ListItem key={t} disableGutters>
                        <ListItemIcon sx={{ minWidth: 32 }}><LightbulbOutlined color="warning" fontSize="small" /></ListItemIcon>
                        <ListItemText primary={t} />
                      </ListItem>
                    ))}
                  </List>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 4 }}>
              <ChartCard title="Expense mix">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={a.expenseMix} dataKey="amount" nameKey="category" innerRadius={45} outerRadius={85}>
                      {a.expenseMix.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => inr(Number(v))} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <ChartCard title="Profit waterfall" subtitle="Revenue less each cost">
                <ResponsiveContainer>
                  <BarChart data={waterfall(a)}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" fontSize={10} interval={0} angle={-20} textAnchor="end" height={50} />
                    <YAxis fontSize={11} tickFormatter={short} />
                    <Tooltip formatter={(v, n) => (n === 'base' ? null : inr(Number(v)))} />
                    <Bar dataKey="base" stackId="w" fill="transparent" />
                    <Bar dataKey="value" stackId="w">
                      {waterfall(a).map((w, i) => <Cell key={i} fill={w.kind === 'revenue' ? COLORS[0] : w.kind === 'profit' ? (w.value >= 0 ? COLORS[2] : COLORS[4]) : COLORS[1]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <ChartCard title="Revenue by weekday">
                <ResponsiveContainer>
                  <BarChart data={a.weekday}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="day" fontSize={11} />
                    <YAxis fontSize={11} tickFormatter={short} />
                    <Tooltip formatter={(v) => inr(Number(v))} />
                    <Bar dataKey="revenue" name="Revenue" fill={COLORS[0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </Grid>
          </Grid>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 5 }}>
              <Card sx={{ height: '100%' }}>
                <CardContent><Typography variant="h6">Top customers</Typography></CardContent>
                <SimpleTable head={['Customer', 'Trips', 'Revenue']} rows={a.topCustomers} cells={(c) => [c.customer, c.trips, inr(c.revenue)]} />
              </Card>
            </Grid>
            <Grid size={{ xs: 12, md: 7 }}>
              <Card sx={{ height: '100%' }}>
                <CardContent><Typography variant="h6">Lane profitability</Typography></CardContent>
                <SimpleTable head={['Lane', 'Trips', 'Revenue', '₹/km', 'Margin']} rows={a.lanes.slice(0, 10)} cells={(l) => [l.lane, l.trips, inr(l.revenue), l.revenuePerKm ?? '—', margin(l.margin)]} />
              </Card>
            </Grid>
          </Grid>
        </Stack>
      )}
      {tab === 'vehicles' && a && <VehiclesTab a={a} />}
      {tab === 'customers' && a && <CustomersTab a={a} />}
      {tab === 'expenses' && a && <ExpensesTab a={a} />}
      {tab === 'receivables' && <ReceivablesTab />}
    </Stack>
  );
}

function waterfall(a: Analytics) {
  let level = a.kpis.revenue;
  const rows: { name: string; base: number; value: number; kind: 'revenue' | 'cost' | 'profit' }[] = [{ name: 'Revenue', base: 0, value: a.kpis.revenue, kind: 'revenue' }];
  for (const c of a.expenseMix) {
    level -= c.amount;
    rows.push({ name: c.category, base: Math.max(0, level), value: c.amount, kind: 'cost' });
  }
  rows.push({ name: 'Profit', base: 0, value: a.kpis.profit, kind: 'profit' });
  return rows;
}

function VehiclesTab({ a }: { a: Analytics }) {
  const withKm = a.vehicles.filter((v) => v.revenuePerKm !== null && v.costPerKm !== null);
  return (
    <Stack spacing={2}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <ChartCard title="Net profit by vehicle" height={Math.max(220, a.vehicles.length * 22)}>
            <ResponsiveContainer>
              <BarChart data={a.vehicles} layout="vertical" margin={{ left: 40 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" fontSize={11} tickFormatter={short} />
                <YAxis type="category" dataKey="vehicleNo" fontSize={10} width={100} />
                <Tooltip formatter={(v) => inr(Number(v))} />
                <Bar dataKey="profit" name="Profit">
                  {a.vehicles.map((v) => <Cell key={v.vehicleNo} fill={v.profit < 0 ? COLORS[4] : COLORS[2]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <ChartCard title="Efficiency" subtitle="Revenue per km against cost per km; above the diagonal earns money">
            <ResponsiveContainer>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" dataKey="costPerKm" name="Cost/km" unit="₹" fontSize={11} />
                <YAxis type="number" dataKey="revenuePerKm" name="Revenue/km" unit="₹" fontSize={11} />
                <ZAxis type="number" dataKey="km" range={[40, 300]} name="Km" />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v, n) => [n === 'Km' ? num(Number(v)) : `₹${v}`, n]} labelFormatter={() => ''} />
                <Scatter data={withKm} fill={COLORS[0]} />
              </ScatterChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
      </Grid>
      <Card>
        <SimpleTable
          head={['Vehicle', 'Model', 'Trips', 'Distance', 'Revenue', 'Expenses', 'Profit', 'Margin', 'Utilisation']}
          rows={a.vehicles}
          cells={(v) => [v.vehicleNo, v.model ?? '—', v.trips, `${num(v.km)} km`, inr(v.revenue), inr(v.expenses), <Typography key="p" component="span" sx={{ color: v.profit < 0 ? 'error.main' : undefined }}>{inr(v.profit)}</Typography>, margin(v.margin), pctText(v.utilisation)]}
        />
      </Card>
    </Stack>
  );
}

function CustomersTab({ a }: { a: Analytics }) {
  return (
    <Stack spacing={2}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <ChartCard title="Revenue by customer">
            <ResponsiveContainer>
              <BarChart data={a.topCustomers} layout="vertical" margin={{ left: 60 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" fontSize={11} tickFormatter={short} />
                <YAxis type="category" dataKey="customer" fontSize={10} width={140} />
                <Tooltip formatter={(v) => inr(Number(v))} />
                <Bar dataKey="revenue" name="Revenue" fill={COLORS[0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <ChartCard title="Revenue per km by lane">
            <ResponsiveContainer>
              <BarChart data={a.lanes.filter((l) => l.revenuePerKm !== null).slice(0, 12)} layout="vertical" margin={{ left: 60 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" fontSize={11} tickFormatter={(v) => `₹${v}`} />
                <YAxis type="category" dataKey="lane" fontSize={10} width={160} />
                <Tooltip formatter={(v) => `₹${v}/km`} />
                <Bar dataKey="revenuePerKm" name="₹/km" fill={COLORS[3]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
      </Grid>
      <Card>
        <CardContent><Typography variant="h6">Lanes</Typography><Typography variant="body2" color="text.secondary">Trip cost is the vehicle's cost per km for the period times the planned distance.</Typography></CardContent>
        <SimpleTable head={['Lane', 'Trips', 'Loaded km', 'Revenue', 'Trip costs', 'Contribution', 'Margin']} rows={a.lanes} cells={(l) => [l.lane, l.trips, num(l.km), inr(l.revenue), inr(l.cost), inr(l.contribution), margin(l.margin)]} />
      </Card>
    </Stack>
  );
}

function ExpensesTab({ a }: { a: Analytics }) {
  return (
    <Stack spacing={2}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 8 }}>
          <ChartCard title="Expenses over time">
            <ResponsiveContainer>
              <BarChart data={a.daily.map((d) => ({ ...d, label: dayjs(d.date).format('D MMM') }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" fontSize={11} minTickGap={16} />
                <YAxis fontSize={11} tickFormatter={short} />
                <Tooltip formatter={(v) => inr(Number(v))} />
                <Bar dataKey="expenses" name="Expenses" fill={COLORS[1]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent><Typography variant="h6">Cost per km</Typography></CardContent>
            <SimpleTable head={['Category', 'Amount', '₹/km']} rows={a.costPerKmBreakdown} cells={(c) => [c.category, inr(c.amount), c.perKm ?? '—']} />
          </Card>
        </Grid>
      </Grid>
      <Card>
        <CardContent><Typography variant="h6">Cost by vehicle</Typography></CardContent>
        <SimpleTable
          head={['Vehicle', ...COST_LABEL.map(([, l]) => l), 'Total', '₹/km']}
          rows={a.vehicles}
          cells={(v) => [v.vehicleNo, ...COST_LABEL.map(([key]) => inr(v.costs[key])), <b key="t">{inr(v.expenses)}</b>, v.costPerKm ?? '—']}
        />
      </Card>
    </Stack>
  );
}

/* ---------------------------------------------------------- receivables */

interface Receivables {
  outstanding: number;
  overdue: number;
  ageing: { bucket: string; amount: number; count: number }[];
  byCustomer: { customerId: number; customer: string; outstanding: number; overdue: number; invoices: number }[];
}
interface Invoice { id: number; invNo: string; customerId: number; tripIds: number[]; lane: string | null; invoiceDate: string; dueDate: string; description: string | null; taxable: number; gstRate: number; interState: number; cgst: number; sgst: number; igst: number; total: number; received: number; status: string }
interface Trip { id: number; tripNo: string; customerId: number | null; origin: string; destination: string; freight: number | null; completedAt: string; vehicleNo: string }

function ReceivablesTab() {
  const n = useNames();
  const access = useAccess();
  const [dialog, ask] = useFormDialog();
  const r = useQuery({ queryKey: ['receivables'], queryFn: () => http<Receivables>('/erp/finance/receivables') });
  const unbilled = useQuery({ queryKey: ['unbilled-trips'], queryFn: () => http<Trip[]>('/erp/finance/unbilled-trips') });
  const tripOptions = async (): Promise<Option[]> => (await http<Trip[]>('/erp/finance/unbilled-trips')).map((t) => ({ value: t.id, label: `${t.tripNo} · ${n.party(t.customerId)} · ${t.origin} → ${t.destination} · ${inr(t.freight)}` }));
  const today = dayjs().format('YYYY-MM-DD');
  const config: EntityConfig<Invoice> = {
    title: 'Invoices',
    singular: 'invoice',
    subtitle: 'Freight invoices from completed trips. Due dates follow the customer’s credit days.',
    endpoint: '/erp/finance/invoices',
    queryKey: 'invoices',
    docType: 'invoice',
    defaults: { gstRate: 5, interState: 0, tripIds: [] },
    searchText: (i) => `${i.invNo} ${n.party(i.customerId)} ${i.lane ?? ''}`,
    canEditRow: (i) => i.status === 'open' && !i.received,
    columns: [
      { label: 'Invoice', render: (i) => <Box><b>{i.invNo}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{dayjs(i.invoiceDate).format('D MMM YYYY')}</Typography></Box>, csv: (i) => i.invNo },
      { label: 'Customer', render: (i) => <Box>{n.party(i.customerId)}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{i.lane ?? ''}</Typography></Box>, csv: (i) => n.party(i.customerId) },
      { label: 'Due', render: (i) => <Box>{dayjs(i.dueDate).format('D MMM YYYY')}{['open', 'partly_paid'].includes(i.status) && i.dueDate < today && <Chip size="small" color="error" label={`${dayjs().diff(i.dueDate, 'day')} days late`} sx={{ ml: 1 }} />}</Box>, csv: (i) => i.dueDate },
      { label: 'Amount', render: (i) => <Box>{inr(i.total)}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{inr(i.taxable)} + GST {i.gstRate}% {i.interState ? '(IGST)' : '(CGST+SGST)'}</Typography></Box>, csv: (i) => i.total },
      { label: 'Outstanding', render: (i) => inr(Math.round((i.total - i.received) * 100) / 100), csv: (i) => i.total - i.received },
      { label: 'Status', render: (i) => <StatusChip status={i.status} />, csv: (i) => i.status },
    ],
    fields: [
      { path: 'customerId', label: 'Customer', type: 'autocomplete', required: true, options: partyOptions('customer'), optionsKey: 'customer-options' },
      { path: 'tripIds', label: 'Completed trips', type: 'multiselect', options: tripOptions, optionsKey: 'unbilled-trip-options', helper: 'Taxable value defaults to the trips’ freight', fullWidth: true },
      { path: 'invoiceDate', label: 'Invoice date', type: 'day' },
      { path: 'taxable', label: 'Taxable value (₹)', type: 'number', helper: 'Leave blank to use trip freight' },
      { path: 'gstRate', label: 'GST %', type: 'select', options: [0, 5, 12, 18].map((r) => ({ value: r, label: `${r}%` })) },
      { path: 'interState', label: 'Customer in another state (IGST)', type: 'select', options: [{ value: 0, label: 'No: CGST + SGST' }, { value: 1, label: 'Yes: IGST' }] },
      { path: 'lane', label: 'Lane' },
      { path: 'description', label: 'Description', type: 'textarea' },
    ],
    rowActions: (i, run) =>
      access.can('invoice', 'edit') && (
        <>
          {['open', 'partly_paid'].includes(i.status) && (
            <Button
              size="small"
              onClick={async () => {
                const left = Math.round((i.total - i.received) * 100) / 100;
                const v = await ask({
                  title: `Payment for ${i.invNo} (${inr(left)} due)`,
                  initial: { amount: left, tds: 0, mode: 'neft', receivedOn: today },
                  fields: [
                    { path: 'receivedOn', label: 'Received on', type: 'day', required: true },
                    { path: 'amount', label: 'Amount received (₹)', type: 'number', required: true },
                    { path: 'tds', label: 'TDS deducted by customer (₹)', type: 'number' },
                    { path: 'mode', label: 'Mode', type: 'select', options: ['neft', 'rtgs', 'upi', 'cheque', 'cash'].map((m) => ({ value: m, label: m.toUpperCase() })) },
                    { path: 'reference', label: 'UTR / cheque no.' },
                  ],
                });
                if (v) run(() => post(`/erp/finance/invoices/${i.id}/receipts`, v));
              }}
            >
              Receive
            </Button>
          )}
          {i.status === 'open' && !i.received && (
            <Button size="small" color="inherit" onClick={async () => { const v = await ask({ title: `Cancel ${i.invNo}`, fields: [{ path: 'reason', label: 'Reason', type: 'textarea', required: true }] }); if (v) run(() => post(`/erp/finance/invoices/${i.id}/cancel`, v)); }}>Cancel</Button>
          )}
        </>
      ),
  };
  const d = r.data;
  return (
    <Stack spacing={2}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}><Kpi label="Outstanding" value={inr(d?.outstanding)} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><Kpi label="Overdue" value={inr(d?.overdue)} tone={d?.overdue ? 'bad' : undefined} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><Kpi label="Trips not yet invoiced" value={num(unbilled.data?.length)} sub={inr(unbilled.data?.reduce((s, t) => s + (t.freight ?? 0), 0))} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><Kpi label="Customers owing" value={num(d?.byCustomer.length)} /></Grid>
      </Grid>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 5 }}>
          <ChartCard title="Ageing" height={220}>
            <ResponsiveContainer>
              <BarChart data={d?.ageing ?? []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="bucket" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={short} />
                <Tooltip formatter={(v) => inr(Number(v))} />
                <Bar dataKey="amount" name="Outstanding">
                  {(d?.ageing ?? []).map((_, i) => <Cell key={i} fill={i === 0 ? COLORS[2] : i < 3 ? COLORS[1] : COLORS[4]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent><Typography variant="h6">Outstanding by customer</Typography></CardContent>
            <SimpleTable head={['Customer', 'Invoices', 'Outstanding', 'Overdue']} rows={d?.byCustomer ?? []} cells={(c) => [c.customer, c.invoices, inr(c.outstanding), <Typography key="o" component="span" sx={{ color: c.overdue ? 'error.main' : undefined }}>{inr(c.overdue)}</Typography>]} empty="Nothing outstanding." />
          </Card>
        </Grid>
      </Grid>
      <EntityPage config={config} />
      {dialog}
    </Stack>
  );
}

/* ------------------------------------------------- fleet executive BI */

export function FleetAnalyticsPage() {
  const [preset, setPreset] = useState<Preset>('30');
  const [vehicle, setVehicle] = useState('');
  const q = useAnalytics(preset, vehicle);
  const a = q.data;
  const k = a?.kpis;
  const exportAll = () => {
    if (!a) return;
    downloadCsv(`fleet-bi-${dayjs().format('YYYYMMDD')}.csv`, [
      ['Section', 'Name', 'Trips', 'Distance km', 'Revenue', 'Operating cost', 'Net margin %', 'Running h', 'Idle h', 'Utilisation %', 'Cost/km', 'Revenue/km', 'Km/L'],
      ...a.lanes.map((l) => ['Corridor', l.lane, l.trips, l.km, l.revenue, l.cost, l.margin, '', '', '', '', l.revenuePerKm, '']),
      ...a.vehicles.map((v) => ['Vehicle', v.vehicleNo, v.trips, v.km, v.revenue, v.expenses, v.margin, v.runningHours, v.idleHours, v.utilisation, v.costPerKm, v.revenuePerKm, v.kmPerLitre]),
    ]);
  };
  const best = a?.vehicles.filter((v) => v.kmPerLitre !== null).sort((x, y) => y.kmPerLitre! - x.kmPerLitre!)[0];
  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
        <Box>
          <Typography variant="h5">Fleet Executive BI</Typography>
          <Typography color="text.secondary">Utilisation, unit economics and corridor margins for the leadership review.</Typography>
        </Box>
        <Filters preset={preset} setPreset={setPreset} vehicle={vehicle} setVehicle={setVehicle} onExport={exportAll} />
      </Stack>
      {q.isError && <Alert severity="error">{(q.error as Error).message}</Alert>}
      {a && k && (
        <>
          <Grid container spacing={2}>
            <Grid size={{ xs: 6, md: 3 }}><Kpi label="Fleet utilisation" value={pctText(k.utilisation)} sub="vehicle-days with 20+ km" /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Kpi label="Revenue / km" value={k.revenuePerKm !== null ? `₹${k.revenuePerKm}` : '—'} sub={`${num(k.km)} km`} /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Kpi label="Cost / km" value={k.costPerKm !== null ? `₹${k.costPerKm}` : '—'} sub="fuel · toll · wages · PM · tyres" /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Kpi label="Net operating margin" value={pctText(k.margin)} tone={k.margin !== null && k.margin < 0 ? 'bad' : 'good'} sub={inr(k.profit)} /></Grid>
          </Grid>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}>
              <ChartCard title="Cost per km breakdown">
                <ResponsiveContainer>
                  <BarChart data={a.costPerKmBreakdown}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="category" fontSize={11} />
                    <YAxis fontSize={11} tickFormatter={(v) => `₹${v}`} />
                    <Tooltip formatter={(v) => `₹${v}/km`} />
                    <Bar dataKey="perKm" name="₹/km">
                      {a.costPerKmBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Typography variant="h6">Fuel efficiency</Typography>
                  <Grid container spacing={2} sx={{ mt: 0.5 }}>
                    <Grid size={6}><Kpi label="Fleet average" value={k.kmPerLitre !== null ? `${k.kmPerLitre} km/L` : '—'} /></Grid>
                    <Grid size={6}><Kpi label="Best vehicle" value={best ? `${best.kmPerLitre} km/L` : '—'} sub={best?.vehicleNo} /></Grid>
                    <Grid size={6}><Kpi label="Total fuel" value={`${num(k.litres)} L`} /></Grid>
                    <Grid size={6}><Kpi label="Idling loss" value={pctText(k.idleLossPct)} sub="of engine hours" /></Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
          <Card>
            <CardContent><Typography variant="h6">Corridors</Typography></CardContent>
            <SimpleTable head={['Route', 'Trips', 'Distance', 'Gross revenue', 'Operating cost', 'Net margin', '₹/km']} rows={a.lanes} cells={(l) => [l.lane, l.trips, `${num(l.km)} km`, inr(l.revenue), inr(l.cost), margin(l.margin), l.revenuePerKm ?? '—']} />
          </Card>
          <Card>
            <CardContent><Typography variant="h6">Vehicles</Typography></CardContent>
            <SimpleTable
              head={['Registration', 'Model', 'Distance', 'Running hours', 'Utilisation', 'Cost/km', 'Revenue/km', 'Km/L']}
              rows={a.vehicles}
              cells={(v) => [v.vehicleNo, v.model ?? '—', `${num(v.km)} km`, <span key="h">{v.runningHours} h <Typography component="span" variant="caption" color="text.secondary">({v.idleHours} h idle)</Typography></span>, pctText(v.utilisation), v.costPerKm !== null ? `₹${v.costPerKm}` : '—', v.revenuePerKm !== null ? `₹${v.revenuePerKm}` : '—', v.kmPerLitre ?? '—']}
            />
          </Card>
        </>
      )}
    </Stack>
  );
}
