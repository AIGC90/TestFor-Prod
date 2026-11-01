import { Alert, Box, Button, Card, CardContent, Chip, Grid, List, ListItem, ListItemText, Menu, MenuItem, Paper, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { http } from '../../api/http';
import { EntityPage, type EntityConfig, errorMessage, type Field, type Option } from '../../components/EntityPage';
import { useFormDialog } from '../../components/useFormDialog';
import { useAccess } from '../../lib/access';
import { inr, num, partyOptions, StatusChip, useNames } from '../inventory/shared';
import { vehicleOptions } from '../workshop/workshop';

const post = (url: string, body?: unknown) => http(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const LEGAL_NSD = 1.6;
const WATCH_NSD = 3;
const nsdColor = (nsd: number | null | undefined) => (nsd === null || nsd === undefined ? 'text.secondary' : nsd <= LEGAL_NSD ? 'error.main' : nsd <= WATCH_NSD ? 'warning.main' : nsd <= 6 ? 'info.main' : 'success.main');
const COLORS = ['#0b5cad', '#f57c00', '#2e7d32', '#6a1b9a', '#c62828', '#00838f'];
const EVENT_LABEL: Record<string, string> = {
  purchase: 'Purchased', fit: 'Fitted', remove: 'Removed', inspect: 'Inspected', rotate: 'Rotated', retread_out: 'Sent to retreader',
  retread_in: 'Back from retreader', repair: 'Repaired', scrap: 'Scrapped', sale: 'Sold',
};

export interface Tyre {
  id: number;
  serial: string;
  brand: string;
  model: string | null;
  size: string;
  tyreType: string;
  purchaseCost: number;
  purchaseDate: string | null;
  vendorId: number | null;
  status: string;
  vehicleNo: string | null;
  position: string | null;
  fittedAt: string | null;
  fittedKm: number | null;
  closedKm: number;
  originalNsd: number;
  lastNsd: number | null;
  lastNsdAt: string | null;
  targetPressure: number | null;
  lastPressure: number | null;
  retreadCount: number;
  upkeepCost: number;
  notes: string | null;
  kmRun?: number;
  costPerKm?: number | null;
}

interface TyreEvent {
  id: number;
  tyreId: number;
  type: string;
  vehicleNo: string | null;
  position: string | null;
  toVehicleNo: string | null;
  toPosition: string | null;
  odometerKm: number | null;
  nsd: number | null;
  pressure: number | null;
  cost: number | null;
  technician: string | null;
  refNo: string | null;
  remarks: string | null;
  at: string;
  serial?: string;
  brand?: string;
}

const tyreLabel = (t: Pick<Tyre, 'serial' | 'brand' | 'model' | 'size'>) => `${t.serial} · ${t.brand} ${t.model ?? ''} ${t.size}`.replace(/\s+/g, ' ');
const inStoreOptions = async (): Promise<Option[]> => (await http<Tyre[]>('/erp/tyres/register?status=in_store')).map((t) => ({ value: t.id, label: `${tyreLabel(t)} · ${t.lastNsd ?? '—'} mm` }));
const fittedOptions = async (): Promise<Option[]> => (await http<Tyre[]>('/erp/tyres/register?status=fitted')).map((t) => ({ value: t.id, label: `${t.serial} on ${t.vehicleNo} ${t.position}` }));
const vehicleField = (path = 'vehicleNo', label = 'Vehicle'): Field => ({ path, label, type: 'autocomplete', required: true, options: vehicleOptions, optionsKey: 'vehicle-name-options' });

/** Dialogs for every action on one tyre, shared by the map, register and alert pages. */
function useTyreActions(onDone: () => void) {
  const [dialog, ask] = useFormDialog();
  const qc = useQueryClient();
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tyres'] });
      qc.invalidateQueries({ queryKey: ['tyre-register'] });
      onDone();
    },
  });
  const run = async (title: string, fields: Field[], url: string, initial: Record<string, unknown> = {}) => {
    const v = await ask({ title, fields, initial });
    if (v) act.mutate(() => post(url, v));
  };
  const actions = {
    fit: (preset: { vehicleNo?: string; position?: string } = {}, tyreId?: number) =>
      run(
        preset.position ? `Fit a tyre at ${preset.position} on ${preset.vehicleNo}` : 'Fit tyre',
        [
          { path: 'tyreId', label: 'Tyre (in store)', type: 'autocomplete', required: true, options: inStoreOptions, optionsKey: 'tyre-in-store', fullWidth: true },
          vehicleField(),
          { path: 'position', label: 'Position', required: true, helper: 'e.g. FL, FR, D1LO, SPARE' },
          { path: 'odometerKm', label: 'Odometer (km)', type: 'number', helper: 'Leave blank to read the GPS odometer' },
          { path: 'technician', label: 'Technician' },
          { path: 'remarks', label: 'Remarks', type: 'textarea' },
        ],
        '/erp/tyres/fit',
        { ...preset, tyreId: tyreId ?? '' },
      ),
    inspect: (t: Tyre) =>
      run(`Inspect ${t.serial}`, [
        { path: 'nsd', label: 'Tread depth (NSD, mm)', type: 'number', required: true },
        { path: 'pressure', label: 'Pressure (psi)', type: 'number' },
        { path: 'technician', label: 'Technician' },
        { path: 'remarks', label: 'Remarks', type: 'textarea' },
      ], `/erp/tyres/${t.id}/inspect`),
    remove: (t: Tyre) =>
      run(`Remove ${t.serial} from ${t.vehicleNo} ${t.position}`, [
        { path: 'to', label: 'Send to', type: 'select', required: true, options: [{ value: 'store', label: 'Store' }, { value: 'retreader', label: 'Retreader' }, { value: 'scrap', label: 'Scrap' }] },
        { path: 'nsd', label: 'Tread depth at removal (mm)', type: 'number' },
        { path: 'odometerKm', label: 'Odometer (km)', type: 'number', helper: 'Leave blank to read the GPS odometer' },
        { path: 'technician', label: 'Technician' },
        { path: 'remarks', label: 'Reason', type: 'textarea' },
      ], `/erp/tyres/${t.id}/remove`, { to: 'store' }),
    retreadIn: (t: Tyre) =>
      run(`${t.serial} back from the retreader`, [
        { path: 'cost', label: 'Retread cost (SAR)', type: 'number', required: true },
        { path: 'nsd', label: 'New tread depth (mm)', type: 'number' },
        { path: 'refNo', label: 'Bill no.' },
        { path: 'remarks', label: 'Remarks', type: 'textarea' },
      ], `/erp/tyres/${t.id}/retread-in`),
    repair: (t: Tyre) =>
      run(`Repair ${t.serial}`, [
        { path: 'cost', label: 'Repair cost (SAR)', type: 'number', required: true },
        { path: 'refNo', label: 'Bill no.' },
        { path: 'remarks', label: 'Work done', type: 'textarea' },
      ], `/erp/tyres/${t.id}/repair`),
    scrap: (t: Tyre) => run(`Scrap ${t.serial}`, [{ path: 'remarks', label: 'Reason', type: 'textarea', required: true }], `/erp/tyres/${t.id}/scrap`),
    sell: (t: Tyre) =>
      run(`Sell ${t.serial}`, [
        { path: 'cost', label: 'Sale value (SAR)', type: 'number', required: true },
        { path: 'refNo', label: 'Invoice no.' },
        { path: 'remarks', label: 'Buyer / remarks', type: 'textarea' },
      ], `/erp/tyres/${t.id}/sell`),
  };
  const feedback = act.isError ? <Alert severity="error" onClose={() => act.reset()}>{errorMessage(act.error)}</Alert> : null;
  return { dialog, feedback, actions, busy: act.isPending };
}

function Kpis({ items }: { items: [string, string, string?][] }) {
  return (
    <Grid container spacing={2}>
      {items.map(([k, v, sub]) => (
        <Grid key={k} size={{ xs: 6, md: 12 / Math.min(items.length, 6) }}>
          <Card sx={{ height: '100%' }}><CardContent><Typography variant="body2" color="text.secondary">{k}</Typography><Typography variant="h6">{v}</Typography>{sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}</CardContent></Card>
        </Grid>
      ))}
    </Grid>
  );
}

function Header({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
      <Box>
        <Typography variant="h5">{title}</Typography>
        <Typography color="text.secondary">{subtitle}</Typography>
      </Box>
      {children}
    </Stack>
  );
}

/* ------------------------------------------------------------ overview */

interface Overview {
  inService: number;
  vehicles: number;
  inStore: number;
  atRetreader: number;
  avgNsd: number | null;
  health: { good: number; watch: number; replace: number; unknown: number };
  nsdBands: { band: string; count: number }[];
  costPerKm: number | null;
  lowPressure: number;
  spend: { month: string; newTyres: number; retreads: number; repairs: number }[];
  replacementForecast: { tyreId: number; serial: string; brand: string; model: string | null; vehicleNo: string; position: string; nsd: number; replaceBy: string; estimatedCost: number }[];
  alerts: { severity: string; tyreId: number; serial: string; vehicleNo: string | null; position: string | null; issue: string }[];
}

const SEVERITY_COLOR: Record<string, 'error' | 'warning' | 'info' | 'default'> = { critical: 'error', high: 'warning', warning: 'warning', medium: 'info', low: 'default' };

export function TyreOverviewPage() {
  const navigate = useNavigate();
  const o = useQuery({ queryKey: ['tyres', 'overview'], queryFn: () => http<Overview>('/erp/tyres/overview') }).data;
  const health = o ? [
    { name: 'Good (> 6 mm)', value: o.health.good, color: '#2e7d32' },
    { name: 'Watch (3–6 mm)', value: o.health.watch, color: '#f57c00' },
    { name: 'Replace (≤ 3 mm)', value: o.health.replace, color: '#c62828' },
    { name: 'Not measured', value: o.health.unknown, color: '#9e9e9e' },
  ].filter((h) => h.value > 0) : [];
  const forecastCost = o?.replacementForecast.reduce((s, f) => s + f.estimatedCost, 0) ?? 0;
  return (
    <Stack spacing={2}>
      <Header title="Tyre Overview" subtitle="Tread health, spend and what needs replacing, with km from the GPS odometer.">
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={() => navigate('/tyre-map')}>Tyre map</Button>
          <Button variant="contained" onClick={() => navigate('/tyre-register')}>Register</Button>
        </Stack>
      </Header>
      <Kpis
        items={o ? [
          ['Tyres in service', num(o.inService), `on ${o.vehicles} vehicles`],
          ['In store', num(o.inStore), `${o.atRetreader} at the retreader`],
          ['Average tread', o.avgNsd !== null ? `${o.avgNsd} mm` : '—', 'fitted tyres'],
          ['Need replacing', num(o.health.replace), `≤ ${WATCH_NSD} mm tread`],
          ['Low pressure', num(o.lowPressure), 'below 90% of target'],
          ['Cost per km', o.costPerKm !== null ? `SAR ${o.costPerKm}` : '—', 'fitted tyres, purchase + upkeep'],
        ] : []}
      />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6">Tread health</Typography>
              <Box sx={{ height: 220 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={health} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} label>
                      {health.map((h) => <Cell key={h.name} fill={h.color} />)}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6">Tread depth spread</Typography>
              <Box sx={{ height: 220 }}>
                <ResponsiveContainer>
                  <BarChart data={o?.nsdBands ?? []}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="band" fontSize={12} />
                    <YAxis allowDecimals={false} fontSize={12} />
                    <Tooltip />
                    <Bar dataKey="count" name="Tyres" fill={COLORS[0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6">Alerts</Typography>
              <List dense sx={{ maxHeight: 220, overflow: 'auto' }}>
                {o?.alerts.length === 0 && <Typography color="text.secondary">No tyre alerts.</Typography>}
                {o?.alerts.map((a, i) => (
                  <ListItem key={i} disableGutters divider>
                    <ListItemText primary={`${a.serial}${a.vehicleNo ? ` · ${a.vehicleNo} ${a.position}` : ''}`} secondary={a.issue} />
                    <Chip size="small" label={a.severity} color={SEVERITY_COLOR[a.severity] ?? 'default'} />
                  </ListItem>
                ))}
              </List>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      <Card>
        <CardContent>
          <Typography variant="h6">Tyre spend, last 12 months</Typography>
          <Box sx={{ height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={o?.spend.map((s) => ({ ...s, label: dayjs(`${s.month}-01`).format('MMM YY') })) ?? []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `SAR ${Number(v) / 1000}k`} />
                <Tooltip formatter={(v) => inr(Number(v))} />
                <Legend />
                <Bar dataKey="newTyres" name="New tyres" stackId="s" fill={COLORS[0]} />
                <Bar dataKey="retreads" name="Retreads" stackId="s" fill={COLORS[1]} />
                <Bar dataKey="repairs" name="Repairs" stackId="s" fill={COLORS[2]} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Typography variant="h6">Replacement forecast</Typography>
          <Typography variant="body2" color="text.secondary">Fitted tyres at 4 mm or less. Estimated budget {inr(forecastCost)} at the last purchase price.</Typography>
        </CardContent>
        <Table size="small">
          <TableHead><TableRow>{['Tyre', 'Vehicle', 'Tread', 'Replace', 'Estimated cost'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
          <TableBody>
            {o?.replacementForecast.length === 0 && <TableRow><TableCell colSpan={5}><Typography color="text.secondary">Nothing to replace in the next month.</Typography></TableCell></TableRow>}
            {o?.replacementForecast.map((f) => (
              <TableRow key={f.tyreId} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/tyre-map?vehicle=${encodeURIComponent(f.vehicleNo)}`)}>
                <TableCell>{f.serial}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{f.brand} {f.model ?? ''}</Typography></TableCell>
                <TableCell>{f.vehicleNo} · {f.position}</TableCell>
                <TableCell sx={{ color: nsdColor(f.nsd), fontWeight: 600 }}>{f.nsd} mm</TableCell>
                <TableCell><Chip size="small" label={f.replaceBy} color={f.replaceBy === 'now' ? 'error' : 'warning'} /></TableCell>
                <TableCell>{inr(f.estimatedCost)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </Stack>
  );
}

/* ----------------------------------------------------------- tyre map */

interface VehicleMap {
  vehicleNo: string;
  layout: string;
  positions: string[];
  layouts: Record<string, { label: string; positions: string[] }>;
  tyres: Tyre[];
  history: TyreEvent[];
}

const AXLE_NAMES: Record<string, string> = { F: 'Steer', F2: 'Second steer', R: 'Rear', D1: 'Drive 1', D2: 'Drive 2' };
const LEFT_ORDER = ['LO', 'L', 'LI'];
const RIGHT_ORDER = ['RI', 'R', 'RO'];

/** Splits positions into axles: FL → {axle F, side L}, D1RO → {axle D1, side RO}. */
export function axles(positions: string[]) {
  const rows = new Map<string, { left: string[]; right: string[] }>();
  for (const p of positions) {
    const m = /^(.*?)(L|R)(O|I)?$/.exec(p);
    if (!m || p === 'SPARE') continue;
    const row = rows.get(m[1]) ?? { left: [], right: [] };
    (m[2] === 'L' ? row.left : row.right).push(p);
    rows.set(m[1], row);
  }
  const rank = (p: string, order: string[]) => order.indexOf(/(L|R)(O|I)?$/.exec(p)![0]);
  return [...rows.entries()].map(([axle, r]) => ({
    axle,
    name: AXLE_NAMES[axle] ?? axle,
    left: r.left.sort((a, b) => rank(a, LEFT_ORDER) - rank(b, LEFT_ORDER)),
    right: r.right.sort((a, b) => rank(a, RIGHT_ORDER) - rank(b, RIGHT_ORDER)),
  }));
}

function TyreSlot({ position, tyre, onClick }: { position: string; tyre?: Tyre; onClick: (e: React.MouseEvent<HTMLElement>) => void }) {
  return (
    <Paper
      variant="outlined"
      role="button"
      aria-label={`Position ${position}`}
      onClick={onClick}
      sx={{
        width: 112,
        minHeight: 92,
        p: 1,
        cursor: 'pointer',
        borderWidth: 2,
        borderColor: tyre ? nsdColor(tyre.lastNsd) : 'divider',
        borderStyle: tyre ? 'solid' : 'dashed',
        bgcolor: tyre ? 'background.paper' : 'action.hover',
        '&:hover': { boxShadow: 3 },
      }}
    >
      <Typography variant="caption" sx={{ fontWeight: 700 }}>{position}</Typography>
      {tyre ? (
        <>
          <Typography variant="body2" noWrap title={tyre.serial}>{tyre.serial}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>{tyre.brand}</Typography>
          <Typography variant="body2" sx={{ color: nsdColor(tyre.lastNsd), fontWeight: 600 }}>{tyre.lastNsd ?? '—'} mm</Typography>
          <Typography variant="caption" color="text.secondary">{num(tyre.kmRun ?? 0)} km</Typography>
        </>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>Empty · fit</Typography>
      )}
    </Paper>
  );
}

export function TyreMapPage() {
  const qc = useQueryClient();
  const access = useAccess();
  const edit = access.can('tyre', 'edit');
  const [params, setParams] = useSearchParams();
  const vehicles = useQuery({ queryKey: ['options', 'vehicle-name-options'], queryFn: vehicleOptions });
  const vehicle = params.get('vehicle') ?? String(vehicles.data?.[0]?.value ?? '');
  const map = useQuery({ queryKey: ['tyres', 'vehicle', vehicle], queryFn: () => http<VehicleMap>(`/erp/tyres/vehicle/${encodeURIComponent(vehicle)}`), enabled: !!vehicle });
  const { dialog, feedback, actions } = useTyreActions(() => undefined);
  const setLayout = useMutation({
    mutationFn: (layout: string) => http(`/erp/tyres/vehicle/${encodeURIComponent(vehicle)}/layout`, { method: 'PUT', body: JSON.stringify({ layout }) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['tyres', 'vehicle', vehicle] }),
  });
  const [menu, setMenu] = useState<{ anchor: HTMLElement; tyre: Tyre } | null>(null);
  const m = map.data;
  const at = new Map(m?.tyres.map((t) => [t.position, t]));
  const slot = (p: string) => (
    <TyreSlot
      key={p}
      position={p}
      tyre={at.get(p)}
      onClick={(e) => {
        const t = at.get(p);
        if (!edit) return;
        if (t) setMenu({ anchor: e.currentTarget, tyre: t });
        else actions.fit({ vehicleNo: vehicle, position: p });
      }}
    />
  );
  const orphaned = m?.tyres.filter((t) => !m.positions.includes(t.position ?? '')) ?? [];

  return (
    <Stack spacing={2}>
      <Header title="Tyre Map & Fitment" subtitle="Click an empty position to fit a tyre, or a fitted tyre to inspect, repair or remove it." />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField select size="small" label="Vehicle" value={vehicle} onChange={(e) => setParams({ vehicle: e.target.value })} sx={{ minWidth: 240 }}>
          {(vehicles.data ?? []).map((v) => <MenuItem key={String(v.value)} value={String(v.value)}>{v.label}</MenuItem>)}
        </TextField>
        {m && (
          <TextField select size="small" label="Wheel layout" value={m.layout} disabled={!edit} onChange={(e) => setLayout.mutate(e.target.value)} sx={{ minWidth: 280 }}>
            {Object.entries(m.layouts).map(([k, l]) => <MenuItem key={k} value={k}>{l.label}</MenuItem>)}
          </TextField>
        )}
      </Stack>
      {feedback}
      {setLayout.isError && <Alert severity="error">{errorMessage(setLayout.error)}</Alert>}
      {orphaned.length > 0 && <Alert severity="warning">Fitted at positions this layout does not have: {orphaned.map((t) => `${t.serial} (${t.position})`).join(', ')}. Remove or rotate them.</Alert>}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card>
            <CardContent>
              <Typography variant="overline" color="text.secondary">Front</Typography>
              <Stack spacing={2.5} sx={{ alignItems: 'center', py: 1, overflowX: 'auto' }}>
                {m && axles(m.positions).map((a) => (
                  <Stack key={a.axle} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Stack direction="row" spacing={0.5}>{a.left.map(slot)}</Stack>
                    <Box sx={{ width: { xs: 24, sm: 80 }, textAlign: 'center' }}>
                      <Box sx={{ height: 6, bgcolor: 'text.disabled', borderRadius: 1 }} />
                      <Typography variant="caption" color="text.secondary">{a.name}</Typography>
                    </Box>
                    <Stack direction="row" spacing={0.5}>{a.right.map(slot)}</Stack>
                  </Stack>
                ))}
                {m?.positions.includes('SPARE') && <Box sx={{ pt: 1 }}>{slot('SPARE')}</Box>}
              </Stack>
              <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap' }}>
                {[['> 6 mm', 'success'], ['3–6 mm', 'info'], [`≤ ${WATCH_NSD} mm`, 'warning'], [`≤ ${LEGAL_NSD} mm (illegal)`, 'error']].map(([l, c]) => (
                  <Chip key={l} size="small" variant="outlined" label={l} color={c as 'success'} />
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6">History on this vehicle</Typography>
              <List dense sx={{ maxHeight: 520, overflow: 'auto' }}>
                {m?.history.length === 0 && <Typography color="text.secondary">No tyre activity yet.</Typography>}
                {m?.history.map((e) => (
                  <ListItem key={e.id} disableGutters divider>
                    <ListItemText
                      primary={`${EVENT_LABEL[e.type] ?? e.type} · ${e.position ?? ''}${e.toPosition ? ` → ${e.toVehicleNo !== e.vehicleNo ? `${e.toVehicleNo} ` : ''}${e.toPosition}` : ''}`}
                      secondary={[dayjs(e.at).format('D MMM YYYY HH:mm'), e.nsd !== null ? `${e.nsd} mm` : null, e.odometerKm !== null ? `${num(e.odometerKm)} km` : null, e.remarks].filter(Boolean).join(' · ')}
                    />
                  </ListItem>
                ))}
              </List>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}>
        {menu && [
          <MenuItem key="i" onClick={() => { actions.inspect(menu.tyre); setMenu(null); }}>Inspect (tread, pressure)</MenuItem>,
          <MenuItem key="p" onClick={() => { actions.repair(menu.tyre); setMenu(null); }}>Record repair</MenuItem>,
          <MenuItem key="r" onClick={() => { actions.remove(menu.tyre); setMenu(null); }}>Remove</MenuItem>,
        ]}
      </Menu>
      {dialog}
    </Stack>
  );
}

/* ------------------------------------------------------------ register */

const STATUS_FILTERS = [['', 'All'], ['fitted', 'Fitted'], ['in_store', 'In store'], ['at_retreader', 'At retreader'], ['scrapped', 'Scrapped'], ['sold', 'Sold']];

export function TyreRegisterPage() {
  const [tab, setTab] = useState(0);
  return (
    <Stack spacing={2}>
      <Tabs value={tab} onChange={(_, v) => setTab(v)}>
        <Tab label="Tyres" />
        <Tab label="History" />
      </Tabs>
      {tab === 0 ? <TyreList /> : <TyreHistory />}
    </Stack>
  );
}

function TyreList() {
  const n = useNames();
  const access = useAccess();
  const edit = access.can('tyre', 'edit');
  const [status, setStatus] = useState('');
  const km = useQuery({ queryKey: ['tyres', 'with-km'], queryFn: () => http<Tyre[]>('/erp/tyres/with-km') });
  const kmById = new Map(km.data?.map((t) => [t.id, t]));
  const { dialog, feedback, actions } = useTyreActions(() => km.refetch());
  const config: EntityConfig<Tyre> = {
    title: 'Tyre Register',
    singular: 'tyre',
    subtitle: 'Every casing by serial number, with where it is, its tread and its km.',
    endpoint: '/erp/tyres/register',
    queryKey: 'tyre-register',
    docType: 'tyre',
    defaults: { tyreType: 'radial', originalNsd: 16 },
    searchText: (t) => `${t.serial} ${t.brand} ${t.model ?? ''} ${t.size} ${t.vehicleNo ?? ''}`,
    rowFilter: (t) => !status || t.status === status,
    toolbar: (
      <ToggleButtonGroup size="small" exclusive value={status} onChange={(_, v) => v !== null && setStatus(v)}>
        {STATUS_FILTERS.map(([v, l]) => <ToggleButton key={v} value={v}>{l}</ToggleButton>)}
      </ToggleButtonGroup>
    ),
    columns: [
      { label: 'Serial', render: (t) => <Box><b>{t.serial}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t.brand} {t.model ?? ''} · {t.size}</Typography></Box>, csv: (t) => t.serial },
      { label: 'Where', render: (t) => <Box><StatusChip status={t.status} />{t.vehicleNo && <Typography variant="caption" sx={{ display: 'block' }}>{t.vehicleNo} · {t.position}</Typography>}</Box>, csv: (t) => (t.vehicleNo ? `${t.vehicleNo} ${t.position}` : t.status) },
      { label: 'Tread', render: (t) => <Typography sx={{ color: nsdColor(t.lastNsd), fontWeight: 600 }}>{t.lastNsd ?? '—'} mm</Typography>, csv: (t) => t.lastNsd },
      { label: 'Km run', render: (t) => num(kmById.get(t.id)?.kmRun ?? t.closedKm), csv: (t) => kmById.get(t.id)?.kmRun ?? t.closedKm },
      { label: 'Cost', render: (t) => <Box>{inr(t.purchaseCost + t.upkeepCost)}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t.retreadCount ? `${t.retreadCount} retreads · ` : ''}{kmById.get(t.id)?.costPerKm ? `SAR ${kmById.get(t.id)!.costPerKm}/km` : ''}</Typography></Box>, csv: (t) => t.purchaseCost + t.upkeepCost },
      { label: 'Vendor', render: (t) => n.party(t.vendorId), csv: (t) => n.party(t.vendorId) },
    ],
    fields: [
      { section: 'Tyre', path: 'serial', label: 'Serial number', required: true },
      { section: 'Tyre', path: 'brand', label: 'Brand', required: true },
      { section: 'Tyre', path: 'model', label: 'Model / pattern' },
      { section: 'Tyre', path: 'size', label: 'Size', required: true, helper: 'e.g. 295/80 R22.5' },
      { section: 'Tyre', path: 'tyreType', label: 'Type', type: 'select', options: [{ value: 'radial', label: 'Radial' }, { value: 'bias', label: 'Bias (nylon)' }] },
      { section: 'Tyre', path: 'originalNsd', label: 'New tread depth (mm)', type: 'number' },
      { section: 'Tyre', path: 'targetPressure', label: 'Target pressure (psi)', type: 'number' },
      { section: 'Purchase', path: 'purchaseCost', label: 'Purchase cost (SAR)', type: 'number' },
      { section: 'Purchase', path: 'purchaseDate', label: 'Purchase date', type: 'date' },
      { section: 'Purchase', path: 'vendorId', label: 'Vendor', type: 'autocomplete', options: partyOptions('vendor'), optionsKey: 'vendor-options' },
      { section: 'Purchase', path: 'notes', label: 'Notes', type: 'textarea' },
    ],
    rowActions: (t) =>
      edit && (
        <>
          {t.status === 'in_store' && <Button size="small" onClick={() => actions.fit({}, t.id)}>Fit</Button>}
          {['in_store', 'fitted'].includes(t.status) && <Button size="small" onClick={() => actions.inspect(t)}>Inspect</Button>}
          {t.status === 'fitted' && <Button size="small" onClick={() => actions.remove(t)}>Remove</Button>}
          {t.status === 'at_retreader' && <Button size="small" onClick={() => actions.retreadIn(t)}>Back from retreader</Button>}
          {['in_store', 'fitted'].includes(t.status) && <Button size="small" onClick={() => actions.repair(t)}>Repair</Button>}
          {['in_store', 'at_retreader'].includes(t.status) && <Button size="small" color="inherit" onClick={() => actions.scrap(t)}>Scrap</Button>}
          {['in_store', 'at_retreader'].includes(t.status) && <Button size="small" color="inherit" onClick={() => actions.sell(t)}>Sell</Button>}
        </>
      ),
  };
  return (
    <>
      {feedback}
      <EntityPage config={config} />
      {dialog}
    </>
  );
}

function TyreHistory() {
  const [type, setType] = useState('');
  const [vehicle, setVehicle] = useState('');
  const q = new URLSearchParams();
  if (type) q.set('type', type);
  if (vehicle) q.set('vehicleNo', vehicle);
  const events = useQuery({ queryKey: ['tyres', 'events', type, vehicle], queryFn: () => http<TyreEvent[]>(`/erp/tyres/events?${q}`) });
  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField select size="small" label="Event" value={type} onChange={(e) => setType(e.target.value)} sx={{ minWidth: 200 }}>
          <MenuItem value="">All events</MenuItem>
          {Object.entries(EVENT_LABEL).map(([k, l]) => <MenuItem key={k} value={k}>{l}</MenuItem>)}
        </TextField>
        <TextField size="small" label="Vehicle no." value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} />
      </Stack>
      <Card sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead><TableRow>{['When', 'Tyre', 'Event', 'Vehicle / position', 'Odometer', 'Tread', 'Cost', 'By / remarks'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
          <TableBody>
            {events.data?.length === 0 && <TableRow><TableCell colSpan={8}><Typography color="text.secondary">No events.</Typography></TableCell></TableRow>}
            {events.data?.map((e) => (
              <TableRow key={e.id} hover>
                <TableCell>{dayjs(e.at).format('D MMM YY HH:mm')}</TableCell>
                <TableCell>{e.serial}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{e.brand}</Typography></TableCell>
                <TableCell>{EVENT_LABEL[e.type] ?? e.type}</TableCell>
                <TableCell>{e.vehicleNo ? `${e.vehicleNo} ${e.position ?? ''}` : '—'}{e.toPosition && ` → ${e.toVehicleNo} ${e.toPosition}`}</TableCell>
                <TableCell>{e.odometerKm !== null ? `${num(e.odometerKm)} km` : '—'}</TableCell>
                <TableCell>{e.nsd !== null ? `${e.nsd} mm` : '—'}{e.pressure !== null && ` · ${e.pressure} psi`}</TableCell>
                <TableCell>{inr(e.cost)}</TableCell>
                <TableCell>{[e.technician, e.refNo, e.remarks].filter(Boolean).join(' · ')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </Stack>
  );
}

/* --------------------------------------------------------- interchanges */

interface Interchange {
  id: number;
  tiNo: string;
  kind: 'rotation' | 'cross';
  lines: { tyreId: number; serial: string; fromVehicleNo: string; fromPosition: string; toVehicleNo: string; toPosition: string }[];
  remarks: string | null;
  at: string;
}

export function TyreInterchangesPage() {
  const qc = useQueryClient();
  const access = useAccess();
  const [dialog, ask] = useFormDialog();
  const list = useQuery({ queryKey: ['tyres', 'interchanges'], queryFn: () => http<Interchange[]>('/erp/tyres/interchanges') });
  const create = useMutation({ mutationFn: (v: Record<string, unknown>) => post('/erp/tyres/interchanges', v), onSettled: () => qc.invalidateQueries({ queryKey: ['tyres'] }) });
  const open = async () => {
    const v = await ask({
      title: 'New interchange',
      initial: { lines: [{}] },
      fields: [
        {
          path: 'lines',
          label: 'Moves (a swap needs both tyres)',
          type: 'lines',
          newLine: {},
          lineFields: [
            { path: 'tyreId', label: 'Fitted tyre', type: 'autocomplete', required: true, options: fittedOptions, optionsKey: 'tyre-fitted', fullWidth: true },
            vehicleField('toVehicleNo', 'To vehicle'),
            { path: 'toPosition', label: 'To position', required: true },
          ],
        },
        { path: 'odometerKm', label: 'Odometer (km)', type: 'number', helper: 'Leave blank to read the GPS odometer' },
        { path: 'remarks', label: 'Remarks', type: 'textarea' },
      ],
    });
    if (v) create.mutate(v);
  };
  return (
    <Stack spacing={2}>
      <Header title="Tyre Interchanges" subtitle="Rotations on one vehicle and swaps between vehicles. Km run is carried over from the GPS odometer.">
        {access.can('tyre', 'edit') && <Button variant="contained" onClick={open}>New interchange</Button>}
      </Header>
      {create.isError && <Alert severity="error" onClose={() => create.reset()}>{errorMessage(create.error)}</Alert>}
      {create.isSuccess && <Alert severity="success" onClose={() => create.reset()}>Saved {(create.data as Interchange).tiNo}.</Alert>}
      <Card sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead><TableRow>{['Number', 'Date', 'Kind', 'Moves', 'Remarks'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
          <TableBody>
            {list.data?.length === 0 && <TableRow><TableCell colSpan={5}><Typography color="text.secondary">No interchanges yet.</Typography></TableCell></TableRow>}
            {list.data?.map((i) => (
              <TableRow key={i.id} hover>
                <TableCell><b>{i.tiNo}</b></TableCell>
                <TableCell>{dayjs(i.at).format('D MMM YYYY')}</TableCell>
                <TableCell><Chip size="small" label={i.kind === 'cross' ? 'Cross-vehicle' : 'Rotation'} color={i.kind === 'cross' ? 'secondary' : 'primary'} variant="outlined" /></TableCell>
                <TableCell>
                  {i.lines.map((l) => (
                    <Typography key={l.tyreId} variant="body2">{l.serial}: {l.fromVehicleNo} {l.fromPosition} → {l.toVehicleNo !== l.fromVehicleNo ? `${l.toVehicleNo} ` : ''}{l.toPosition}</Typography>
                  ))}
                </TableCell>
                <TableCell>{i.remarks ?? ''}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {dialog}
    </Stack>
  );
}

/* ---------------------------------------------------------- NSD alerts */

export function NsdAlertsPage() {
  const access = useAccess();
  const [threshold, setThreshold] = useState(WATCH_NSD);
  const alerts = useQuery({ queryKey: ['tyres', 'nsd-alerts', threshold], queryFn: () => http<(Tyre & { severity: string })[]>(`/erp/tyres/nsd-alerts?threshold=${threshold}`) });
  const { dialog, feedback, actions } = useTyreActions(() => alerts.refetch());
  const rows = alerts.data ?? [];
  return (
    <Stack spacing={2}>
      <Header title="NSD Wear Alerts" subtitle={`Fitted tyres at or below the tread threshold. ${LEGAL_NSD} mm is the legal minimum.`}>
        <ToggleButtonGroup size="small" exclusive value={threshold} onChange={(_, v) => v && setThreshold(v)}>
          {[2, 3, 4, 5, 6].map((t) => <ToggleButton key={t} value={t}>≤ {t} mm</ToggleButton>)}
        </ToggleButtonGroup>
      </Header>
      <Stack direction="row" spacing={1}>
        <Chip color="error" variant="outlined" label={`Critical: ${rows.filter((r) => r.severity === 'critical').length}`} />
        <Chip color="warning" variant="outlined" label={`Warning: ${rows.filter((r) => r.severity === 'warning').length}`} />
      </Stack>
      {feedback}
      <Card sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead><TableRow>{['Tyre', 'Vehicle', 'Tread', 'Last checked', 'Km run', 'Severity', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={7}><Typography color="text.secondary" sx={{ py: 2 }}>No fitted tyre is at or below {threshold} mm.</Typography></TableCell></TableRow>}
            {rows.map((t) => (
              <TableRow key={t.id} hover>
                <TableCell>{t.serial}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t.brand} {t.model ?? ''} · {t.size}</Typography></TableCell>
                <TableCell>{t.vehicleNo} · {t.position}</TableCell>
                <TableCell sx={{ color: nsdColor(t.lastNsd), fontWeight: 600 }}>{t.lastNsd} mm</TableCell>
                <TableCell>{t.lastNsdAt ? dayjs(t.lastNsdAt).format('D MMM YYYY') : '—'}</TableCell>
                <TableCell>{num(t.kmRun ?? 0)}</TableCell>
                <TableCell><Chip size="small" label={t.severity} color={t.severity === 'critical' ? 'error' : 'warning'} /></TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  {access.can('tyre', 'edit') && (
                    <>
                      <Button size="small" onClick={() => actions.inspect(t)}>Re-measure</Button>
                      <Button size="small" onClick={() => actions.remove(t)}>Remove</Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {dialog}
    </Stack>
  );
}

/* ------------------------------------------------------------ cost / km */

interface VehicleCost { vehicleNo: string; tyres: number; avgKm: number; newSpend: number; upkeep: number; total: number; costPerKm: number | null }

export function TyreCostKmPage() {
  const rows = useQuery({ queryKey: ['tyres', 'cost-by-vehicle'], queryFn: () => http<VehicleCost[]>('/erp/tyres/cost-by-vehicle') }).data ?? [];
  const total = rows.reduce((s, r) => s + r.total, 0);
  const priced = rows.filter((r) => r.costPerKm !== null);
  return (
    <Stack spacing={2}>
      <Header title="Tyre Cost / KM" subtitle="Purchase and upkeep of the tyres fitted now, divided by the average km they have run." />
      <Kpis items={[
        ['Vehicles', num(rows.length)],
        ['Tyre value fitted', inr(total)],
        ['Fleet average', priced.length ? `SAR ${(priced.reduce((s, r) => s + r.costPerKm!, 0) / priced.length).toFixed(2)}/km` : '—'],
        ['Highest', priced[0] ? `${priced[0].vehicleNo} · SAR ${priced[0].costPerKm}/km` : '—'],
      ]} />
      <Card>
        <CardContent>
          <Box sx={{ height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={priced.slice(0, 20)}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="vehicleNo" fontSize={11} />
                <YAxis fontSize={12} tickFormatter={(v) => `SAR ${v}`} />
                <Tooltip formatter={(v) => `SAR ${v}/km`} />
                <Bar dataKey="costPerKm" name="Cost per km" fill={COLORS[0]} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </CardContent>
      </Card>
      <Card sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead><TableRow>{['Vehicle', 'Tyres', 'Avg km run', 'New tyres', 'Retreads & repairs', 'Total', 'Cost / km'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={7}><Typography color="text.secondary">No fitted tyres yet.</Typography></TableCell></TableRow>}
            {rows.map((r) => (
              <TableRow key={r.vehicleNo} hover>
                <TableCell>{r.vehicleNo}</TableCell><TableCell>{r.tyres}</TableCell><TableCell>{num(r.avgKm)}</TableCell>
                <TableCell>{inr(r.newSpend)}</TableCell><TableCell>{inr(r.upkeep)}</TableCell><TableCell>{inr(r.total)}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{r.costPerKm !== null ? `SAR ${r.costPerKm}` : 'not run yet'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </Stack>
  );
}

/* ---------------------------------------------------------- performance */

interface Perf { group: string; tyres: number; closedLives: number; avgLifeKm: number; avgRemovalNsd: number | null; avgCost: number; costPerKm: number | null }

export function TyrePerformancePage() {
  const [groupBy, setGroupBy] = useState<'brand' | 'model' | 'size'>('brand');
  const rows = useQuery({ queryKey: ['tyres', 'performance', groupBy], queryFn: () => http<Perf[]>(`/erp/tyres/performance?groupBy=${groupBy}`) }).data ?? [];
  return (
    <Stack spacing={2}>
      <Header title="Tyre Performance" subtitle="Life and cost per km by brand, model or size. Life uses finished tyres where there are any.">
        <ToggleButtonGroup size="small" exclusive value={groupBy} onChange={(_, v) => v && setGroupBy(v)}>
          <ToggleButton value="brand">Brand</ToggleButton>
          <ToggleButton value="model">Model</ToggleButton>
          <ToggleButton value="size">Size</ToggleButton>
        </ToggleButtonGroup>
      </Header>
      <Card>
        <CardContent>
          <Box sx={{ height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="group" fontSize={11} />
                <YAxis yAxisId="km" fontSize={12} tickFormatter={(v) => `${Number(v) / 1000}k`} />
                <YAxis yAxisId="cost" orientation="right" fontSize={12} tickFormatter={(v) => `SAR ${v}`} />
                <Tooltip />
                <Legend />
                <Bar yAxisId="km" dataKey="avgLifeKm" name="Average life (km)" fill={COLORS[0]} />
                <Bar yAxisId="cost" dataKey="costPerKm" name="Cost per km (SAR)" fill={COLORS[1]} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </CardContent>
      </Card>
      <Card sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead><TableRow>{[groupBy === 'size' ? 'Size' : groupBy === 'model' ? 'Model' : 'Brand', 'Tyres', 'Finished lives', 'Average life', 'Tread at removal', 'Average price', 'Cost / km'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={r.group} hover>
                <TableCell>{r.group}{i === 0 && r.costPerKm !== null && <Chip size="small" color="success" label="Best value" sx={{ ml: 1 }} />}</TableCell>
                <TableCell>{r.tyres}</TableCell><TableCell>{r.closedLives}</TableCell><TableCell>{num(r.avgLifeKm)} km</TableCell>
                <TableCell>{r.avgRemovalNsd !== null ? `${r.avgRemovalNsd} mm` : '—'}</TableCell><TableCell>{inr(r.avgCost)}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{r.costPerKm !== null ? `SAR ${r.costPerKm}` : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </Stack>
  );
}
