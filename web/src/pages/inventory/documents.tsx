import { Box, Button, Typography } from '@mui/material';
import dayjs from 'dayjs';
import { http } from '../../api/http';
import { EntityPage, type EntityConfig, type Field } from '../../components/EntityPage';
import { useAccess } from '../../lib/access';
import { inr, itemOptions, num, partyOptions, StatusChip, storeOptions, useNames } from './shared';

type Lines<T> = T[];
interface RequestRow {
  id: number;
  reqNo: string;
  kind: 'buy' | 'transfer';
  storeId: number;
  fromStoreId: number | null;
  neededBy: string | null;
  lines: Lines<{ itemId: number; qty: number; note: string | null }>;
  notes: string | null;
  status: string;
  requestedByName: string | null;
}
interface ReceiptRow {
  id: number;
  recNo: string;
  poNo: string | null;
  supplierId: number | null;
  storeId: number;
  lrNo: string | null;
  lines: Lines<{ itemId: number; expected: number; received: number; rate: number | null; serials: string[] }>;
  status: string;
  expectedAt: string | null;
  landedAt: string | null;
}
interface SaleRow {
  id: number;
  saleNo: string;
  saleDate: string;
  buyerId: number;
  storeId: number;
  lines: Lines<{ itemId: number; qty: number; rate: number; gstRate: number; serials: string[] }>;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  remarks: string | null;
  status: string;
}
interface LoanRow {
  id: number;
  loanNo: string;
  direction: 'lent' | 'borrowed';
  sisterId: number;
  tyreSerial: string;
  tyreSpec: string;
  loanDate: string;
  expectedReturn: string | null;
  location: string | null;
  challanNo: string | null;
  remarks: string | null;
  status: string;
  returnedAt: string | null;
}

const post = (url: string, body?: unknown) => http(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const date = (v: string | null) => (v ? dayjs(v).format('D MMM YYYY') : '—');
const itemField: Field = { path: 'itemId', label: 'Item', type: 'autocomplete', required: true, options: itemOptions, optionsKey: 'item-options', fullWidth: true };

/* --------------------------------------------------------------- requests */

export function RequestsPage() {
  const n = useNames();
  const access = useAccess();
  const config: EntityConfig<RequestRow> = {
    title: 'Stock Requests',
    singular: 'request',
    subtitle: 'Ask for stock: buy it, or have another store send it. Approved requests become transfers or expected deliveries.',
    endpoint: '/erp/inventory/requests',
    queryKey: 'stock-requests',
    docType: 'stock_request',
    defaults: { kind: 'buy', lines: [] },
    searchText: (r) => `${r.reqNo} ${r.notes ?? ''} ${r.requestedByName ?? ''} ${r.lines.map((l) => n.item(l.itemId)).join(' ')}`,
    canEditRow: (r) => r.status === 'open',
    columns: [
      { label: 'Request', render: (r) => <Box><b>{r.reqNo}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>by {r.requestedByName ?? '—'}</Typography></Box>, csv: (r) => r.reqNo },
      { label: 'Kind', render: (r) => (r.kind === 'buy' ? 'Buy' : 'Send me stock') },
      { label: 'For store', render: (r) => n.store(r.storeId) },
      { label: 'From store', render: (r) => n.store(r.fromStoreId) },
      { label: 'Items', render: (r) => r.lines.map((l) => `${num(l.qty)} × ${n.item(l.itemId)}`).join(', ') },
      { label: 'Needed by', render: (r) => date(r.neededBy) },
      { label: 'Status', render: (r) => <StatusChip status={r.status} />, csv: (r) => r.status },
    ],
    fields: [
      { path: 'kind', label: 'Request', type: 'select', required: true, options: [{ value: 'buy', label: 'Buy (procurement)' }, { value: 'transfer', label: 'Send me stock (from another store)' }] },
      { path: 'storeId', label: 'For store', type: 'select', required: true, options: storeOptions, optionsKey: 'store-options' },
      { path: 'fromStoreId', label: 'From store', type: 'select', options: storeOptions, optionsKey: 'store-options', visible: (v) => v.kind === 'transfer' },
      { path: 'neededBy', label: 'Needed by', type: 'date' },
      { path: 'lines', label: 'Items', type: 'lines', newLine: { qty: 1 }, lineFields: [itemField, { path: 'qty', label: 'Qty', type: 'number', required: true }, { path: 'note', label: 'Note (size, brand…)' }] },
      { path: 'notes', label: 'Purpose / notes', type: 'textarea' },
    ],
    rowActions: (r, run) => (
      <>
        {(r.status === 'open' || r.status === 'rejected') && access.can('stock_request', 'create') && (
          <Button size="small" onClick={() => run(() => post(`/erp/inventory/requests/${r.id}/submit`))}>Submit</Button>
        )}
        {r.status === 'approved' && access.can('stock_movement', 'create') && (
          <Button size="small" variant="contained" onClick={() => run(() => post(`/erp/inventory/requests/${r.id}/fulfil`))}>
            {r.kind === 'transfer' ? 'Send stock' : 'Order'}
          </Button>
        )}
        {['open', 'approved', 'rejected'].includes(r.status) && access.can('stock_request', 'edit') && (
          <Button size="small" color="inherit" onClick={() => run(() => post(`/erp/inventory/requests/${r.id}/cancel`))}>Cancel</Button>
        )}
      </>
    ),
  };
  return <EntityPage config={config} />;
}

/* ------------------------------------------------------- goods to receive */

export function ReceivePage() {
  const n = useNames();
  const access = useAccess();
  const config: EntityConfig<ReceiptRow> = {
    title: 'Goods to Receive',
    singular: 'expected delivery',
    subtitle: 'Enter the units that arrived, then land them: the stock goes into the store and the supplier bill can be booked.',
    endpoint: '/erp/inventory/receipts',
    queryKey: 'goods-receipts',
    docType: 'goods_receipt',
    defaults: { lines: [] },
    searchText: (r) => `${r.recNo} ${r.poNo ?? ''} ${r.lrNo ?? ''} ${n.party(r.supplierId)}`,
    canEditRow: (r) => r.status !== 'landed',
    columns: [
      { label: 'Receipt / PO', render: (r) => <Box><b>{r.recNo}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{[r.poNo, r.lrNo].filter(Boolean).join(' · ') || '—'}</Typography></Box>, csv: (r) => r.recNo },
      { label: 'Supplier', render: (r) => n.party(r.supplierId) },
      { label: 'Store', render: (r) => n.store(r.storeId) },
      { label: 'Items', render: (r) => r.lines.map((l) => `${num(l.expected)} × ${n.item(l.itemId)}`).join(', ') },
      { label: 'Arrived', render: (r) => r.lines.map((l) => `${num(l.received)}/${num(l.expected)}`).join(', ') },
      { label: 'Expected', render: (r) => date(r.expectedAt) },
      { label: 'Status', render: (r) => <StatusChip status={r.status} />, csv: (r) => r.status },
    ],
    fields: [
      { path: 'poNo', label: 'PO number' },
      { path: 'supplierId', label: 'Supplier', type: 'autocomplete', options: partyOptions('vendor'), optionsKey: 'vendor-options' },
      { path: 'storeId', label: 'Destination store', type: 'select', required: true, options: storeOptions, optionsKey: 'store-options' },
      { path: 'lrNo', label: 'LR number' },
      { path: 'expectedAt', label: 'Expected on', type: 'date' },
      {
        path: 'lines',
        label: 'Items',
        type: 'lines',
        newLine: { expected: 1, received: 0 },
        lineFields: [
          itemField,
          { path: 'expected', label: 'Expected', type: 'number', required: true },
          { path: 'received', label: 'Arrived', type: 'number' },
          { path: 'rate', label: 'Rate ₹', type: 'number' },
          { path: 'serials', label: 'Serials (tracked items)', type: 'list' },
        ],
      },
      { path: 'notes', label: 'Notes', type: 'textarea' },
    ],
    rowActions: (r, run) =>
      r.status !== 'landed' && access.can('goods_receipt', 'edit') ? (
        <Button size="small" variant="contained" disabled={!r.lines.some((l) => l.received > 0)} onClick={() => run(() => post(`/erp/inventory/receipts/${r.id}/land`))}>
          Approve &amp; land
        </Button>
      ) : null,
  };
  return <EntityPage config={config} />;
}

/* ------------------------------------------------------------------ sales */

export function SalesPage() {
  const n = useNames();
  const access = useAccess();
  const config: EntityConfig<SaleRow> = {
    title: 'Stock Sales',
    singular: 'sale',
    subtitle: 'Scrapped tyres and surplus spares sold to outside parties. GST is split CGST+SGST within the state, IGST across states.',
    endpoint: '/erp/inventory/sales',
    queryKey: 'stock-sales',
    docType: 'stock_sale',
    defaults: { lines: [] },
    searchText: (r) => `${r.saleNo} ${n.party(r.buyerId)} ${r.remarks ?? ''}`,
    canEditRow: (r) => r.status === 'draft' || r.status === 'rejected',
    columns: [
      { label: 'Invoice #', render: (r) => r.saleNo },
      { label: 'Date', render: (r) => date(r.saleDate) },
      { label: 'Buyer', render: (r) => n.party(r.buyerId) },
      { label: 'From store', render: (r) => n.store(r.storeId) },
      { label: 'Items', render: (r) => r.lines.map((l) => `${num(l.qty)} × ${n.item(l.itemId)}`).join(', ') },
      { label: 'Taxable', render: (r) => inr(r.taxable), csv: (r) => r.taxable },
      { label: 'GST', render: (r) => (r.igst ? `IGST ${inr(r.igst)}` : `CGST ${inr(r.cgst)} + SGST ${inr(r.sgst)}`), csv: (r) => r.cgst + r.sgst + r.igst },
      { label: 'Total', render: (r) => <b>{inr(r.total)}</b>, csv: (r) => r.total },
      { label: 'Status', render: (r) => <StatusChip status={r.status} />, csv: (r) => r.status },
    ],
    fields: [
      { path: 'buyerId', label: 'Buyer', type: 'autocomplete', required: true, options: partyOptions('buyer'), optionsKey: 'buyer-options' },
      { path: 'storeId', label: 'From store', type: 'select', required: true, options: storeOptions, optionsKey: 'store-options' },
      { path: 'saleDate', label: 'Date', type: 'date' },
      {
        path: 'lines',
        label: 'Items sold',
        type: 'lines',
        newLine: { qty: 1, gstRate: 18 },
        lineFields: [
          itemField,
          { path: 'qty', label: 'Qty', type: 'number', required: true },
          { path: 'rate', label: 'Rate ₹', type: 'number', required: true },
          { path: 'gstRate', label: 'GST %', type: 'number', required: true },
          { path: 'serials', label: 'Serials (tracked items)', type: 'list' },
        ],
      },
      { path: 'remarks', label: 'Remarks / tender reference', type: 'textarea' },
    ],
    rowActions: (r, run) => {
      const edit = access.can('stock_sale', 'edit');
      return (
        <>
          {(r.status === 'draft' || r.status === 'rejected') && access.can('stock_sale', 'create') && (
            <Button size="small" onClick={() => run(() => post(`/erp/inventory/sales/${r.id}/submit`))}>Submit</Button>
          )}
          {r.status === 'approved' && edit && <Button size="small" variant="contained" onClick={() => run(() => post(`/erp/inventory/sales/${r.id}/invoice`))}>Invoice</Button>}
          {r.status === 'invoiced' && edit && <Button size="small" onClick={() => run(() => post(`/erp/inventory/sales/${r.id}/dispatch`))}>Dispatched</Button>}
          {(r.status === 'invoiced' || r.status === 'dispatched') && edit && <Button size="small" onClick={() => run(() => post(`/erp/inventory/sales/${r.id}/paid`))}>Paid</Button>}
        </>
      );
    },
  };
  return <EntityPage config={config} />;
}

/* ------------------------------------------------------------ group loans */

export function GroupLoansPage() {
  const n = useNames();
  const access = useAccess();
  const overdue = (r: LoanRow) => r.status === 'active' && r.expectedReturn !== null && dayjs(r.expectedReturn).isBefore(dayjs(), 'day');
  const config: EntityConfig<LoanRow> = {
    title: 'Group Loans',
    singular: 'loan',
    subtitle: 'Tyres lent to and borrowed from the other companies of the group.',
    endpoint: '/erp/inventory/loans',
    queryKey: 'group-loans',
    docType: 'group_loan',
    defaults: { direction: 'lent' },
    searchText: (r) => `${r.loanNo} ${r.tyreSerial} ${r.tyreSpec} ${n.party(r.sisterId)} ${r.location ?? ''} ${r.challanNo ?? ''}`,
    canEditRow: (r) => r.status === 'active',
    columns: [
      { label: 'Loan #', render: (r) => r.loanNo },
      { label: 'Direction', render: (r) => (r.direction === 'lent' ? 'Lent to' : 'Borrowed from') },
      { label: 'Sister company', render: (r) => n.party(r.sisterId) },
      { label: 'Tyre', render: (r) => <Box><b>{r.tyreSerial}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{r.tyreSpec}</Typography></Box>, csv: (r) => `${r.tyreSerial} ${r.tyreSpec}` },
      { label: 'Location / fitment', render: (r) => r.location ?? '—' },
      { label: 'Loan date', render: (r) => date(r.loanDate) },
      { label: 'Expected return', render: (r) => date(r.expectedReturn) },
      { label: 'Challan #', render: (r) => r.challanNo ?? '—' },
      { label: 'Status', render: (r) => <StatusChip status={overdue(r) ? 'overdue' : r.status} />, csv: (r) => (overdue(r) ? 'overdue' : r.status) },
    ],
    fields: [
      { path: 'direction', label: 'Direction', type: 'select', required: true, options: [{ value: 'lent', label: 'Lent to sister company' }, { value: 'borrowed', label: 'Borrowed from sister company' }] },
      { path: 'sisterId', label: 'Sister company', type: 'select', required: true, options: partyOptions('sister_company'), optionsKey: 'sister-options' },
      { path: 'tyreSerial', label: 'Tyre serial no.', required: true },
      { path: 'tyreSpec', label: 'Size / brand', required: true, helper: 'e.g. 295/80 R22.5 Apollo' },
      { path: 'loanDate', label: 'Loan date', type: 'date', required: true },
      { path: 'expectedReturn', label: 'Expected return', type: 'date' },
      { path: 'location', label: 'Store or vehicle fitment' },
      { path: 'challanNo', label: 'Challan / gate pass #' },
      { path: 'remarks', label: 'Remarks / purpose', type: 'textarea' },
    ],
    rowActions: (r, run) =>
      r.status === 'active' && access.can('group_loan', 'edit') ? (
        <Button size="small" onClick={() => run(() => post(`/erp/inventory/loans/${r.id}/return`, {}))}>Mark returned</Button>
      ) : null,
  };
  return <EntityPage config={config} />;
}
