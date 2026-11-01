import FileUploadOutlined from '@mui/icons-material/FileUploadOutlined';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  FormControlLabel,
  Grid,
  MenuItem,
  Stack,
  Switch,
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useRef, useState } from 'react';
import { http } from '../../api/http';
import { EntityForm, errorMessage, type Field, RecordForm } from '../../components/EntityPage';
import { useAccess } from '../../lib/access';
import { parseCsv } from '../../lib/csv';
import type { Item } from '../masters/ItemMasterPage';
import { inr, itemOptions, num, StatusChip, statusLabel, storeOptions, useNames } from './shared';

interface Summary {
  perStore: { storeId: number; storeName: string; kind: string; qty: number; value: number; lines: number }[];
  pieces: Record<string, number>;
  belowReorder: { itemId: number; itemName: string; reorderLevel: number; qty: number }[];
  inTransitTransfers: number;
}
interface Balance {
  itemId: number;
  storeId: number;
  qty: number;
  value: number;
  avgRate: number;
  itemCode: string;
  itemName: string;
  unit: string | null;
  reorderLevel: number | null;
  storeName: string;
}
interface Piece {
  id: number;
  itemId: number;
  serial: string;
  storeId: number | null;
  state: string;
  vehicleNo: string | null;
  itemName: string;
  storeName: string | null;
  updatedAt: string;
}
export interface MovementRow {
  id: number;
  docNo: string;
  kind: string;
  status: string;
  itemId: number;
  itemName: string;
  unit: string | null;
  storeId: number;
  toStoreId: number | null;
  qty: number;
  unitRate: number;
  value: number;
  serials: string[];
  vehicleNo: string | null;
  lrNo: string | null;
  refNo: string | null;
  remarks: string | null;
  movedAt: string;
}

export const KIND_LABEL: Record<string, string> = {
  receipt: 'Receipt', issue: 'Issue to vehicle', transfer: 'Plant transfer', adjustment: 'Count adjustment',
  write_off: 'Write-off', opening: 'Opening', sale: 'Sale', return: 'Return from vehicle',
};

/** Fields of the "new movement" form for a given kind. */
function movementFields(kind: string): Field[] {
  return [
    { path: 'storeId', label: kind === 'transfer' ? 'From store' : 'Store', type: 'select', required: true, options: storeOptions, optionsKey: 'store-options' },
    ...(kind === 'transfer' ? [{ path: 'toStoreId', label: 'To store', type: 'select', required: true, options: storeOptions, optionsKey: 'store-options' } as Field] : []),
    { path: 'itemId', label: 'Item', type: 'autocomplete', required: true, options: itemOptions, optionsKey: 'item-options', fullWidth: true },
    { path: 'qty', label: kind === 'adjustment' ? 'Quantity (+ found / − missing)' : 'Quantity', type: 'number', required: true },
    ...(['receipt', 'return', 'adjustment'].includes(kind) ? [{ path: 'unitRate', label: 'Rate per unit (SAR)', type: 'number', helper: 'Blank uses the current average cost' } as Field] : []),
    { path: 'serials', label: 'Serial numbers (tracked items only)', type: 'list', fullWidth: true },
    ...(kind === 'issue' || kind === 'return' ? [{ path: 'vehicleNo', label: 'Vehicle no.', required: kind === 'issue' } as Field] : []),
    { path: 'lrNo', label: 'LR / reference no.' },
    ...(kind === 'transfer' ? [{ path: 'status', label: 'Arrival', type: 'select', options: [{ value: 'completed', label: 'Arrives immediately' }, { value: 'in_transit', label: 'In transit (receive later)' }] } as Field] : []),
    { path: 'remarks', label: 'Remarks / reason', type: 'textarea' },
  ];
}

/** Button + dialog that records one stock movement. */
export function NewMovement({ kinds = ['receipt', 'issue', 'transfer', 'adjustment', 'write_off', 'return'], label = 'New movement', initialKind }: { kinds?: string[]; label?: string; initialKind?: string }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (v: Record<string, unknown>) => http('/erp/stock/movements', { method: 'POST', body: JSON.stringify({ ...v, kind }) }),
    onSuccess: () => {
      setKind(null);
      void qc.invalidateQueries({ queryKey: ['stock'] });
    },
  });
  return (
    <>
      {initialKind ? (
        <Button variant="contained" onClick={() => { save.reset(); setKind(initialKind); }}>{label}</Button>
      ) : (
        <TextField select size="small" label={label} value="" onChange={(e) => { save.reset(); setKind(e.target.value); }} sx={{ minWidth: 200 }}>
          {kinds.map((k) => <MenuItem key={k} value={k}>{KIND_LABEL[k]}</MenuItem>)}
        </TextField>
      )}
      {kind && (
        <EntityForm
          title={KIND_LABEL[kind]}
          fields={movementFields(kind)}
          initial={{ status: 'completed' }}
          isNew
          onCancel={() => setKind(null)}
          onSubmit={(v) => save.mutate(v)}
          busy={save.isPending}
          error={save.isError ? errorMessage(save.error) : null}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ stock */

export function StockPage() {
  const qc = useQueryClient();
  const access = useAccess();
  const [store, setStore] = useState<number | null>(null);
  const [tab, setTab] = useState<'balances' | 'pieces'>('balances');
  const [search, setSearch] = useState('');
  const summary = useQuery({ queryKey: ['stock', 'summary'], queryFn: () => http<Summary>('/erp/stock/summary') });
  const balances = useQuery({ queryKey: ['stock', 'balances', store], queryFn: () => http<Balance[]>(`/erp/stock/balances${store ? `?storeId=${store}` : ''}`) });
  const pieces = useQuery({ queryKey: ['stock', 'pieces', store], queryFn: () => http<Piece[]>(`/erp/stock/pieces${store ? `?storeId=${store}` : ''}`), enabled: tab === 'pieces' });
  const pieceState = useMutation({
    mutationFn: ({ id, state }: { id: number; state: string }) => http(`/erp/stock/pieces/${id}/state`, { method: 'POST', body: JSON.stringify({ state }) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['stock'] }),
  });

  const s = summary.data;
  const totalValue = s?.perStore.reduce((a, x) => a + x.value, 0) ?? 0;
  // reorder levels are per item, so compare against the item's total in every store
  const totalByItem = new Map<number, number>();
  (s?.belowReorder ?? []).forEach((b) => totalByItem.set(b.itemId, b.qty));
  const q = search.trim().toLowerCase();
  const rows = (balances.data ?? []).filter((b) => !q || `${b.itemName} ${b.itemCode}`.toLowerCase().includes(q));
  const pieceRows = (pieces.data ?? []).filter((p) => !q || `${p.serial} ${p.itemName} ${p.vehicleNo ?? ''}`.toLowerCase().includes(q));

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
        <Box>
          <Typography variant="h5">Stock</Typography>
          <Typography color="text.secondary">On the shelf, in transit, issued to vehicles or written off. Every change is a movement.</Typography>
        </Box>
        {access.can('stock_movement', 'create') && <NewMovement label="Record movement" />}
      </Stack>

      <Grid container spacing={2}>
        {([
          ['Stock value', inr(totalValue)],
          ['Serial pieces in stock', num(s?.pieces.in_stock ?? 0)],
          ['Damaged pieces', num(s?.pieces.damaged ?? 0)],
          ['Serial pieces on vehicles', num(s?.pieces.issued ?? 0)],
          ['Transfers in transit', num(s?.inTransitTransfers ?? 0)],
          ['Below reorder level', num(s?.belowReorder.length ?? 0)],
        ] as [string, string][]).map(([k, v]) => (
          <Grid key={k} size={{ xs: 6, md: 2 }}>
            <Card><CardContent><Typography variant="body2" color="text.secondary">{k}</Typography><Typography variant="h6">{v}</Typography></CardContent></Card>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ borderColor: store === null ? 'primary.main' : undefined }}>
            <CardActionArea onClick={() => setStore(null)}>
              <CardContent><Typography sx={{ fontWeight: 700 }}>All stores</Typography><Typography variant="body2" color="text.secondary">{inr(totalValue)}</Typography></CardContent>
            </CardActionArea>
          </Card>
        </Grid>
        {s?.perStore.map((x) => (
          <Grid key={x.storeId} size={{ xs: 12, sm: 6, md: 3 }}>
            <Card sx={{ borderColor: store === x.storeId ? 'primary.main' : undefined }}>
              <CardActionArea onClick={() => setStore(x.storeId)}>
                <CardContent>
                  <Typography sx={{ fontWeight: 700 }}>{x.storeName}</Typography>
                  <Typography variant="body2" color="text.secondary">{x.lines} item lines · {inr(x.value)}</Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>

      {s && s.belowReorder.length > 0 && (
        <Alert severity="warning">
          Below reorder level: {s.belowReorder.map((b) => `${b.itemName} (${num(b.qty)} / ${num(b.reorderLevel)})`).join(', ')}
        </Alert>
      )}
      {pieceState.isError && <Alert severity="error">{errorMessage(pieceState.error)}</Alert>}

      <Card>
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, px: 2 }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)}>
            <Tab value="balances" label="Quantities" />
            <Tab value="pieces" label="Serial pieces" />
          </Tabs>
          <TextField size="small" placeholder="Search item, code, serial…" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ my: 1 }} />
        </Stack>
        {tab === 'balances' ? (
          <Table size="small">
            <TableHead>
              <TableRow>{['Item', 'Code', 'Store', 'In stock', 'Avg rate', 'Value', 'Reorder at'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 && <TableRow><TableCell colSpan={7}><Typography color="text.secondary" sx={{ py: 2 }}>No stock here yet.</Typography></TableCell></TableRow>}
              {rows.map((b) => (
                <TableRow key={`${b.itemId}-${b.storeId}`} hover>
                  <TableCell>{b.itemName}</TableCell>
                  <TableCell>{b.itemCode}</TableCell>
                  <TableCell>{b.storeName}</TableCell>
                  <TableCell>
                    {num(b.qty)} {b.unit ?? ''}
                    {totalByItem.has(b.itemId) && <Chip size="small" color="warning" label="reorder" sx={{ ml: 1 }} />}
                  </TableCell>
                  <TableCell>{inr(b.avgRate)}</TableCell>
                  <TableCell>{inr(b.value)}</TableCell>
                  <TableCell>{num(b.reorderLevel)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>{['Serial', 'Item', 'State', 'Store', 'Vehicle', 'Updated', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow>
            </TableHead>
            <TableBody>
              {pieceRows.length === 0 && <TableRow><TableCell colSpan={7}><Typography color="text.secondary" sx={{ py: 2 }}>No serial-tracked pieces.</Typography></TableCell></TableRow>}
              {pieceRows.map((p) => (
                <TableRow key={p.id} hover>
                  <TableCell><b>{p.serial}</b></TableCell>
                  <TableCell>{p.itemName}</TableCell>
                  <TableCell><StatusChip status={p.state} /></TableCell>
                  <TableCell>{p.storeName ?? '—'}</TableCell>
                  <TableCell>{p.vehicleNo ?? '—'}</TableCell>
                  <TableCell>{dayjs(p.updatedAt).format('D MMM YYYY')}</TableCell>
                  <TableCell align="right">
                    {access.can('stock_movement', 'edit') && p.state === 'in_stock' && <Button size="small" onClick={() => pieceState.mutate({ id: p.id, state: 'damaged' })}>Mark damaged</Button>}
                    {access.can('stock_movement', 'edit') && p.state === 'damaged' && <Button size="small" onClick={() => pieceState.mutate({ id: p.id, state: 'in_stock' })}>Back to usable</Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}

/* -------------------------------------------------------------- movements */

export function MovementsPage() {
  const qc = useQueryClient();
  const n = useNames();
  const access = useAccess();
  const [filters, setFilters] = useState({ kind: '', status: '', storeId: '', search: '' });
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const list = useQuery({ queryKey: ['stock', 'movements', query], queryFn: () => http<MovementRow[]>(`/erp/stock/movements?${query}`) });
  const stores = useQuery({ queryKey: ['options', 'store-options'], queryFn: storeOptions });
  const receive = useMutation({
    mutationFn: (id: number) => http(`/erp/stock/movements/${id}/receive`, { method: 'POST' }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['stock'] }),
  });
  const set = (k: keyof typeof filters, v: string) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
        <Box>
          <Typography variant="h5">Stock Movements</Typography>
          <Typography color="text.secondary">Every change of stock, newest first. Nothing changes stock any other way.</Typography>
        </Box>
        {access.can('stock_movement', 'create') && <NewMovement />}
      </Stack>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
        <TextField select size="small" label="Kind" value={filters.kind} onChange={(e) => set('kind', e.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value="">All kinds</MenuItem>
          {Object.entries(KIND_LABEL).map(([k, l]) => <MenuItem key={k} value={k}>{l}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Status" value={filters.status} onChange={(e) => set('status', e.target.value)} sx={{ minWidth: 160 }}>
          <MenuItem value="">All statuses</MenuItem>
          <MenuItem value="completed">Completed</MenuItem>
          <MenuItem value="in_transit">In transit</MenuItem>
        </TextField>
        <TextField select size="small" label="Store" value={filters.storeId} onChange={(e) => set('storeId', e.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value="">All stores</MenuItem>
          {stores.data?.map((s) => <MenuItem key={s.value} value={String(s.value)}>{s.label}</MenuItem>)}
        </TextField>
        <TextField size="small" label="Search doc, LR, vehicle, item" value={filters.search} onChange={(e) => set('search', e.target.value)} sx={{ flexGrow: 1 }} />
      </Stack>
      {receive.isError && <Alert severity="error">{errorMessage(receive.error)}</Alert>}
      <Card>
        <Table size="small">
          <TableHead>
            <TableRow>{['Time', 'Kind', 'Item', 'Store', 'Qty', 'Value', 'Vehicle / LR', 'Doc ref', 'Status', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow>
          </TableHead>
          <TableBody>
            {list.data?.length === 0 && <TableRow><TableCell colSpan={10}><Typography color="text.secondary" sx={{ py: 2 }}>No movements match.</Typography></TableCell></TableRow>}
            {list.data?.map((m) => (
              <TableRow key={m.id} hover>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{dayjs(m.movedAt).format('D MMM, HH:mm')}</TableCell>
                <TableCell>{KIND_LABEL[m.kind] ?? statusLabel(m.kind)}</TableCell>
                <TableCell>{m.itemName}{m.serials.length > 0 && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{m.serials.join(', ')}</Typography>}</TableCell>
                <TableCell>{n.store(m.storeId)}{m.toStoreId && ` → ${n.store(m.toStoreId)}`}</TableCell>
                <TableCell>{num(m.qty)} {m.unit ?? ''}</TableCell>
                <TableCell>{inr(m.value)}</TableCell>
                <TableCell>{[m.vehicleNo, m.lrNo].filter(Boolean).join(' · ') || '—'}</TableCell>
                <TableCell>{m.docNo}{m.refNo && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{m.refNo}</Typography>}</TableCell>
                <TableCell><StatusChip status={m.status} /></TableCell>
                <TableCell>
                  {m.status === 'in_transit' && access.can('stock_movement', 'edit') && (
                    <Button size="small" variant="contained" onClick={() => receive.mutate(m.id)}>Receive</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </Stack>
  );
}

/* ---------------------------------------------------------- opening stock */

interface Batch {
  id: number;
  batchId: string;
  storeId: number;
  totalQty: number;
  totalValue: number;
  createdAt: string;
  lines: unknown[];
}

const openingFields: Field[] = [
  { path: 'storeId', label: 'Target store', type: 'select', required: true, options: storeOptions, optionsKey: 'store-options' },
  { path: 'batchId', label: 'Batch ID (optional)', helper: 'Re-posting the same batch ID does nothing, so retries are safe' },
  {
    path: 'lines',
    label: 'Opening quantities',
    type: 'lines',
    newLine: { qty: 1, rate: 0 },
    lineFields: [
      { path: 'itemId', label: 'Item', type: 'autocomplete', required: true, options: itemOptions, optionsKey: 'item-options', fullWidth: true },
      { path: 'qty', label: 'Qty', type: 'number', required: true },
      { path: 'rate', label: 'Rate SAR', type: 'number', required: true },
      { path: 'serials', label: 'Serials (tracked items)', type: 'list' },
    ],
  },
];

export function OpeningStockPage() {
  const qc = useQueryClient();
  const n = useNames();
  const access = useAccess();
  const batches = useQuery({ queryKey: ['stock', 'opening'], queryFn: () => http<Batch[]>('/erp/inventory/opening') });
  const items = useQuery({ queryKey: ['items'], queryFn: () => http<Item[]>('/erp/masters/items') });
  const [initial, setInitial] = useState<Record<string, unknown>>({ lines: [] });
  const [formKey, setFormKey] = useState(0);
  const [importNote, setImportNote] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const post = useMutation({
    mutationFn: (v: Record<string, unknown>) => http<Batch & { alreadyPosted: boolean }>('/erp/inventory/opening/post', { method: 'POST', body: JSON.stringify(v) }),
    onSuccess: () => {
      setInitial({ lines: [] });
      setFormKey((k) => k + 1);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['stock'] }),
  });

  /** CSV columns: item code, qty, rate, serials (semicolon-separated). */
  async function importCsv(text: string) {
    const [header, ...rows] = parseCsv(text);
    const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name);
    const byCode = new Map(items.data?.map((i) => [i.code.toUpperCase(), i.id]));
    const missing: string[] = [];
    const lines = rows.flatMap((r) => {
      const code = (r[col('code')] ?? '').trim().toUpperCase();
      const itemId = byCode.get(code);
      if (!itemId) {
        missing.push(code || '(blank)');
        return [];
      }
      return [{ itemId, qty: Number(r[col('qty')]), rate: Number(r[col('rate')] ?? 0), serials: (r[col('serials')] ?? '').split(';').map((x) => x.trim()).filter(Boolean) }];
    });
    setInitial((v) => ({ ...v, lines }));
    setFormKey((k) => k + 1);
    setImportNote(`${lines.length} lines loaded${missing.length ? `; unknown item codes skipped: ${missing.join(', ')}` : ''}. Check them, then post.`);
  }

  return (
    <Stack spacing={2} sx={{ maxWidth: 1100 }}>
      <Box>
        <Typography variant="h5">Opening Stock</Typography>
        <Typography color="text.secondary">Set the starting quantities, unit costs and serial numbers when you begin using the system.</Typography>
      </Box>
      {post.data && <Alert severity={post.data.alreadyPosted ? 'info' : 'success'}>{post.data.alreadyPosted ? `Batch ${post.data.batchId} was already posted; nothing changed.` : `Posted batch ${post.data.batchId}: ${num(post.data.totalQty)} units, ${inr(post.data.totalValue)}.`}</Alert>}
      {importNote && <Alert severity="info" onClose={() => setImportNote(null)}>{importNote}</Alert>}
      {access.can('stock_movement', 'create') && (
        <>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" startIcon={<FileUploadOutlined />} onClick={() => file.current?.click()}>Import CSV</Button>
            <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>Columns: code, qty, rate, serials (separate serials with ;)</Typography>
            <input ref={file} hidden type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) await importCsv(await f.text()); e.target.value = ''; }} />
          </Stack>
          <RecordForm key={formKey} fields={openingFields} initial={initial} onSubmit={(v) => post.mutate(v)} busy={post.isPending} error={post.isError ? errorMessage(post.error) : null} submitLabel="Post opening stock" />
        </>
      )}
      <Card>
        <CardContent><Typography variant="h6">Posted batches</Typography></CardContent>
        <Table size="small">
          <TableHead>
            <TableRow>{['Batch', 'Store', 'Posted', 'Lines', 'Quantity', 'Value'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow>
          </TableHead>
          <TableBody>
            {batches.data?.length === 0 && <TableRow><TableCell colSpan={6}><Typography color="text.secondary">Nothing posted yet.</Typography></TableCell></TableRow>}
            {batches.data?.map((b) => (
              <TableRow key={b.id}>
                <TableCell>{b.batchId}</TableCell>
                <TableCell>{n.store(b.storeId)}</TableCell>
                <TableCell>{dayjs(b.createdAt).format('D MMM YYYY')}</TableCell>
                <TableCell>{b.lines.length}</TableCell>
                <TableCell>{num(b.totalQty)}</TableCell>
                <TableCell>{inr(b.totalValue)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </Stack>
  );
}

/* ------------------------------------------------------------ GL settings */

export function InventoryGlPage() {
  const qc = useQueryClient();
  const access = useAccess();
  const gl = useQuery({ queryKey: ['stock', 'gl'], queryFn: () => http<{ enabled: boolean; unposted: number; unpostedValue: number }>('/erp/stock/gl') });
  const [from, setFrom] = useState('');
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => http('/erp/stock/gl', { method: 'PUT', body: JSON.stringify({ enabled }) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['stock', 'gl'] }),
  });
  const backfill = useMutation({
    mutationFn: (dryRun: boolean) => http<{ dryRun: boolean; count: number; value: number }>('/erp/stock/gl/backfill', { method: 'POST', body: JSON.stringify({ dryRun, from: from || undefined }) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['stock', 'gl'] }),
  });
  const canManage = access.role === 'admin' || access.role === 'accountant';
  const err = toggle.error ?? backfill.error;
  return (
    <Stack spacing={2} sx={{ maxWidth: 820 }}>
      <Box>
        <Typography variant="h5">Inventory GL Integration</Typography>
        <Typography color="text.secondary">Post stock movements to the general ledger as balanced vouchers.</Typography>
      </Box>
      {err && <Alert severity="error">{errorMessage(err)}</Alert>}
      <Card>
        <CardContent>
          <FormControlLabel
            control={<Switch checked={Boolean(gl.data?.enabled)} disabled={!canManage || toggle.isPending} onChange={(e) => toggle.mutate(e.target.checked)} />}
            label="Post stock movements to the general ledger"
          />
          <Typography variant="body2" color="text.secondary">
            When on, every receipt, issue, adjustment, write-off and sale creates a voucher (e.g. issue: Dr Vehicle Maintenance Expense, Cr Inventory). Transfers between your own stores do not.
          </Typography>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Typography variant="h6">Backfill earlier movements</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {gl.data ? `${num(gl.data.unposted)} movements worth ${inr(gl.data.unpostedValue)} have no voucher yet. Movements that already have one are skipped.` : 'Loading…'}
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField size="small" type="date" label="From date (optional)" value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            <Button variant="outlined" disabled={!canManage || backfill.isPending} onClick={() => backfill.mutate(true)}>Dry run</Button>
            <Button variant="contained" disabled={!canManage || backfill.isPending || !gl.data?.unposted} onClick={() => backfill.mutate(false)}>Post vouchers</Button>
          </Stack>
          {backfill.data && (
            <Alert severity={backfill.data.dryRun ? 'info' : 'success'} sx={{ mt: 2 }}>
              {backfill.data.dryRun ? `Would post ${backfill.data.count} vouchers (${inr(backfill.data.value)}).` : `Posted ${backfill.data.count} vouchers (${inr(backfill.data.value)}).`}
            </Alert>
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}
