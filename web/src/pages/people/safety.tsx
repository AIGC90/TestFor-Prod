import CallIcon from '@mui/icons-material/Call';
import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid, Link, List, ListItem, ListItemText, MenuItem, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { http } from '../../api/http';
import { traccar } from '../../api/traccar';
import { AttachmentsDialog } from '../../components/Attachments';
import { EntityPage, type EntityConfig, errorMessage, type Field, type Option } from '../../components/EntityPage';
import { useFormDialog } from '../../components/useFormDialog';
import { useAccess } from '../../lib/access';
import { inr, num } from '../inventory/shared';
import { vehicleOptions } from '../workshop/workshop';

const post = <T,>(url: string, body?: unknown) => http<T>(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const opts = (pairs: [string, string][]): Option[] => pairs.map(([value, label]) => ({ value, label }));
const when = (d: string | null | undefined) => (d ? dayjs(d).format('D MMM YYYY, HH:mm') : '—');
const mapsLink = (lat: number | null, lon: number | null) => (lat !== null && lon !== null ? `https://www.google.com/maps?q=${lat},${lon}` : null);
const COLOR = '#0b5cad';

export const INCIDENT_TYPES = opts([['accident', 'Accident'], ['breakdown', 'Breakdown'], ['theft', 'Theft'], ['fire', 'Fire'], ['cargo_damage', 'Cargo damage'], ['injury', 'Injury'], ['other', 'Other']]);
const RSA_STATUS = opts([['none', 'Not needed'], ['requested', 'Requested'], ['dispatched', 'Dispatched'], ['completed', 'Completed']]);
const INCIDENT_STATUS = opts([['open', 'Open'], ['investigating', 'Investigating'], ['closed', 'Closed']]);
const CLAIM_STATUS = opts([['filed', 'Filed'], ['survey', 'Survey'], ['approved', 'Approved'], ['settled', 'Settled'], ['rejected', 'Rejected']]);
const labelIn = (list: Option[], v: string | null | undefined) => list.find((o) => o.value === v)?.label ?? v ?? '—';
const vehicleField = (path = 'vehicleNo'): Field => ({ path, label: 'Vehicle', type: 'autocomplete', required: true, options: vehicleOptions, optionsKey: 'vehicle-name-options' });

function Kpis({ items }: { items: [string, string, string?, string?][] }) {
  return (
    <Grid container spacing={2}>
      {items.map(([k, v, sub, color]) => (
        <Grid key={k} size={{ xs: 6, md: 12 / Math.min(Math.max(items.length, 1), 6) }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="body2" color="text.secondary">{k}</Typography>
              <Typography variant="h6" sx={{ color }}>{v}</Typography>
              {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
            </CardContent>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
}

/* ================================================================ safety */

interface Incident {
  id: number;
  incNo: string;
  vehicleNo: string;
  driverName: string | null;
  occurredAt: string;
  type: string;
  narrative: string;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  severity: 'major' | 'minor';
  rsaProvider: string | null;
  rsaStatus: string;
  repairCost: number | null;
  sosId: number | null;
  status: string;
  closedAt: string | null;
}

interface Claim {
  id: number;
  clmNo: string;
  incidentId: number | null;
  vehicleNo: string;
  insurer: string;
  policyNo: string | null;
  insurerClaimNo: string | null;
  surveyor: string | null;
  estimatedDamage: number;
  approvedPayout: number | null;
  settledAmount: number | null;
  status: string;
  filedAt: string;
  settledAt: string | null;
  remarks: string | null;
}

interface SafetySummary {
  incidentFreeDays: number | null;
  logged: number;
  open: number;
  resolved: number;
  claimsOpen: number;
  claimed: number;
  recovered: number;
  safetyRating: number;
  byType: { type: string; count: number }[];
}

const incidentFields: Field[] = [
  { section: 'What happened', ...vehicleField() },
  { section: 'What happened', path: 'driverName', label: 'Driver' },
  { section: 'What happened', path: 'occurredAt', label: 'Date & time', type: 'datetime' },
  { section: 'What happened', path: 'type', label: 'Type', type: 'select', required: true, options: INCIDENT_TYPES },
  { section: 'What happened', path: 'severity', label: 'Severity', type: 'select', required: true, options: opts([['minor', 'Minor'], ['major', 'Major']]) },
  { section: 'What happened', path: 'status', label: 'Status', type: 'select', required: true, options: INCIDENT_STATUS },
  { section: 'What happened', path: 'narrative', label: 'Narrative', type: 'textarea', required: true },
  { section: 'Where', path: 'location', label: 'Location / highway', fullWidth: true },
  { section: 'Where', path: 'latitude', label: 'Latitude', type: 'number' },
  { section: 'Where', path: 'longitude', label: 'Longitude', type: 'number' },
  { section: 'Roadside assistance & cost', path: 'rsaProvider', label: 'RSA provider' },
  { section: 'Roadside assistance & cost', path: 'rsaStatus', label: 'RSA status', type: 'select', options: RSA_STATUS },
  { section: 'Roadside assistance & cost', path: 'repairCost', label: 'Repair cost (₹)', type: 'number' },
];

const incidentOptions = async (): Promise<Option[]> => (await http<Incident[]>('/erp/safety/incidents')).map((i) => ({ value: i.id, label: `${i.incNo} · ${i.vehicleNo} · ${dayjs(i.occurredAt).format('D MMM YYYY')}` }));

const claimFields: Field[] = [
  { path: 'incidentId', label: 'Incident', type: 'autocomplete', options: incidentOptions, optionsKey: 'incident-options', fullWidth: true },
  vehicleField(),
  { path: 'insurer', label: 'Insurer', required: true },
  { path: 'policyNo', label: 'Policy no.' },
  { path: 'insurerClaimNo', label: "Insurer's claim no." },
  { path: 'surveyor', label: 'Surveyor' },
  { path: 'estimatedDamage', label: 'Estimated damage (₹)', type: 'number', required: true },
  { path: 'approvedPayout', label: 'Approved payout (₹)', type: 'number' },
  { path: 'settledAmount', label: 'Amount received (₹)', type: 'number' },
  { path: 'status', label: 'Status', type: 'select', required: true, options: CLAIM_STATUS },
  { path: 'remarks', label: 'Remarks', type: 'textarea' },
];

/**
 * PUTs the whole record with the change: the API's partial updates re-apply schema
 * defaults to omitted fields, so a bare {status} would reset other values.
 */
function putFull<T extends object>(url: string, row: T, change: Record<string, unknown>) {
  return http(url, { method: 'PUT', body: JSON.stringify({ ...row, ...change }) });
}

const severityChip = (s: string) => <Chip size="small" label={s.toUpperCase()} color={s === 'major' || s === 'critical' ? 'error' : s === 'high' ? 'warning' : 'default'} />;
const statusChip = (s: string) => <Chip size="small" label={s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())} color={({ open: 'warning', investigating: 'info', closed: 'success', filed: 'default', survey: 'info', approved: 'primary', settled: 'success', rejected: 'error', active: 'error', responding: 'warning', resolved: 'success' } as const)[s as 'open'] ?? 'default'} />;

function IncidentsTab({ onFiles, onClaim }: { onFiles: (i: Incident) => void; onClaim: (i: Incident) => void }) {
  const qc = useQueryClient();
  const access = useAccess();
  const [status, setStatus] = useState('');
  const config: EntityConfig<Incident> = {
    title: 'Incident Register',
    singular: 'incident',
    subtitle: 'Accidents, breakdowns, theft and cargo damage, with roadside assistance and claims.',
    endpoint: '/erp/safety/incidents',
    queryKey: 'incidents',
    docType: 'incident',
    defaults: { severity: 'minor', status: 'open', rsaStatus: 'none', type: 'accident' } as Partial<Incident>,
    beforeSave: (v) => ({ ...v, occurredAt: v.occurredAt || undefined }),
    omitOnSave: ['incNo', 'closedAt', 'createdAt', 'updatedAt', 'createdBy'],
    searchText: (i) => `${i.incNo} ${i.vehicleNo} ${i.driverName ?? ''} ${i.narrative} ${i.location ?? ''} ${i.rsaProvider ?? ''}`,
    rowFilter: (i) => !status || i.status === status,
    toolbar: (
      <TextField select size="small" label="Status" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 160 }}>
        <MenuItem value="">All</MenuItem>
        {INCIDENT_STATUS.map((o) => <MenuItem key={o.value} value={String(o.value)}>{o.label}</MenuItem>)}
      </TextField>
    ),
    columns: [
      { label: 'Incident', render: (i) => <Box><b>{i.incNo}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{when(i.occurredAt)}</Typography></Box>, csv: (i) => i.incNo },
      { label: 'Vehicle & driver', render: (i) => <Box>{i.vehicleNo}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{i.driverName ?? ''}</Typography></Box>, csv: (i) => i.vehicleNo },
      { label: 'Type & narrative', render: (i) => <Box>{labelIn(INCIDENT_TYPES, i.type)}{i.sosId && <Chip size="small" variant="outlined" color="error" label="from SOS" sx={{ ml: 1 }} />}<Typography variant="caption" color="text.secondary" sx={{ display: 'block', maxWidth: 320 }}>{i.narrative}</Typography></Box>, csv: (i) => `${i.type}: ${i.narrative}` },
      { label: 'Location', render: (i) => { const href = mapsLink(i.latitude, i.longitude); return <Box>{i.location ?? '—'}{href && <Link href={href} target="_blank" rel="noreferrer" variant="caption" sx={{ display: 'block' }}>Map</Link>}</Box>; }, csv: (i) => i.location },
      { label: 'Severity', render: (i) => severityChip(i.severity), csv: (i) => i.severity },
      { label: 'Roadside support', render: (i) => <Box>{i.rsaProvider ?? '—'}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{labelIn(RSA_STATUS, i.rsaStatus)}</Typography></Box>, csv: (i) => `${i.rsaProvider ?? ''} ${i.rsaStatus}` },
      { label: 'Status', render: (i) => statusChip(i.status), csv: (i) => i.status },
    ],
    fields: incidentFields,
    rowActions: (i, run) => (
      <>
        {access.can('incident', 'edit') && i.status !== 'closed' && (
          <Button size="small" onClick={() => run(async () => { await putFull(`/erp/safety/incidents/${i.id}`, i, { status: 'closed' }); void qc.invalidateQueries({ queryKey: ['safety-summary'] }); })}>Close</Button>
        )}
        {access.can('incident', 'create') && <Button size="small" onClick={() => onClaim(i)}>File claim</Button>}
        <Button size="small" onClick={() => onFiles(i)}>Files</Button>
      </>
    ),
  };
  return <EntityPage config={config} />;
}

function ClaimsTab({ onFiles }: { onFiles: (c: Claim) => void }) {
  const qc = useQueryClient();
  const access = useAccess();
  const [dialog, ask] = useFormDialog();
  const [status, setStatus] = useState('');
  const put = (c: Claim, v: Record<string, unknown>) => putFull(`/erp/safety/claims/${c.id}`, c, v).then(() => qc.invalidateQueries({ queryKey: ['safety-summary'] }));
  const config: EntityConfig<Claim> = {
    title: 'Insurance Claims',
    singular: 'claim',
    subtitle: 'Filed → survey → approved → settled. Settled amounts count as insurance recovery.',
    endpoint: '/erp/safety/claims',
    queryKey: 'insurance-claims',
    docType: 'incident',
    defaults: { status: 'filed', estimatedDamage: 0 } as Partial<Claim>,
    omitOnSave: ['clmNo', 'filedAt', 'settledAt', 'createdAt', 'updatedAt', 'createdBy'],
    searchText: (c) => `${c.clmNo} ${c.vehicleNo} ${c.insurer} ${c.policyNo ?? ''} ${c.insurerClaimNo ?? ''} ${c.surveyor ?? ''}`,
    rowFilter: (c) => !status || c.status === status,
    toolbar: (
      <TextField select size="small" label="Status" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 160 }}>
        <MenuItem value="">All</MenuItem>
        {CLAIM_STATUS.map((o) => <MenuItem key={o.value} value={String(o.value)}>{o.label}</MenuItem>)}
      </TextField>
    ),
    canEditRow: (c) => !['settled', 'rejected'].includes(c.status),
    columns: [
      { label: 'Claim', render: (c) => <Box><b>{c.clmNo}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Filed {dayjs(c.filedAt).format('D MMM YYYY')}</Typography></Box>, csv: (c) => c.clmNo },
      { label: 'Vehicle', render: (c) => c.vehicleNo, csv: (c) => c.vehicleNo },
      { label: 'Insurer', render: (c) => <Box>{c.insurer}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{[c.policyNo, c.insurerClaimNo].filter(Boolean).join(' · ')}</Typography></Box>, csv: (c) => c.insurer },
      { label: 'Surveyor', render: (c) => c.surveyor ?? '—', csv: (c) => c.surveyor },
      { label: 'Estimated damage', render: (c) => inr(c.estimatedDamage), csv: (c) => c.estimatedDamage },
      { label: 'Approved / received', render: (c) => <Box>{inr(c.approvedPayout)}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>received {inr(c.settledAmount)}</Typography></Box>, csv: (c) => c.settledAmount },
      { label: 'Status', render: (c) => statusChip(c.status), csv: (c) => c.status },
    ],
    fields: claimFields,
    rowActions: (c, run) =>
      access.can('incident', 'edit') && (
        <>
          {c.status === 'filed' && (
            <Button size="small" onClick={async () => { const v = await ask({ title: `Survey for ${c.clmNo}`, initial: { surveyor: c.surveyor }, fields: [{ path: 'surveyor', label: 'Surveyor', required: true }] }); if (v) run(() => put(c, { ...v, status: 'survey' })); }}>Survey</Button>
          )}
          {['filed', 'survey'].includes(c.status) && (
            <Button size="small" onClick={async () => { const v = await ask({ title: `Insurer approved ${c.clmNo}`, initial: { approvedPayout: c.estimatedDamage }, fields: [{ path: 'approvedPayout', label: 'Approved payout (₹)', type: 'number', required: true }, { path: 'insurerClaimNo', label: "Insurer's claim no." }] }); if (v) run(() => put(c, { ...v, status: 'approved' })); }}>Approved</Button>
          )}
          {c.status === 'approved' && (
            <Button size="small" variant="contained" onClick={async () => { const v = await ask({ title: `Settle ${c.clmNo}`, initial: { settledAmount: c.approvedPayout }, fields: [{ path: 'settledAmount', label: 'Amount received (₹)', type: 'number', required: true }, { path: 'remarks', label: 'Remarks', type: 'textarea' }] }); if (v) run(() => put(c, { ...v, status: 'settled' })); }}>Settle</Button>
          )}
          {!['settled', 'rejected'].includes(c.status) && (
            <Button size="small" color="inherit" onClick={async () => { const v = await ask({ title: `Reject ${c.clmNo}`, fields: [{ path: 'remarks', label: 'Reason', type: 'textarea', required: true }] }); if (v) run(() => put(c, { ...v, status: 'rejected' })); }}>Rejected</Button>
          )}
          {c.incidentId && <Button size="small" onClick={() => onFiles(c)}>Files</Button>}
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

const VIOLATIONS: Record<string, string> = {
  deviceOverspeed: 'Overspeed',
  hardBraking: 'Harsh braking',
  hardAcceleration: 'Harsh acceleration',
  hardCornering: 'Harsh cornering',
  fatigueDriving: 'Fatigue (DMS)',
  laneChange: 'Unsafe lane change (ADAS)',
};

interface Violation { id: number; at: string; vehicleNo: string; kind: string; detail: string }

function ViolationsTab() {
  const [days, setDays] = useState(30);
  const q = useQuery({
    queryKey: ['safety-violations', days],
    queryFn: async () => {
      const devices = await traccar.devices();
      if (!devices.length) return [] as Violation[];
      const to = dayjs();
      const events = await traccar.events(devices.map((d) => d.id), to.subtract(days, 'day').toISOString(), to.toISOString(), ['deviceOverspeed', 'alarm']);
      const name = new Map(devices.map((d) => [d.id, d.name]));
      return events
        .map((e): Violation | null => {
          const kind = e.type === 'deviceOverspeed' ? 'deviceOverspeed' : String(e.attributes.alarm ?? '');
          if (!VIOLATIONS[kind]) return null;
          const speed = Number(e.attributes.speed);
          const limit = Number(e.attributes.speedLimit);
          const detail = kind === 'deviceOverspeed' && speed ? `${Math.round(speed * 1.852)} km/h${limit ? ` in a ${Math.round(limit * 1.852)} km/h limit` : ''}` : '';
          return { id: e.id, at: e.eventTime, vehicleNo: name.get(e.deviceId) ?? `#${e.deviceId}`, kind, detail };
        })
        .filter((v): v is Violation => v !== null)
        .sort((a, b) => b.at.localeCompare(a.at));
    },
  });
  const rows = q.data ?? [];
  const byKind = Object.entries(VIOLATIONS).map(([k, label]) => ({ label, count: rows.filter((r) => r.kind === k).length }));
  const byVehicle = [...rows.reduce((m, r) => m.set(r.vehicleNo, (m.get(r.vehicleNo) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, 8);
  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography color="text.secondary">Telematics, ADAS and DMS violations from tracker events.</Typography>
        <ToggleButtonGroup size="small" exclusive value={days} onChange={(_, v) => v && setDays(v)}>
          {[7, 30].map((d) => <ToggleButton key={d} value={d}>{d} days</ToggleButton>)}
        </ToggleButtonGroup>
      </Stack>
      {q.isError && <Alert severity="error">{errorMessage(q.error)}</Alert>}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6">By type</Typography>
              <Box sx={{ height: 220 }}>
                <ResponsiveContainer>
                  <BarChart data={byKind}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" fontSize={11} />
                    <YAxis allowDecimals={false} fontSize={12} />
                    <Tooltip />
                    <Bar dataKey="count" name="Violations" fill={COLOR} />
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6">Most violations</Typography>
              <List dense>
                {byVehicle.length === 0 && <Typography color="text.secondary">{q.isLoading ? 'Loading…' : 'No violations in this period.'}</Typography>}
                {byVehicle.map(([v, n]) => <ListItem key={v} disableGutters divider><ListItemText primary={v} /><b>{n}</b></ListItem>)}
              </List>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      <Card sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead><TableRow>{['When', 'Vehicle', 'Violation', 'Details'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
          <TableBody>
            {rows.slice(0, 300).map((r) => (
              <TableRow key={r.id} hover>
                <TableCell>{when(r.at)}</TableCell>
                <TableCell>{r.vehicleNo}</TableCell>
                <TableCell>{VIOLATIONS[r.kind]}</TableCell>
                <TableCell>{r.detail}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length > 300 && <Typography variant="caption" color="text.secondary" sx={{ p: 2, display: 'block' }}>Showing the latest 300 of {rows.length}.</Typography>}
      </Card>
    </Stack>
  );
}

export function SafetyPage() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const access = useAccess();
  const tab = Number(params.get('tab') ?? 0);
  const setTab = (t: number, extra: Record<string, string> = {}) => setParams({ tab: String(t), ...extra });
  const s = useQuery({ queryKey: ['safety-summary'], queryFn: () => http<SafetySummary>('/erp/safety/summary') }).data;
  const [files, setFiles] = useState<{ docId: number; title: string } | null>(null);
  const [dialog, ask] = useFormDialog();
  const [notice, setNotice] = useState<string | null>(null);
  const fileClaim = useMutation({
    mutationFn: (v: Record<string, unknown>) => post<Claim>('/erp/safety/claims', v),
    onSuccess: (c) => {
      setNotice(`Claim ${c.clmNo} filed.`);
      void qc.invalidateQueries({ queryKey: ['insurance-claims'] });
      void qc.invalidateQueries({ queryKey: ['safety-summary'] });
    },
  });
  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
        <Box>
          <Typography variant="h5">Safety & Incidents</Typography>
          <Typography color="text.secondary">Incidents, roadside assistance, insurance claims and driving violations.</Typography>
        </Box>
        {access.can('incident', 'create') && <Button variant="contained" color="error" onClick={() => setTab(0, { new: '1' })}>Report incident / RSA</Button>}
      </Stack>
      <Kpis
        items={s ? [
          ['Incident-free days', s.incidentFreeDays === null ? 'No accidents' : num(s.incidentFreeDays), 'since the last accident or major incident'],
          ['Incidents', num(s.logged), `${s.open} open · ${s.resolved} closed`],
          ['Open claims', num(s.claimsOpen), `${inr(s.claimed)} claimed in total`],
          ['Insurance recovered', inr(s.recovered), 'settled claims'],
          ['Fleet safety rating', `${s.safetyRating} / 5`, 'from incidents in the last 12 months', s.safetyRating < 3 ? 'error.main' : s.safetyRating < 4 ? 'warning.main' : 'success.main'],
        ] : []}
      />
      {notice && <Alert severity="success" onClose={() => setNotice(null)}>{notice}</Alert>}
      {fileClaim.isError && <Alert severity="error" onClose={() => fileClaim.reset()}>{errorMessage(fileClaim.error)}</Alert>}
      <Tabs value={tab} onChange={(_, v) => setTab(v)}>
        <Tab label="Incident register" />
        <Tab label="Insurance claims" />
        <Tab label="Driver safety violations" />
      </Tabs>
      {tab === 0 && (
        <IncidentsTab
          onFiles={(i) => setFiles({ docId: i.id, title: `Files · ${i.incNo}` })}
          onClaim={async (i) => {
            const v = await ask({ title: `File insurance claim for ${i.incNo}`, initial: { incidentId: i.id, vehicleNo: i.vehicleNo, estimatedDamage: i.repairCost ?? 0, status: 'filed' }, fields: claimFields.filter((f) => !['approvedPayout', 'settledAmount', 'status'].includes(f.path)) });
            if (v) fileClaim.mutate({ ...v, status: 'filed' });
          }}
        />
      )}
      {/* claims share the incident's permissions, so their papers (survey report, bills) are kept on the incident */}
      {tab === 1 && <ClaimsTab onFiles={(c) => c.incidentId && setFiles({ docId: c.incidentId, title: `Files · ${c.clmNo} (kept on its incident)` })} />}
      {tab === 2 && <ViolationsTab />}
      {files && <AttachmentsDialog title={files.title} docType="incident" docId={files.docId} onClose={() => setFiles(null)} />}
      {dialog}
    </Stack>
  );
}

/* =================================================================== SOS */

interface Sos {
  id: number;
  sosNo: string;
  deviceId: number | null;
  vehicleNo: string;
  driverName: string | null;
  driverPhone: string | null;
  trigger: string;
  severity: 'critical' | 'high' | 'medium';
  speedKmh: number | null;
  ignition: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  status: 'active' | 'responding' | 'resolved';
  raisedAt: string;
  respondedAt: string | null;
  responder: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  falseAlarm: number;
  incidentId: number | null;
}

interface SosSummary {
  active: number;
  responding: number;
  resolvedToday: number;
  avgResponseMinutes: number | null;
  last30Days: number;
  falseAlarms: number;
  triggers: Record<string, { label: string; severity: string }>;
}

interface Contact { id: number; name: string; phone: string; kind: string; sort: number }

const contactsConfig: EntityConfig<Contact> = {
  title: 'Emergency contacts',
  singular: 'contact',
  endpoint: '/erp/safety/contacts',
  queryKey: 'emergency-contacts',
  docType: 'sos',
  defaults: { kind: 'other', sort: 10 },
  columns: [
    { label: 'Name', render: (c) => c.name },
    { label: 'Phone', render: (c) => c.phone },
    { label: 'Kind', render: (c) => c.kind.replace('_', ' ') },
    { label: 'Order', render: (c) => c.sort },
  ],
  fields: [
    { path: 'name', label: 'Name', required: true },
    { path: 'phone', label: 'Phone', required: true },
    { path: 'kind', label: 'Kind', type: 'select', options: opts([['police', 'Police / 112'], ['highway', 'Highway helpline'], ['ambulance', 'Ambulance'], ['fire', 'Fire'], ['control_room', 'Control room'], ['other', 'Other']]) },
    { path: 'sort', label: 'Order', type: 'number' },
  ],
};

function SpeedDial() {
  const qc = useQueryClient();
  const access = useAccess();
  const [editing, setEditing] = useState(false);
  const list = useQuery({ queryKey: ['emergency-contacts'], queryFn: () => http<Contact[]>('/erp/safety/contacts') });
  const defaults = useMutation({ mutationFn: () => post('/erp/safety/contacts/defaults'), onSettled: () => qc.invalidateQueries({ queryKey: ['emergency-contacts'] }) });
  return (
    <Card>
      <CardContent>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="h6">Emergency speed dial</Typography>
          {access.can('sos', 'create') && (
            <Stack direction="row" spacing={1}>
              {!list.data?.length && <Button size="small" onClick={() => defaults.mutate()} disabled={defaults.isPending}>Load defaults</Button>}
              <Button size="small" onClick={() => setEditing(true)}>Edit</Button>
            </Stack>
          )}
        </Stack>
        {defaults.isError && <Alert severity="error">{errorMessage(defaults.error)}</Alert>}
        {list.data?.length === 0 && <Typography color="text.secondary">No contacts yet. Load the defaults (112, NHAI 1033, ambulance 108) or add your control room.</Typography>}
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
          {list.data?.map((c) => (
            <Button key={c.id} variant="outlined" color={c.kind === 'police' || c.kind === 'ambulance' ? 'error' : 'primary'} startIcon={<CallIcon />} href={`tel:${c.phone.replace(/[^+0-9]/g, '')}`} sx={{ textTransform: 'none' }}>
              {c.name} · <b style={{ marginLeft: 4 }}>{c.phone}</b>
            </Button>
          ))}
        </Stack>
      </CardContent>
      {editing && (
        <Dialog open onClose={() => setEditing(false)} maxWidth="md" fullWidth>
          <DialogTitle>Emergency contacts</DialogTitle>
          <DialogContent dividers><EntityPage config={contactsConfig} /></DialogContent>
          <DialogActions><Button onClick={() => setEditing(false)}>Done</Button></DialogActions>
        </Dialog>
      )}
    </Card>
  );
}

const SOS_TABS = [['', 'All incidents'], ['active', 'Active'], ['responding', 'Responding'], ['resolved', 'Resolved']] as const;

export function SosPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const access = useAccess();
  const edit = access.can('sos', 'edit');
  const [tab, setTab] = useState<string>('');
  const [severity, setSeverity] = useState('');
  const [search, setSearch] = useState('');
  const [dialog, ask] = useFormDialog();
  const [notice, setNotice] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);
  const summary = useQuery({ queryKey: ['sos-summary'], queryFn: () => http<SosSummary>('/erp/safety/sos/summary'), refetchInterval: 15_000 });
  const list = useQuery({ queryKey: ['sos-list'], queryFn: () => http<Sos[]>('/erp/safety/sos'), refetchInterval: 15_000 });
  const triggers = summary.data?.triggers ?? {};
  const act = useMutation({
    mutationFn: (fn: () => Promise<string>) => fn(),
    onSuccess: (text) => setNotice({ severity: 'success', text }),
    onError: (e) => setNotice({ severity: 'error', text: errorMessage(e) }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['sos-list'] });
      void qc.invalidateQueries({ queryKey: ['sos-summary'] });
    },
  });
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list.data ?? []).filter(
      (s) => (!tab || s.status === tab) && (!severity || s.severity === severity) && (!q || `${s.sosNo} ${s.vehicleNo} ${s.driverName ?? ''} ${s.driverPhone ?? ''} ${s.address ?? ''}`.toLowerCase().includes(q)),
    );
  }, [list.data, tab, severity, search]);
  const count = (st: string) => (list.data ?? []).filter((s) => !st || s.status === st).length;
  const sm = summary.data;

  const raise = async () => {
    const v = await ask({
      title: 'Raise SOS',
      initial: { trigger: 'manual' },
      fields: [
        vehicleField(),
        { path: 'trigger', label: 'Trigger', type: 'select', required: true, options: Object.entries(triggers).map(([value, t]) => ({ value, label: t.label })) },
        { path: 'driverName', label: 'Driver (if not the assigned one)' },
        { path: 'driverPhone', label: 'Driver phone' },
        { path: 'address', label: 'Location / highway', fullWidth: true },
      ],
    });
    if (v) act.mutate(async () => `${(await post<Sos>('/erp/safety/sos', v)).sosNo} raised.`);
  };
  const respond = async (s: Sos) => {
    const v = await ask({ title: `Respond to ${s.sosNo}`, fields: [{ path: 'responder', label: 'Responder (name / team)', helper: 'Leave blank to use your name' }] });
    if (v) act.mutate(async () => { await post(`/erp/safety/sos/${s.id}/respond`, v); return `Responding to ${s.sosNo}.`; });
  };
  const resolve = async (s: Sos) => {
    const v = await ask({
      title: `Resolve ${s.sosNo} · ${s.vehicleNo}`,
      initial: { falseAlarm: false, createIncident: s.severity === 'critical', incidentType: s.trigger === 'accident' || s.trigger === 'fallDown' ? 'accident' : 'other' },
      fields: [
        { path: 'resolution', label: 'What happened / action taken', type: 'textarea', required: true },
        { path: 'falseAlarm', label: 'False alarm', type: 'switch' },
        { path: 'createIncident', label: 'Add to the incident register', type: 'switch', visible: (x) => !x.falseAlarm },
        { path: 'incidentType', label: 'Incident type', type: 'select', options: INCIDENT_TYPES, visible: (x) => !x.falseAlarm && Boolean(x.createIncident) },
      ],
    });
    if (!v) return;
    const body = { ...v, createIncident: !v.falseAlarm && Boolean(v.createIncident) };
    act.mutate(async () => {
      const r = await post<Sos>(`/erp/safety/sos/${s.id}/resolve`, body);
      return `${s.sosNo} resolved${r.incidentId ? '; an incident was added to the register' : ''}.`;
    });
  };

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
        <Box>
          <Typography variant="h5">SOS Emergency</Typography>
          <Typography color="text.secondary">Panic-button, crash and tamper alarms from trackers, with response tracking. Refreshes every 15 seconds.</Typography>
        </Box>
        {access.can('sos', 'create') && <Button variant="contained" color="error" onClick={raise}>Raise SOS</Button>}
      </Stack>
      <Kpis
        items={sm ? [
          ['Active SOS', num(sm.active), 'waiting for a responder', sm.active ? 'error.main' : 'success.main'],
          ['Responding', num(sm.responding), sm.avgResponseMinutes !== null ? `avg response ${sm.avgResponseMinutes} min` : 'no responses yet', sm.responding ? 'warning.main' : undefined],
          ['Resolved today', num(sm.resolvedToday)],
          ['Last 30 days', num(sm.last30Days), `${sm.falseAlarms} false alarms`],
        ] : []}
      />
      {notice && <Alert severity={notice.severity} onClose={() => setNotice(null)}>{notice.text}</Alert>}
      {list.isError && <Alert severity="error">{errorMessage(list.error)}</Alert>}
      <SpeedDial />
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', gap: 1, alignItems: { md: 'center' } }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable">
          {SOS_TABS.map(([v, l]) => <Tab key={v} value={v} label={`${l} (${count(v)})`} />)}
        </Tabs>
        <Stack direction="row" spacing={1}>
          <TextField select size="small" label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value)} sx={{ minWidth: 140 }}>
            <MenuItem value="">All</MenuItem>
            {['critical', 'high', 'medium'].map((x) => <MenuItem key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</MenuItem>)}
          </TextField>
          <TextField size="small" placeholder="Search vehicle, driver, highway…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Stack>
      </Stack>
      <Card sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead><TableRow>{['Incident', 'Vehicle & driver', 'Trigger', 'Location', 'Severity', 'Status', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={7}><Typography color="text.secondary" sx={{ py: 2 }}>{list.isLoading ? 'Loading…' : 'No SOS incidents.'}</Typography></TableCell></TableRow>}
            {rows.map((s) => {
              const href = mapsLink(s.latitude, s.longitude);
              return (
                <TableRow key={s.id} hover sx={s.status === 'active' ? { bgcolor: 'rgba(211, 47, 47, 0.06)' } : undefined}>
                  <TableCell><b>{s.sosNo}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{when(s.raisedAt)}</Typography></TableCell>
                  <TableCell>
                    {s.vehicleNo}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {s.driverName ?? 'Driver unknown'}
                      {s.driverPhone && <> · <Link href={`tel:${s.driverPhone.replace(/[^+0-9]/g, '')}`}>{s.driverPhone}</Link></>}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {triggers[s.trigger]?.label ?? s.trigger}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {[s.speedKmh !== null ? `${num(s.speedKmh)} km/h` : null, s.ignition ? `ignition ${s.ignition}` : null].filter(Boolean).join(' · ') || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {s.address ?? (s.latitude !== null ? `${s.latitude?.toFixed(5)}, ${s.longitude?.toFixed(5)}` : '—')}
                    {href && <Link href={href} target="_blank" rel="noreferrer" variant="caption" sx={{ display: 'block' }}>Open in Google Maps</Link>}
                  </TableCell>
                  <TableCell>{severityChip(s.severity)}</TableCell>
                  <TableCell>
                    {statusChip(s.status)}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {s.status === 'responding' && s.responder ? s.responder : s.status === 'resolved' ? `${s.falseAlarm ? 'False alarm · ' : ''}${when(s.resolvedAt)}` : ''}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {edit && s.status === 'active' && <Button size="small" variant="contained" color="error" onClick={() => respond(s)}>Respond</Button>}
                    {edit && s.status !== 'resolved' && <Button size="small" onClick={() => resolve(s)}>Resolve</Button>}
                    {s.status === 'resolved' && (
                      <Button size="small" onClick={() => setNotice({ severity: 'success', text: `${s.sosNo}: ${s.resolution ?? 'no notes'}` })}>View</Button>
                    )}
                    {s.incidentId && <Button size="small" onClick={() => navigate('/safety')}>Incident</Button>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
      {dialog}
    </Stack>
  );
}
