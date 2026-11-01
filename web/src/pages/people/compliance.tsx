import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid, MenuItem, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { http } from '../../api/http';
import { traccar } from '../../api/traccar';
import { AttachmentsDialog } from '../../components/Attachments';
import { EntityPage, type EntityConfig, errorMessage, type Field, type Option } from '../../components/EntityPage';
import { useFormDialog } from '../../components/useFormDialog';
import { useAccess } from '../../lib/access';
import { num } from '../inventory/shared';
import { vehicleOptions } from '../workshop/workshop';

const post = <T,>(url: string, body?: unknown) => http<T>(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const fmt = (d: string | null | undefined) => (d ? dayjs(d).format('D MMM YYYY') : '—');
const EXPIRING_DAYS = 30;

type DocStatus = 'valid' | 'expiring' | 'expired';
export interface ComplianceDoc {
  id: number;
  subjectType: 'vehicle' | 'driver';
  subject: string;
  docType: string;
  docNo: string | null;
  authority: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  description: string | null;
  source: string;
  verifiedAt: string | null;
  supersededById: number | null;
  daysLeft?: number | null;
  status?: DocStatus;
}

interface Meta {
  vehicleDocs: Record<string, string>;
  driverDocs: Record<string, string>;
  mandatory: string[];
  expiringDays: number;
  vahanConfigured: boolean;
}

interface Summary {
  monitored: number;
  complianceIndex: number | null;
  expiring: number;
  expired: number;
  vehiclesGrounded: number;
  vehiclesCompliant: number;
  vehiclesMissingDocs: number;
  byType: { docType: string; total: number; valid: number; expiring: number; expired: number }[];
  vehicles: { vehicleNo: string; documents: number; missing: string[]; expired: string[]; expiring: string[]; grounded: boolean; compliant: boolean }[];
}

/** Same rule as the server: overdue = expired, within 30 days = expiring. */
export function daysLeft(expiry: string | null, today = dayjs()) {
  return expiry ? dayjs(expiry).startOf('day').diff(today.startOf('day'), 'day') : null;
}
export function docStatus(expiry: string | null, today = dayjs()): DocStatus {
  const left = daysLeft(expiry, today);
  if (left === null) return 'valid';
  return left < 0 ? 'expired' : left <= EXPIRING_DAYS ? 'expiring' : 'valid';
}

const STATUS: Record<DocStatus, { label: string; color: 'success' | 'warning' | 'error' }> = {
  valid: { label: 'Valid', color: 'success' },
  expiring: { label: 'Expiring soon', color: 'warning' },
  expired: { label: 'Expired', color: 'error' },
};

const useMeta = () => useQuery({ queryKey: ['compliance-meta'], queryFn: () => http<Meta>('/erp/compliance/meta'), staleTime: Infinity });
const driverOptions = async (): Promise<Option[]> => (await traccar.drivers()).map((d) => ({ value: d.name, label: d.name }));

function validity(d: Pick<ComplianceDoc, 'expiryDate'>) {
  const left = daysLeft(d.expiryDate);
  if (left === null) return 'No expiry';
  if (left < 0) return `Overdue by ${-left} day${left === -1 ? '' : 's'}`;
  if (left === 0) return 'Expires today';
  return `${left} day${left === 1 ? '' : 's'} left`;
}

function docFields(meta: Meta | undefined): Field[] {
  const opts = (m: Record<string, string> | undefined) => [...Object.entries(m ?? {}).map(([value, label]) => ({ value, label })), { value: 'other', label: 'Other' }];
  return [
    { path: 'subjectType', label: 'For', type: 'select', required: true, options: [{ value: 'vehicle', label: 'Vehicle' }, { value: 'driver', label: 'Driver' }] },
    { path: 'subject', label: 'Vehicle', type: 'autocomplete', required: true, options: vehicleOptions, optionsKey: 'vehicle-name-options', visible: (v) => v.subjectType !== 'driver' },
    { path: 'subject', label: 'Driver', type: 'autocomplete', required: true, options: driverOptions, optionsKey: 'driver-name-options', visible: (v) => v.subjectType === 'driver' },
    { path: 'docType', label: 'Document', type: 'select', required: true, options: opts(meta?.vehicleDocs), visible: (v) => v.subjectType !== 'driver' },
    { path: 'docType', label: 'Document', type: 'select', required: true, options: opts(meta?.driverDocs), visible: (v) => v.subjectType === 'driver' },
    { path: 'docNo', label: 'Document / policy no.' },
    { path: 'authority', label: 'Issuing authority / insurer' },
    { path: 'issueDate', label: 'Issue date', type: 'day' },
    { path: 'expiryDate', label: 'Valid until', type: 'day', helper: 'Leave blank if it never expires' },
    { path: 'description', label: 'Notes', type: 'textarea' },
  ];
}

const renewFields: Field[] = [
  { path: 'docNo', label: 'New document / policy no.' },
  { path: 'authority', label: 'Issuing authority / insurer' },
  { path: 'issueDate', label: 'Issue date', type: 'day' },
  { path: 'expiryDate', label: 'Valid until', type: 'day', required: true },
  { path: 'description', label: 'Notes', type: 'textarea' },
];


function Kpis({ s }: { s: Summary | undefined }) {
  const items: [string, string, string, string?][] = s
    ? [
        ['Monitored documents', num(s.monitored), 'current documents'],
        ['Compliance index', s.complianceIndex !== null ? `${s.complianceIndex}%` : '—', 'documents not expired'],
        ['Expiring in 30 days', num(s.expiring), 'renew soon', s.expiring ? 'warning.main' : undefined],
        ['Expired', num(s.expired), 'overdue documents', s.expired ? 'error.main' : undefined],
        ['Vehicles grounded', num(s.vehiclesGrounded), 'a mandatory paper expired', s.vehiclesGrounded ? 'error.main' : undefined],
        ['Fully compliant', num(s.vehiclesCompliant), `${s.vehiclesMissingDocs} vehicles missing papers`],
      ]
    : [];
  return (
    <Grid container spacing={2}>
      {items.map(([k, v, sub, color]) => (
        <Grid key={k} size={{ xs: 6, md: 2 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="body2" color="text.secondary">{k}</Typography>
              <Typography variant="h6" sx={{ color }}>{v}</Typography>
              <Typography variant="caption" color="text.secondary">{sub}</Typography>
            </CardContent>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
}

/** Mandatory papers per vehicle: valid, expiring, expired or missing. */
function VehicleMatrix({ s, meta, onAdd }: { s: Summary | undefined; meta: Meta | undefined; onAdd: (vehicleNo: string, docType: string) => void }) {
  const [filter, setFilter] = useState<'all' | 'issues' | 'grounded'>('issues');
  const types = meta?.mandatory ?? [];
  const rows = (s?.vehicles ?? []).filter((v) => filter === 'all' || (filter === 'grounded' ? v.grounded : !v.compliant || v.expiring.length));
  const cell = (v: Summary['vehicles'][number], t: string) => {
    if (v.missing.includes(t)) return <Chip size="small" variant="outlined" color="error" label="Missing" onClick={() => onAdd(v.vehicleNo, t)} />;
    if (v.expired.includes(t)) return <Chip size="small" color="error" label="Expired" />;
    if (v.expiring.includes(t)) return <Chip size="small" color="warning" label="Expiring" />;
    return <Chip size="small" color="success" variant="outlined" label="Valid" />;
  };
  return (
    <Card sx={{ overflowX: 'auto' }}>
      <CardContent>
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
          <Box>
            <Typography variant="h6">Vehicle compliance matrix</Typography>
            <Typography variant="body2" color="text.secondary">A vehicle with an expired mandatory paper is grounded. Click “Missing” to add the document.</Typography>
          </Box>
          <TextField select size="small" label="Show" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} sx={{ minWidth: 200 }}>
            <MenuItem value="issues">Vehicles with issues</MenuItem>
            <MenuItem value="grounded">Grounded only</MenuItem>
            <MenuItem value="all">All vehicles</MenuItem>
          </TextField>
        </Stack>
      </CardContent>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 700 }}>Vehicle</TableCell>
            {types.map((t) => <TableCell key={t} sx={{ fontWeight: 700 }}>{meta?.vehicleDocs[t] ?? t}</TableCell>)}
            <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 && <TableRow><TableCell colSpan={types.length + 2}><Typography color="text.secondary">Nothing to show.</Typography></TableCell></TableRow>}
          {rows.map((v) => (
            <TableRow key={v.vehicleNo} hover>
              <TableCell><b>{v.vehicleNo}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{v.documents} documents</Typography></TableCell>
              {types.map((t) => <TableCell key={t}>{cell(v, t)}</TableCell>)}
              <TableCell>{v.grounded ? <Chip size="small" color="error" label="Grounded" /> : v.compliant ? <Chip size="small" color="success" label="Compliant" /> : <Chip size="small" color="warning" label="Papers missing" />}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function HistoryDialog({ doc, meta, onClose }: { doc: ComplianceDoc; meta: Meta | undefined; onClose: () => void }) {
  const h = useQuery({ queryKey: ['compliance-history', doc.id], queryFn: () => http<ComplianceDoc[]>(`/erp/compliance/documents/${doc.id}/history`) });
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{labelOf(meta, doc.docType)} · {doc.subject}</DialogTitle>
      <DialogContent dividers>
        {h.isError && <Alert severity="error">{errorMessage(h.error)}</Alert>}
        <Table size="small">
          <TableHead><TableRow>{['Document no.', 'Authority', 'Issued', 'Valid until', 'Source', 'Status'].map((x) => <TableCell key={x} sx={{ fontWeight: 700 }}>{x}</TableCell>)}</TableRow></TableHead>
          <TableBody>
            {h.data?.map((d) => (
              <TableRow key={d.id}>
                <TableCell>{d.docNo ?? '—'}</TableCell>
                <TableCell>{d.authority ?? '—'}</TableCell>
                <TableCell>{fmt(d.issueDate)}</TableCell>
                <TableCell>{fmt(d.expiryDate)}</TableCell>
                <TableCell>{d.source === 'vahan' ? 'Vahan' : 'Manual'}</TableCell>
                <TableCell>{d.supersededById ? <Chip size="small" label="Renewed" /> : <Chip size="small" color={STATUS[d.status ?? docStatus(d.expiryDate)].color} label={STATUS[d.status ?? docStatus(d.expiryDate)].label} />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}

const labelOf = (meta: Meta | undefined, t: string) => meta?.vehicleDocs[t] ?? meta?.driverDocs[t] ?? (t === 'other' ? 'Other' : t.replace(/_/g, ' '));

export function CompliancePage() {
  const qc = useQueryClient();
  const access = useAccess();
  const meta = useMeta().data;
  const summary = useQuery({ queryKey: ['compliance-summary'], queryFn: () => http<Summary>('/erp/compliance/summary') });
  const [dialog, ask] = useFormDialog();
  const [tab, setTab] = useState<'all' | DocStatus>('all');
  const [category, setCategory] = useState('');
  const [files, setFiles] = useState<{ doc: Pick<ComplianceDoc, 'id' | 'subject' | 'docType'>; note?: string } | null>(null);
  const [history, setHistory] = useState<ComplianceDoc | null>(null);
  const [notice, setNotice] = useState<{ severity: 'success' | 'error' | 'info'; text: string } | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['compliance-docs'] });
    void qc.invalidateQueries({ queryKey: ['compliance-summary'] });
  };
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onError: (e) => setNotice({ severity: 'error', text: errorMessage(e) }),
    onSettled: refresh,
  });
  const fields = docFields(meta);

  const addDocument = async (preset: Record<string, unknown> = { subjectType: 'vehicle' }) => {
    const v = await ask({ title: 'Upload compliance document', fields, initial: preset });
    if (!v) return;
    act.mutate(async () => {
      const doc = await post<ComplianceDoc>('/erp/compliance/documents', v);
      setNotice({ severity: 'success', text: `${labelOf(meta, doc.docType)} for ${doc.subject} saved. Attach the scan below.` });
      setFiles({ doc, note: 'Attach a scan or photo of the document (PDF or image).' });
    });
  };

  const syncVahan = async () => {
    const v = await ask({ title: 'Sync from Vahan', fields: [{ path: 'vehicleNo', label: 'Vehicle', type: 'autocomplete', required: true, options: vehicleOptions, optionsKey: 'vehicle-name-options', helper: 'RC, insurance, fitness, PUC, permit and tax are pulled from Vahan / ULIP' }] });
    if (!v) return;
    act.mutate(async () => {
      const r = await post<{ vehicleNo: string; result: { docType: string; action: string }[] }>('/erp/compliance/vahan-sync', v);
      const parts = r.result.map((x) => `${labelOf(meta, x.docType)}: ${x.action}`);
      setNotice({ severity: 'success', text: `Vahan sync for ${r.vehicleNo} done. ${parts.join(', ') || 'No documents returned.'}` });
    });
  };

  const config: EntityConfig<ComplianceDoc> = {
    title: 'Statutory Compliance',
    singular: 'document',
    subtitle: 'RC, insurance, permits, fitness, PUC and driver licences, with expiry tracking.',
    endpoint: '/erp/compliance/documents',
    queryKey: 'compliance-docs',
    docType: 'compliance_doc',
    defaults: { subjectType: 'vehicle' } as Partial<ComplianceDoc>,
    omitOnSave: ['daysLeft', 'status', 'source', 'verifiedAt', 'supersededById', 'createdAt', 'updatedAt', 'createdBy'],
    searchText: (d) => `${d.subject} ${d.docNo ?? ''} ${d.authority ?? ''} ${labelOf(meta, d.docType)} ${d.description ?? ''}`,
    rowFilter: (d) => (tab === 'all' || docStatus(d.expiryDate) === tab) && (!category || d.docType === category),
    toolbar: (
      <>
        <TextField select size="small" label="Category" value={category} onChange={(e) => setCategory(e.target.value)} sx={{ minWidth: 200 }}>
          <MenuItem value="">All categories</MenuItem>
          {Object.entries({ ...(meta?.vehicleDocs ?? {}), ...(meta?.driverDocs ?? {}), other: 'Other' }).map(([k, l]) => <MenuItem key={k} value={k}>{l}</MenuItem>)}
        </TextField>
        {access.can('compliance_doc', 'create') && (
          <Tooltip title={meta && !meta.vahanConfigured ? 'Vahan / ULIP aggregator is not configured on the server' : ''}>
            <span><Button variant="outlined" onClick={syncVahan}>Sync Vahan</Button></span>
          </Tooltip>
        )}
      </>
    ),
    columns: [
      { label: 'Vehicle / driver', render: (d) => <Box><b>{d.subject}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{d.subjectType === 'driver' ? 'Driver' : 'Vehicle'}</Typography></Box>, csv: (d) => d.subject },
      { label: 'Document', render: (d) => <Box>{labelOf(meta, d.docType)}{d.source === 'vahan' && <Chip size="small" variant="outlined" label="Vahan" sx={{ ml: 1 }} />}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{d.description ?? ''}</Typography></Box>, csv: (d) => labelOf(meta, d.docType) },
      { label: 'Number & issue', render: (d) => <Box>{d.docNo ?? '—'}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Issued {fmt(d.issueDate)}</Typography></Box>, csv: (d) => d.docNo },
      { label: 'Authority', render: (d) => d.authority ?? '—', csv: (d) => d.authority },
      { label: 'Valid until', render: (d) => <Box>{fmt(d.expiryDate)}<Typography variant="caption" sx={{ display: 'block', color: STATUS[docStatus(d.expiryDate)].color === 'success' ? 'text.secondary' : `${STATUS[docStatus(d.expiryDate)].color}.main` }}>{validity(d)}</Typography></Box>, csv: (d) => d.expiryDate },
      { label: 'Status', render: (d) => <Chip size="small" color={STATUS[docStatus(d.expiryDate)].color} label={STATUS[docStatus(d.expiryDate)].label} />, csv: (d) => docStatus(d.expiryDate) },
    ],
    fields,
    rowActions: (d, run) => (
      <>
        {access.can('compliance_doc', 'edit') && d.expiryDate && (
          <Button
            size="small"
            onClick={async () => {
              const v = await ask({ title: `Renew ${labelOf(meta, d.docType)} · ${d.subject}`, fields: renewFields, initial: { authority: d.authority, issueDate: dayjs().format('YYYY-MM-DD'), expiryDate: d.expiryDate ? dayjs(d.expiryDate).add(1, 'year').format('YYYY-MM-DD') : '' } });
              if (v) run(async () => { await post(`/erp/compliance/documents/${d.id}/renew`, v); void qc.invalidateQueries({ queryKey: ['compliance-summary'] }); });
            }}
          >
            Renew
          </Button>
        )}
        <Button size="small" onClick={() => setHistory(d)}>History</Button>
        <Button size="small" onClick={() => setFiles({ doc: d })}>Files</Button>
      </>
    ),
  };

  const counts = (summary.data ? { all: summary.data.monitored, expiring: summary.data.expiring, expired: summary.data.expired, valid: summary.data.monitored - summary.data.expiring - summary.data.expired } : null) as Record<string, number> | null;

  return (
    <Stack spacing={2}>
      <Kpis s={summary.data} />
      {notice && <Alert severity={notice.severity} onClose={() => setNotice(null)}>{notice.text}</Alert>}
      {summary.isError && <Alert severity="error">{errorMessage(summary.error)}</Alert>}
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable">
          {(['all', 'expiring', 'expired', 'valid'] as const).map((t) => (
            <Tab key={t} value={t} label={`${t === 'all' ? 'All' : STATUS[t].label}${counts ? ` (${counts[t]})` : ''}`} />
          ))}
        </Tabs>
        {access.can('compliance_doc', 'create') && <Button variant="contained" onClick={() => addDocument()}>Upload document</Button>}
      </Stack>
      <EntityPage config={config} />
      <VehicleMatrix s={summary.data} meta={meta} onAdd={(vehicleNo, docType) => addDocument({ subjectType: 'vehicle', subject: vehicleNo, docType })} />
      {files && <AttachmentsDialog title={`Files · ${labelOf(meta, files.doc.docType)} · ${files.doc.subject}`} docType="compliance_doc" docId={files.doc.id} note={files.note} onClose={() => setFiles(null)} ai={{
            kind: 'compliance',
            applyLabel: 'Fill document details',
            onApply: async (f) => {
              const body = Object.fromEntries(Object.entries({ docNo: f.docNo, authority: f.authority, issueDate: f.issueDate, expiryDate: f.expiryDate }).filter(([, v]) => typeof v === 'string' && v));
              await http(`/erp/compliance/documents/${files.doc.id}`, { method: 'PUT', body: JSON.stringify(body) });
              refresh();
            },
          }} />}
      {history && <HistoryDialog doc={history} meta={meta} onClose={() => setHistory(null)} />}
      {dialog}
    </Stack>
  );
}
