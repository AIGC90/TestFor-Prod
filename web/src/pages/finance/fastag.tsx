import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined';
import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid, MenuItem, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { http } from '../../api/http';
import { EntityPage, type EntityConfig, errorMessage } from '../../components/EntityPage';
import { useFormDialog } from '../../components/useFormDialog';
import { useAccess } from '../../lib/access';
import { parseCsv } from '../../lib/csv';
import { inr, num, StatusChip } from '../inventory/shared';
import { vehicleOptions } from '../workshop/workshop';

dayjs.extend(customParseFormat);
const post = (url: string, body?: unknown) => http(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

interface Summary {
  totalBalance: number;
  tags: number;
  lowBalance: number;
  blacklisted: number;
  crossings30: number;
  spend30: number;
  gateway: { configured: boolean; mode: string };
  topPlazas: { plaza: string; crossings: number; amount: number }[];
  byVehicle: { vehicleNo: string; amount: number }[];
  vehicleClasses: Record<string, string>;
}
interface Account { id: number; vehicleNo: string; tagId: string; bank: string; vehicleClass: string; balance: number; lowBalance: number; status: string; balanceAt: string | null }
interface Txn { id: number; txnRef: string; npciRef: string | null; tagId: string; vehicleNo: string; kind: string; plaza: string | null; highway: string | null; lane: string | null; at: string; amount: number; balanceAfter: number | null; status: string; tripNo: string | null }
interface ImportResult { imported: number; duplicates: number; errors: { row: number; error: string }[] }

/** Bank statement columns we understand, by normalised header. */
const HEADERS: Record<string, string> = {
  'txn ref': 'txnRef', 'transaction id': 'txnRef', 'transaction ref': 'txnRef', 'txn id': 'txnRef', 'reference no': 'txnRef',
  'npci ref': 'npciRef', 'npci txn id': 'npciRef', rrn: 'npciRef',
  'tag id': 'tagId', 'tag': 'tagId', 'fastag id': 'tagId', 'tag serial': 'tagId',
  'vehicle': 'vehicleNo', 'vehicle no': 'vehicleNo', 'vehicle number': 'vehicleNo', 'vrn': 'vehicleNo',
  plaza: 'plaza', 'plaza name': 'plaza', 'toll plaza': 'plaza',
  highway: 'highway', 'lane': 'lane', 'lane id': 'lane',
  date: 'at', 'date time': 'at', 'transaction date': 'at', 'txn date': 'at', 'reader read time': 'at',
  amount: 'amount', 'debit': 'amount', 'txn amount': 'amount', 'toll amount': 'amount',
  balance: 'balanceAfter', 'closing balance': 'balanceAfter', 'balance after': 'balanceAfter', 'available balance': 'balanceAfter',
  type: 'kind', 'txn type': 'kind',
};
const DATE_FORMATS = ['DD-MM-YYYY HH:mm:ss', 'DD-MM-YYYY HH:mm', 'DD/MM/YYYY HH:mm:ss', 'DD/MM/YYYY HH:mm', 'YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DDTHH:mm:ss', 'DD-MM-YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'];

export function tollRowsFromCsv(text: string) {
  const [header = [], ...data] = parseCsv(text);
  const norm = (h: string) => h.trim().toLowerCase().replace(/[._:/()-]/g, ' ').replace(/\s+/g, ' ').trim();
  const keys = header.map((h) => HEADERS[norm(h)] ?? null);
  const rows = data
    .filter((cells) => cells.some((c) => c.trim()))
    .map((cells) => {
      const row: Record<string, unknown> = {};
      cells.forEach((cell, i) => {
        const key = keys[i];
        const v = cell.trim();
        if (!key || !v) return;
        if (key === 'amount' || key === 'balanceAfter') row[key] = Math.abs(Number(v.replace(/[₹,\s]/g, '')));
        else if (key === 'at') {
          const d = dayjs(v, DATE_FORMATS, true);
          row.at = d.isValid() ? d.toISOString() : v;
        } else if (key === 'kind') row.kind = /recharge|credit|top ?up/i.test(v) ? 'recharge' : /refund|reversal/i.test(v) ? 'refund' : 'toll';
        else row[key] = v;
      });
      return row;
    });
  return { rows, unmapped: header.filter((_, i) => !keys[i]).map((h) => h.trim()).filter(Boolean) };
}

export function FastagPage() {
  const qc = useQueryClient();
  const access = useAccess();
  const [tab, setTab] = useState(0);
  const s = useQuery({ queryKey: ['fastag-summary'], queryFn: () => http<Summary>('/erp/fastag/summary') }).data;
  const refresh = () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('fastag') });
  const sync = useMutation({ mutationFn: () => post('/erp/fastag/sync') as Promise<ImportResult>, onSettled: refresh });
  const [upload, setUpload] = useState<{ rows: Record<string, unknown>[]; unmapped: string[] } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const imp = useMutation({ mutationFn: (rows: unknown[]) => post('/erp/fastag/txns/import', { rows }) as Promise<ImportResult>, onSettled: refresh });

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
        <Box>
          <Typography variant="h5">FASTag & Tolls</Typography>
          <Typography color="text.secondary">Tag wallets and toll crossings, matched to trips. Import bank statements or connect an aggregator.</Typography>
        </Box>
        {access.can('fastag', 'create') && (
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" onClick={() => sync.mutate()} disabled={sync.isPending}>Sync from gateway</Button>
            <Button variant="contained" startIcon={<UploadFileOutlined />} onClick={() => file.current?.click()}>Import statement</Button>
            <input ref={file} hidden type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { imp.reset(); setUpload(tollRowsFromCsv(await f.text())); } e.target.value = ''; }} />
          </Stack>
        )}
      </Stack>
      {sync.isError && <Alert severity="warning" onClose={() => sync.reset()}>{errorMessage(sync.error)}</Alert>}
      {sync.isSuccess && <Alert severity="success" onClose={() => sync.reset()}>Imported {sync.data.imported} transactions ({sync.data.duplicates} already recorded).</Alert>}
      <Grid container spacing={2}>
        {[
          ['Wallet balance', inr(s?.totalBalance), `${s?.tags ?? 0} tags`],
          ['Tolls, 30 days', inr(s?.spend30), `${num(s?.crossings30)} crossings`],
          ['Low balance', num(s?.lowBalance), `${s?.blacklisted ?? 0} blacklisted`],
          ['Gateway', s?.gateway.configured ? 'Connected' : 'Not connected', s?.gateway.mode],
        ].map(([k, v, sub]) => (
          <Grid key={k} size={{ xs: 6, md: 3 }}>
            <Card sx={{ height: '100%' }}><CardContent><Typography variant="body2" color="text.secondary">{k}</Typography><Typography variant="h6" sx={{ color: k === 'Low balance' && s?.lowBalance ? 'warning.main' : undefined }}>{v}</Typography><Typography variant="caption" color="text.secondary">{sub}</Typography></CardContent></Card>
          </Grid>
        ))}
      </Grid>
      <Tabs value={tab} onChange={(_, v) => setTab(v)}>
        <Tab label="Toll transactions" />
        <Tab label="Tag accounts & balances" />
        <Tab label="Plazas" />
      </Tabs>
      {tab === 0 && <TxnTable />}
      {tab === 1 && <Accounts classes={s?.vehicleClasses ?? {}} onChange={refresh} />}
      {tab === 2 && (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 7 }}>
            <Card>
              <CardContent>
                <Typography variant="h6">Top plazas, 30 days</Typography>
                <Box sx={{ height: 320 }}>
                  <ResponsiveContainer>
                    <BarChart data={s?.topPlazas ?? []} layout="vertical" margin={{ left: 80 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" fontSize={11} tickFormatter={(v) => `₹${v}`} />
                      <YAxis type="category" dataKey="plaza" fontSize={10} width={170} />
                      <Tooltip formatter={(v) => inr(Number(v))} />
                      <Bar dataKey="amount" name="Tolls" fill="#0b5cad" />
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, md: 5 }}>
            <Card>
              <CardContent><Typography variant="h6">Tolls by vehicle, 30 days</Typography></CardContent>
              <Table size="small">
                <TableBody>
                  {s?.byVehicle.length === 0 && <TableRow><TableCell><Typography color="text.secondary">No tolls yet.</Typography></TableCell></TableRow>}
                  {s?.byVehicle.map((v) => <TableRow key={v.vehicleNo}><TableCell>{v.vehicleNo}</TableCell><TableCell align="right">{inr(v.amount)}</TableCell></TableRow>)}
                </TableBody>
              </Table>
            </Card>
          </Grid>
        </Grid>
      )}
      <Dialog open={!!upload} onClose={() => setUpload(null)} maxWidth="md" fullWidth>
        <DialogTitle>Import toll statement</DialogTitle>
        <DialogContent>
          {upload && (
            <Stack spacing={1.5}>
              <Typography>{upload.rows.length} rows read.{upload.unmapped.length > 0 && ` Ignored columns: ${upload.unmapped.join(', ')}.`}</Typography>
              <Typography variant="body2" color="text.secondary">Rows are matched to a tag by tag ID, or by vehicle number. Transactions already imported (same reference) are skipped.</Typography>
              <TableContainer sx={{ maxHeight: 260 }}>
                <Table size="small" stickyHeader>
                  <TableHead><TableRow>{['Ref', 'Tag / vehicle', 'Plaza', 'When', 'Amount', 'Balance'].map((h) => <TableCell key={h}>{h}</TableCell>)}</TableRow></TableHead>
                  <TableBody>
                    {upload.rows.slice(0, 50).map((r, i) => (
                      <TableRow key={i}>
                        <TableCell>{String(r.txnRef ?? '—')}</TableCell>
                        <TableCell>{String(r.tagId ?? r.vehicleNo ?? '—')}</TableCell>
                        <TableCell>{String(r.plaza ?? '')}</TableCell>
                        <TableCell>{dayjs(String(r.at)).isValid() ? dayjs(String(r.at)).format('D MMM YY HH:mm') : String(r.at ?? '—')}</TableCell>
                        <TableCell>{inr(r.amount as number)}</TableCell>
                        <TableCell>{inr(r.balanceAfter as number | undefined)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              {imp.isError && <Alert severity="error">{errorMessage(imp.error)}</Alert>}
              {imp.data && (
                <Alert severity={imp.data.errors.length ? 'warning' : 'success'}>
                  Imported {imp.data.imported}, skipped {imp.data.duplicates} duplicates.
                  {imp.data.errors.slice(0, 8).map((e) => <Box key={e.row}>Row {e.row}: {e.error}</Box>)}
                  {imp.data.errors.length > 8 && <Box>…and {imp.data.errors.length - 8} more</Box>}
                </Alert>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUpload(null)}>{imp.data ? 'Close' : 'Cancel'}</Button>
          {!imp.data && <Button variant="contained" disabled={imp.isPending || !upload?.rows.length} onClick={() => upload && imp.mutate(upload.rows)}>Import {upload?.rows.length ?? 0} rows</Button>}
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function TxnTable() {
  const [vehicle, setVehicle] = useState('');
  const [kind, setKind] = useState('toll');
  const vehicles = useQuery({ queryKey: ['options', 'vehicle-name-options'], queryFn: vehicleOptions });
  const q = new URLSearchParams();
  if (vehicle) q.set('vehicleNo', vehicle);
  if (kind) q.set('kind', kind);
  const txns = useQuery({ queryKey: ['fastag-txns', vehicle, kind], queryFn: () => http<Txn[]>(`/erp/fastag/txns?${q}`) });
  return (
    <Stack spacing={1.5}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField select size="small" label="Vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value)} sx={{ minWidth: 220 }}>
          <MenuItem value="">All vehicles</MenuItem>
          {vehicles.data?.map((v) => <MenuItem key={String(v.value)} value={String(v.value).toUpperCase()}>{v.label}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Type" value={kind} onChange={(e) => setKind(e.target.value)} sx={{ minWidth: 160 }}>
          <MenuItem value="">All</MenuItem>
          <MenuItem value="toll">Tolls</MenuItem>
          <MenuItem value="recharge">Recharges</MenuItem>
          <MenuItem value="refund">Refunds</MenuItem>
        </TextField>
      </Stack>
      <Card>
        <TableContainer>
          <Table size="small">
            <TableHead><TableRow>{['Txn ref', 'Vehicle & tag', 'Plaza & highway', 'Date & time', 'Amount', 'Balance after', 'Trip', 'Status'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</TableCell>)}</TableRow></TableHead>
            <TableBody>
              {txns.data?.length === 0 && <TableRow><TableCell colSpan={8}><Typography color="text.secondary" sx={{ py: 2 }}>No transactions. Import a bank statement to get started.</Typography></TableCell></TableRow>}
              {txns.data?.map((t) => (
                <TableRow key={t.id} hover>
                  <TableCell>{t.txnRef}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t.npciRef ?? ''}</Typography></TableCell>
                  <TableCell>{t.vehicleNo}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t.tagId}</Typography></TableCell>
                  <TableCell>{t.plaza ?? '—'}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{[t.highway, t.lane && `lane ${t.lane}`].filter(Boolean).join(' · ')}</Typography></TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{dayjs(t.at).format('D MMM YY HH:mm')}</TableCell>
                  <TableCell sx={{ color: t.kind === 'toll' ? undefined : 'success.main', fontWeight: 600 }}>{t.kind === 'toll' ? '−' : '+'}{inr(t.amount)}</TableCell>
                  <TableCell>{inr(t.balanceAfter)}</TableCell>
                  <TableCell>{t.tripNo ?? '—'}</TableCell>
                  <TableCell><Chip size="small" label={t.status} color={t.status === 'disputed' ? 'error' : t.kind === 'toll' ? 'default' : 'success'} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </Stack>
  );
}

function Accounts({ classes, onChange }: { classes: Record<string, string>; onChange: () => void }) {
  const access = useAccess();
  const [dialog, ask] = useFormDialog();
  const config: EntityConfig<Account> = {
    title: 'Tag accounts',
    singular: 'FASTag',
    subtitle: 'Link each vehicle’s tag. The balance follows imported statements and recharges.',
    endpoint: '/erp/fastag/accounts',
    queryKey: 'fastag-accounts',
    docType: 'fastag',
    defaults: { vehicleClass: 'VC10', lowBalance: 1000, status: 'active' },
    searchText: (a) => `${a.vehicleNo} ${a.tagId} ${a.bank}`,
    columns: [
      { label: 'Vehicle', render: (a) => <b>{a.vehicleNo}</b>, csv: (a) => a.vehicleNo },
      { label: 'FASTag ID', render: (a) => a.tagId, csv: (a) => a.tagId },
      { label: 'Issuing bank', render: (a) => a.bank, csv: (a) => a.bank },
      { label: 'Class', render: (a) => <Box>{a.vehicleClass}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{classes[a.vehicleClass] ?? ''}</Typography></Box>, csv: (a) => a.vehicleClass },
      { label: 'Balance', render: (a) => <Box><Typography sx={{ fontWeight: 600, color: a.balance < a.lowBalance ? 'warning.main' : undefined }}>{inr(a.balance)}</Typography><Typography variant="caption" color="text.secondary">{a.balanceAt ? `as of ${dayjs(a.balanceAt).format('D MMM HH:mm')}` : 'not synced'}</Typography></Box>, csv: (a) => a.balance },
      { label: 'Status', render: (a) => (a.status === 'low_balance' ? <Chip size="small" color="warning" label="Low balance" /> : a.status === 'active' ? <Chip size="small" color="success" label="Active" /> : <StatusChip status={a.status} />), csv: (a) => a.status },
    ],
    fields: [
      { path: 'vehicleNo', label: 'Vehicle', type: 'autocomplete', required: true, options: vehicleOptions, optionsKey: 'vehicle-name-options' },
      { path: 'tagId', label: 'FASTag ID / serial', required: true },
      { path: 'bank', label: 'Issuing bank', required: true },
      { path: 'vehicleClass', label: 'Vehicle class', type: 'select', options: Object.entries(classes).map(([value, label]) => ({ value, label: `${value} · ${label}` })) },
      { path: 'balance', label: 'Current balance (₹)', type: 'number', helper: 'Leave blank to take it from the first statement' },
      { path: 'lowBalance', label: 'Low-balance alert below (₹)', type: 'number' },
      { path: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Active' }, { value: 'blacklisted', label: 'Blacklisted' }, { value: 'closed', label: 'Closed' }] },
    ],
    rowActions: (a, run) =>
      access.can('fastag', 'edit') &&
      !['closed', 'blacklisted'].includes(a.status) && (
        <Button
          size="small"
          onClick={async () => {
            const v = await ask({ title: `Recharge ${a.vehicleNo} (${inr(a.balance)})`, initial: { amount: 5000 }, fields: [{ path: 'amount', label: 'Amount (₹)', type: 'number', required: true }, { path: 'reference', label: 'Bank reference' }] });
            if (v) run(async () => { await post(`/erp/fastag/accounts/${a.id}/recharge`, v); onChange(); });
          }}
        >
          Recharge
        </Button>
      ),
  };
  return (
    <>
      <EntityPage config={config} />
      {dialog}
    </>
  );
}
