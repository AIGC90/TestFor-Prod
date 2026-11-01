import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import FileUploadOutlined from '@mui/icons-material/FileUploadOutlined';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useMemo, useRef, useState } from 'react';
import { http } from '../../api/http';
import { EntityForm, EntityPage, type EntityConfig, errorMessage, type Field, RecordForm } from '../../components/EntityPage';
import { useAccess } from '../../lib/access';
import { downloadCsv, parseCsv } from '../../lib/csv';
import { inr, itemOptions, num, partyOptions, StatusChip, storeOptions, useNames } from '../inventory/shared';
import { type Party, partiesConfig, plantOptions } from '../masters/masters';

dayjs.extend(relativeTime);

const post = (url: string, body?: unknown) => http(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const date = (v: string | null | undefined) => (v ? dayjs(v).format('D MMM YYYY') : '—');
const opts = (pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));
const RATE_BASIS = opts([['per_tonne_km', 'Per tonne-km'], ['per_tonne', 'Per tonne'], ['fixed', 'Fixed freight']]);

/* ------------------------------------------------------ customers & orders */

interface Order {
  id: number;
  orderNo: string;
  bookedOn: string;
  customerId: number;
  consignee: string | null;
  origin: string;
  destination: string;
  material: string | null;
  weightT: number | null;
  distanceKm: number | null;
  rateBasis: string;
  rate: number;
  value: number;
  status: string;
  billingStatus: string;
  tripId: number | null;
}
interface Tariff {
  id: number;
  customerId: number;
  cargoCategory: string;
  basis: string;
  rate: number;
  detentionPerDay: number | null;
  creditDays: number | null;
  minTonnage: number | null;
  validTo: string | null;
}
interface Complaint {
  id: number;
  ticketNo: string;
  customerId: number;
  category: string;
  description: string;
  priority: string;
  status: string;
  createdAt: string;
}

export function CustomersPage() {
  const n = useNames();
  const [tab, setTab] = useState<'orders' | 'clients' | 'tariffs' | 'complaints'>('orders');
  const orders = useQuery({ queryKey: ['orders'], queryFn: () => http<Order[]>('/erp/ops/orders') });
  const list = orders.data ?? [];
  const openValue = list.filter((o) => !['delivered', 'cancelled'].includes(o.status)).reduce((s, o) => s + o.value, 0);
  const receivable = list.filter((o) => o.status !== 'cancelled' && o.billingStatus !== 'paid').reduce((s, o) => s + o.value, 0);
  const customerOpt = { type: 'autocomplete' as const, options: partyOptions('customer'), optionsKey: 'customer-options' };

  const ordersConfig: EntityConfig<Order> = {
    title: 'Customer Orders',
    singular: 'order',
    endpoint: '/erp/ops/orders',
    queryKey: 'orders',
    docType: 'order',
    defaults: { rateBasis: 'per_tonne_km', status: 'booked', billingStatus: 'pending' },
    searchText: (o) => `${o.orderNo} ${n.party(o.customerId)} ${o.origin} ${o.destination} ${o.material ?? ''} ${o.consignee ?? ''}`,
    columns: [
      { label: 'Order', render: (o) => <Box><b>{o.orderNo}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Booked {date(o.bookedOn)}</Typography></Box>, csv: (o) => o.orderNo },
      { label: 'Customer & consignee', render: (o) => <Box>{n.party(o.customerId)}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{o.consignee ?? '—'}</Typography></Box>, csv: (o) => n.party(o.customerId) },
      { label: 'Route & cargo', render: (o) => <Box>{o.origin} → {o.destination}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{[o.material, o.weightT ? `${num(o.weightT)} t` : null].filter(Boolean).join(' · ')}</Typography></Box>, csv: (o) => `${o.origin} → ${o.destination}` },
      { label: 'Value', render: (o) => <Box><b>{inr(o.value)}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{RATE_BASIS.find((r) => r.value === o.rateBasis)?.label} @ {inr(o.rate)}</Typography></Box>, csv: (o) => o.value },
      { label: 'Transit', render: (o) => <StatusChip status={o.status} />, csv: (o) => o.status },
      { label: 'Billing', render: (o) => <StatusChip status={o.billingStatus} />, csv: (o) => o.billingStatus },
    ],
    fields: [
      { section: 'Booking', path: 'customerId', label: 'Customer', required: true, ...customerOpt },
      { section: 'Booking', path: 'consignee', label: 'Consignee / deliver to' },
      { section: 'Booking', path: 'origin', label: 'From', required: true },
      { section: 'Booking', path: 'destination', label: 'To', required: true },
      { section: 'Booking', path: 'material', label: 'Material' },
      { section: 'Booking', path: 'bookedOn', label: 'Booked on', type: 'date' },
      { section: 'Pricing', path: 'weightT', label: 'Weight (tonnes)', type: 'number' },
      { section: 'Pricing', path: 'distanceKm', label: 'Distance (km)', type: 'number' },
      { section: 'Pricing', path: 'rateBasis', label: 'Rate basis', type: 'select', required: true, options: RATE_BASIS },
      { section: 'Pricing', path: 'rate', label: 'Rate (₹)', type: 'number', required: true },
      { section: 'Status', path: 'status', label: 'Transit status', type: 'select', options: opts([['booked', 'Booked'], ['dispatched', 'Dispatched'], ['in_transit', 'In transit'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']]) },
      { section: 'Status', path: 'billingStatus', label: 'Billing status', type: 'select', options: opts([['pending', 'Pending'], ['advance_received', 'Advance received'], ['invoiced', 'Invoiced'], ['paid', 'Paid']]) },
      { section: 'Status', path: 'notes', label: 'Notes', type: 'textarea' },
    ],
  };
  const tariffsConfig: EntityConfig<Tariff> = {
    title: 'Tariffs & Rate Contracts',
    singular: 'tariff',
    endpoint: '/erp/ops/tariffs',
    queryKey: 'tariffs',
    docType: 'order',
    defaults: { basis: 'per_tonne_km' },
    searchText: (t) => `${n.party(t.customerId)} ${t.cargoCategory}`,
    columns: [
      { label: 'Shipper', render: (t) => n.party(t.customerId) },
      { label: 'Cargo', render: (t) => t.cargoCategory },
      { label: 'Tariff', render: (t) => `${inr(t.rate)} ${RATE_BASIS.find((r) => r.value === t.basis)?.label.toLowerCase()}` },
      { label: 'Detention / day', render: (t) => inr(t.detentionPerDay) },
      { label: 'Credit days', render: (t) => t.creditDays ?? '—' },
      { label: 'Min tonnage', render: (t) => num(t.minTonnage) },
      { label: 'Valid to', render: (t) => date(t.validTo) },
    ],
    fields: [
      { path: 'customerId', label: 'Shipper', required: true, ...customerOpt },
      { path: 'cargoCategory', label: 'Cargo category', required: true },
      { path: 'basis', label: 'Basis', type: 'select', required: true, options: RATE_BASIS },
      { path: 'rate', label: 'Rate (₹)', type: 'number', required: true },
      { path: 'detentionPerDay', label: 'Detention per day (₹)', type: 'number' },
      { path: 'creditDays', label: 'Credit days', type: 'number' },
      { path: 'minTonnage', label: 'Minimum assured tonnage', type: 'number' },
      { path: 'validFrom', label: 'Valid from', type: 'date' },
      { path: 'validTo', label: 'Valid to', type: 'date' },
      { path: 'notes', label: 'Notes', type: 'textarea' },
    ],
  };
  const complaintsConfig: EntityConfig<Complaint> = {
    title: 'Complaints & SLA',
    singular: 'ticket',
    endpoint: '/erp/ops/complaints',
    queryKey: 'complaints',
    docType: 'order',
    defaults: { priority: 'medium', status: 'open' },
    searchText: (c) => `${c.ticketNo} ${n.party(c.customerId)} ${c.category} ${c.description}`,
    columns: [
      { label: 'Ticket', render: (c) => <Box><b>{c.ticketNo}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{date(c.createdAt)}</Typography></Box>, csv: (c) => c.ticketNo },
      { label: 'Customer', render: (c) => n.party(c.customerId) },
      { label: 'Category', render: (c) => c.category },
      { label: 'Description', render: (c) => c.description },
      { label: 'Priority', render: (c) => <StatusChip status={c.priority === 'high' ? 'overdue' : c.priority === 'medium' ? 'pending_approval' : 'draft'} />, csv: (c) => c.priority },
      { label: 'Status', render: (c) => <StatusChip status={c.status} />, csv: (c) => c.status },
    ],
    fields: [
      { path: 'customerId', label: 'Customer', required: true, ...customerOpt },
      { path: 'category', label: 'Issue category', required: true, helper: 'e.g. Delay, Damage, Short delivery, Billing' },
      { path: 'priority', label: 'Priority', type: 'select', options: opts([['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]) },
      { path: 'status', label: 'Status', type: 'select', options: opts([['open', 'Open'], ['in_progress', 'In progress'], ['resolved', 'Resolved'], ['closed', 'Closed']]) },
      { path: 'description', label: 'Description', type: 'textarea', required: true },
      { path: 'resolution', label: 'Resolution', type: 'textarea' },
    ],
  };
  const clientsConfig: EntityConfig<Party> = {
    ...partiesConfig,
    title: 'Client Directory',
    queryKey: 'parties',
    rowFilter: (p) => p.kinds.includes('customer'),
    defaults: { kinds: ['customer'], active: true },
  };

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5">Customer & Orders</Typography>
        <Typography color="text.secondary">Customers, freight orders, contract tariffs and service complaints.</Typography>
      </Box>
      <Grid container spacing={2}>
        {([
          ['Orders booked', num(list.length)],
          ['In transit', num(list.filter((o) => ['dispatched', 'in_transit'].includes(o.status)).length)],
          ['Open order value', inr(openValue)],
          ['Not yet paid', inr(receivable)],
        ] as [string, string][]).map(([k, v]) => (
          <Grid key={k} size={{ xs: 6, md: 3 }}><Card><CardContent><Typography variant="body2" color="text.secondary">{k}</Typography><Typography variant="h6">{v}</Typography></CardContent></Card></Grid>
        ))}
      </Grid>
      <Card>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable">
          <Tab value="orders" label="Customer orders" />
          <Tab value="clients" label="Client directory" />
          <Tab value="tariffs" label="Tariffs & rate contracts" />
          <Tab value="complaints" label="Complaints & SLA" />
        </Tabs>
      </Card>
      {tab === 'orders' && <EntityPage config={ordersConfig} />}
      {tab === 'clients' && <EntityPage config={clientsConfig} />}
      {tab === 'tariffs' && <EntityPage config={tariffsConfig} />}
      {tab === 'complaints' && <EntityPage config={complaintsConfig} />}
    </Stack>
  );
}

/* ----------------------------------------------------------- fuel indents */

interface Indent {
  id: number;
  indentNo: string;
  vehicleNo: string;
  lrNo: string | null;
  isEquipment: boolean;
  driverName: string | null;
  driverMobile: string | null;
  pump: string;
  indentDate: string;
  amount: number;
  rate: number | null;
  litres: number | null;
  status: string;
}

export function FuelIndentsPage() {
  const indents = useQuery({ queryKey: ['fuel-indents'], queryFn: () => http<Indent[]>('/erp/ops/fuel-indents') });
  const list = indents.data ?? [];
  const approved = list.filter((i) => i.status === 'approved');
  const withRate = approved.filter((i) => i.rate);
  const config: EntityConfig<Indent> = {
    title: 'Fuel Indents',
    singular: 'indent',
    subtitle: 'Fuel requests for vehicles. Each indent goes for approval before it is filled.',
    endpoint: '/erp/ops/fuel-indents',
    queryKey: 'fuel-indents',
    docType: 'fuel_indent',
    defaults: { isEquipment: false },
    searchText: (i) => `${i.indentNo} ${i.vehicleNo} ${i.driverName ?? ''} ${i.pump} ${i.lrNo ?? ''}`,
    canEditRow: (i) => i.status !== 'approved',
    columns: [
      { label: 'Indent', render: (i) => i.indentNo },
      { label: 'Vehicle / LR', render: (i) => <Box>{i.vehicleNo}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{i.lrNo ?? (i.isEquipment ? 'Equipment' : '—')}</Typography></Box>, csv: (i) => i.vehicleNo },
      { label: 'Driver', render: (i) => <Box>{i.driverName ?? '—'}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{i.driverMobile ?? ''}</Typography></Box>, csv: (i) => i.driverName },
      { label: 'Pump / vendor', render: (i) => i.pump },
      { label: 'Date', render: (i) => date(i.indentDate) },
      { label: 'Amount', render: (i) => <Box><b>{inr(i.amount)}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{i.litres ? `${num(i.litres)} L @ ${inr(i.rate)}` : ''}</Typography></Box>, csv: (i) => i.amount },
      { label: 'Status', render: (i) => <StatusChip status={i.status} />, csv: (i) => i.status },
    ],
    fields: [
      { section: 'Vehicle & driver', path: 'vehicleNo', label: 'Vehicle / LR number', required: true },
      { section: 'Vehicle & driver', path: 'lrNo', label: 'LR number' },
      { section: 'Vehicle & driver', path: 'isEquipment', label: 'Equipment (no driver)', type: 'switch' },
      { section: 'Vehicle & driver', path: 'driverName', label: 'Driver name', visible: (v) => !v.isEquipment },
      { section: 'Vehicle & driver', path: 'driverMobile', label: 'Driver mobile', visible: (v) => !v.isEquipment },
      { section: 'Pump & fuel', path: 'pump', label: 'Pump (or "Cash")', required: true },
      { section: 'Pump & fuel', path: 'indentDate', label: 'Date', type: 'date' },
      { section: 'Pump & fuel', path: 'amount', label: 'Amount (₹)', type: 'number', required: true },
      { section: 'Pump & fuel', path: 'rate', label: 'Rate ₹ / litre', type: 'number', helper: 'Used to work out litres' },
    ],
  };
  return (
    <Stack spacing={2}>
      <Grid container spacing={2}>
        {([
          ['Indents', num(list.length)],
          ['Waiting for approval', num(list.filter((i) => i.status === 'pending_approval').length)],
          ['Approved value', inr(approved.reduce((s, i) => s + i.amount, 0))],
          ['Average diesel rate', withRate.length ? `${inr(withRate.reduce((s, i) => s + (i.rate ?? 0), 0) / withRate.length)} / L` : '—'],
        ] as [string, string][]).map(([k, v]) => (
          <Grid key={k} size={{ xs: 6, md: 3 }}><Card><CardContent><Typography variant="body2" color="text.secondary">{k}</Typography><Typography variant="h6">{v}</Typography></CardContent></Card></Grid>
        ))}
      </Grid>
      <EntityPage config={config} />
    </Stack>
  );
}

/* -------------------------------------------------------- lorry receipts */

export interface Lr {
  id: number;
  lrNo: string;
  plantId: number | null;
  loadingDate: string | null;
  vehicleNo: string;
  fleetType: string;
  product: string | null;
  consignor: string | null;
  consignee: string | null;
  fromPlace: string | null;
  toPlace: string | null;
  chargedWeight: number | null;
  qty: number | null;
  invoiceNo: string | null;
  ewayBillNo: string | null;
  ewayExpiry: string | null;
  deliveryNo: string | null;
  driverName: string | null;
  driverContact: string | null;
  ownerName: string | null;
  ownerPan: string | null;
  brokerName: string | null;
  brokerPan: string | null;
  freightType: string | null;
  rate: number | null;
  advance: number | null;
  status: string;
  remarks: string | null;
  extra: Record<string, string>;
}

export const lrFields: Field[] = [
  { section: 'Consignment', path: 'lrNo', label: 'LR number', helper: 'Leave blank to number automatically' },
  { section: 'Consignment', path: 'plantId', label: 'Plant / loading siding', type: 'select', options: plantOptions, optionsKey: 'plant-options' },
  { section: 'Consignment', path: 'loadingDate', label: 'Loading date', type: 'date' },
  { section: 'Consignment', path: 'status', label: 'Status', type: 'select', options: opts([['generated', 'Generated'], ['loaded', 'Loaded'], ['in_transit', 'In transit'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']]) },
  { section: 'Consignment', path: 'product', label: 'Product / material' },
  { section: 'Consignment', path: 'chargedWeight', label: 'Charged weight (MT)', type: 'number' },
  { section: 'Consignment', path: 'qty', label: 'Quantity', type: 'number' },
  { section: 'Consignment', path: 'consignor', label: 'Consignor' },
  { section: 'Consignment', path: 'consignee', label: 'Consignee' },
  { section: 'Consignment', path: 'fromPlace', label: 'From' },
  { section: 'Consignment', path: 'toPlace', label: 'To' },
  { section: 'Vehicle', path: 'vehicleNo', label: 'Vehicle / trailer no.', required: true },
  { section: 'Vehicle', path: 'fleetType', label: 'Fleet', type: 'select', options: opts([['own', 'Own fleet'], ['market', 'Market vehicle']]) },
  { section: 'Vehicle', path: 'driverName', label: 'Driver name' },
  { section: 'Vehicle', path: 'driverContact', label: 'Driver contact' },
  { section: 'Vehicle', path: 'ownerName', label: 'Vehicle owner', visible: (v) => v.fleetType === 'market' },
  { section: 'Vehicle', path: 'ownerPan', label: 'Owner PAN', visible: (v) => v.fleetType === 'market' },
  { section: 'Vehicle', path: 'brokerName', label: 'Broker', visible: (v) => v.fleetType === 'market' },
  { section: 'Vehicle', path: 'brokerPan', label: 'Broker PAN', visible: (v) => v.fleetType === 'market' },
  { section: 'Documents & freight', path: 'invoiceNo', label: 'Invoice no.' },
  { section: 'Documents & freight', path: 'ewayBillNo', label: 'E-Way bill no. (12 digits)' },
  { section: 'Documents & freight', path: 'ewayExpiry', label: 'E-Way bill expiry', type: 'date' },
  { section: 'Documents & freight', path: 'deliveryNo', label: 'Delivery no.' },
  { section: 'Documents & freight', path: 'freightType', label: 'Freight type', helper: 'e.g. Full truck load' },
  { section: 'Documents & freight', path: 'rate', label: 'Rate (₹ / MT)', type: 'number' },
  { section: 'Documents & freight', path: 'advance', label: 'Advance paid (₹)', type: 'number' },
  { section: 'Documents & freight', path: 'remarks', label: 'Remarks', type: 'textarea' },
];

export function LrRegisterPage() {
  const config: EntityConfig<Lr> = {
    title: 'LR Register',
    singular: 'LR',
    subtitle: 'Lorry receipts. Rows uploaded on the Loading Sheet appear here too.',
    endpoint: '/erp/ops/lrs',
    queryKey: 'lrs',
    docType: 'lr',
    defaults: { fleetType: 'own', status: 'generated', extra: {} },
    searchText: (r) => `${r.lrNo} ${r.vehicleNo} ${r.consignor ?? ''} ${r.consignee ?? ''} ${r.product ?? ''} ${r.invoiceNo ?? ''} ${r.ewayBillNo ?? ''}`,
    columns: [
      { label: 'LR', render: (r) => <b>{r.lrNo}</b>, csv: (r) => r.lrNo },
      { label: 'Date', render: (r) => date(r.loadingDate) },
      { label: 'Vehicle', render: (r) => <Box>{r.vehicleNo}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{r.fleetType === 'market' ? `Market · ${r.brokerName ?? 'no broker'}` : 'Own fleet'}</Typography></Box>, csv: (r) => r.vehicleNo },
      { label: 'Route', render: (r) => `${r.fromPlace ?? '—'} → ${r.toPlace ?? '—'}` },
      { label: 'Consignor → consignee', render: (r) => `${r.consignor ?? '—'} → ${r.consignee ?? '—'}` },
      { label: 'Product', render: (r) => <Box>{r.product ?? '—'}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{r.chargedWeight ? `${num(r.chargedWeight)} MT` : ''}</Typography></Box>, csv: (r) => r.product },
      { label: 'E-Way bill', render: (r) => <Box>{r.ewayBillNo ?? '—'}{r.ewayExpiry && <Typography variant="caption" color={dayjs(r.ewayExpiry).isBefore(dayjs()) ? 'error' : 'text.secondary'} sx={{ display: 'block' }}>till {date(r.ewayExpiry)}</Typography>}</Box>, csv: (r) => r.ewayBillNo },
      { label: 'Status', render: (r) => <StatusChip status={r.status} />, csv: (r) => r.status },
    ],
    fields: lrFields,
  };
  return <EntityPage config={config} />;
}

/* --------------------------------------------------------- loading sheet */

/** Spreadsheet header synonyms → LR fields; anything else lands in `extra`. */
const HEADER_MAP: Record<string, string> = {
  'lr no': 'lrNo', 'lr no.': 'lrNo', lrno: 'lrNo', 'lr number': 'lrNo',
  'loading dt': 'loadingDate', 'loading date': 'loadingDate', date: 'loadingDate',
  'vehicle no': 'vehicleNo', 'vehicle no.': 'vehicleNo', vehicle: 'vehicleNo', 'truck no': 'vehicleNo',
  'own/market': 'fleetType', fleet: 'fleetType', 'fleet type': 'fleetType',
  product: 'product', material: 'product', consignor: 'consignor', consignee: 'consignee', from: 'fromPlace', to: 'toPlace',
  'charged weight': 'chargedWeight', weight: 'chargedWeight', qty: 'qty', quantity: 'qty',
  'invoice no': 'invoiceNo', 'invoice no.': 'invoiceNo', 'eway no': 'ewayBillNo', 'e-way bill no': 'ewayBillNo', 'eway bill no': 'ewayBillNo', 'eway expiry': 'ewayExpiry',
  'delivery no': 'deliveryNo', 'delivery no.': 'deliveryNo', "driver's contact no": 'driverContact', 'driver contact': 'driverContact', driver: 'driverName', 'driver name': 'driverName',
  'vehicle owner name': 'ownerName', 'vehicle owner pan': 'ownerPan', 'broker name': 'brokerName', 'broker pan': 'brokerPan',
  'freight type': 'freightType', rate: 'rate', advance: 'advance', remarks: 'remarks', status: 'status',
};
const NUMERIC = new Set(['chargedWeight', 'qty', 'rate', 'advance']);

export function rowsFromSheet(text: string): { rows: Record<string, unknown>[]; unmapped: string[] } {
  const [header = [], ...data] = parseCsv(text);
  // match headers ignoring case, dots and extra spaces ("EWAY No." = "eway no")
  const norm = (h: string) => h.trim().toLowerCase().replace(/[.:]/g, '').replace(/\s+/g, ' ');
  const keys = header.map((h) => HEADER_MAP[norm(h)] ?? null);
  const unmapped = header.filter((_, i) => !keys[i]).map((h) => h.trim()).filter(Boolean);
  const rows = data.map((cells) => {
    const row: Record<string, unknown> = { extra: {} };
    cells.forEach((cell, i) => {
      const v = cell.trim();
      if (!v) return;
      const key = keys[i];
      if (!key) (row.extra as Record<string, string>)[header[i].trim()] = v;
      else if (key === 'fleetType') row.fleetType = /market|mkt/i.test(v) ? 'market' : 'own';
      else if (NUMERIC.has(key)) row[key] = Number(v.replace(/,/g, ''));
      else if (key === 'loadingDate' || key === 'ewayExpiry') row[key] = dayjs(v, ['DD-MM-YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD']).isValid() ? dayjs(v).toISOString() : v;
      else row[key] = v;
    });
    return row;
  });
  return { rows, unmapped };
}

export function LoadingSheetPage() {
  const qc = useQueryClient();
  const n = useNames();
  const access = useAccess();
  const lrs = useQuery({ queryKey: ['lrs'], queryFn: () => http<Lr[]>('/erp/ops/lrs?limit=5000') });
  const plants = useQuery({ queryKey: ['options', 'plant-options'], queryFn: plantOptions });
  const [plant, setPlant] = useState('');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [upload, setUpload] = useState<{ rows: Record<string, unknown>[]; unmapped: string[] } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const create = useMutation({
    mutationFn: (v: Record<string, unknown>) => http('/erp/ops/lrs', { method: 'POST', body: JSON.stringify(v) }),
    onSuccess: () => setAdding(false),
    onSettled: () => qc.invalidateQueries({ queryKey: ['lrs'] }),
  });
  const bulk = useMutation({
    mutationFn: (rows: Record<string, unknown>[]) => http<{ created: number; errors: { row: number; error: string }[] }>('/erp/ops/lrs/bulk', { method: 'POST', body: JSON.stringify({ rows: rows.map((r) => ({ ...r, plantId: r.plantId ?? (plant ? Number(plant) : undefined) })) }) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['lrs'] }),
  });

  const all = lrs.data ?? [];
  const extraKeys = useMemo(() => [...new Set(all.flatMap((r) => Object.keys(r.extra ?? {})))].sort(), [all]);
  const q = search.trim().toLowerCase();
  const rows = all.filter((r) => (!plant || String(r.plantId) === plant) && (!q || JSON.stringify(r).toLowerCase().includes(q)));
  const own = rows.filter((r) => r.fleetType === 'own');
  const columns: [string, (r: Lr) => string | number | null][] = [
    ['LR No.', (r) => r.lrNo], ['Plant', (r) => (r.plantId ? (plants.data?.find((p) => p.value === r.plantId)?.label ?? '') : '')], ['Loading dt', (r) => (r.loadingDate ? dayjs(r.loadingDate).format('DD-MM-YYYY') : '')],
    ['Product', (r) => r.product], ['From', (r) => r.fromPlace], ['To', (r) => r.toPlace], ['Consignor', (r) => r.consignor], ['Consignee', (r) => r.consignee],
    ['Vehicle no', (r) => r.vehicleNo], ['Own/Market', (r) => r.fleetType], ['Charged weight', (r) => r.chargedWeight], ['Qty', (r) => r.qty],
    ['Invoice no', (r) => r.invoiceNo], ['E-Way no', (r) => r.ewayBillNo], ['E-Way expiry', (r) => (r.ewayExpiry ? dayjs(r.ewayExpiry).format('DD-MM-YYYY') : '')],
    ['Delivery no', (r) => r.deliveryNo], ['Driver', (r) => r.driverName], ["Driver's contact", (r) => r.driverContact], ['Owner', (r) => r.ownerName], ['Owner PAN', (r) => r.ownerPan],
    ['Broker', (r) => r.brokerName], ['Broker PAN', (r) => r.brokerPan], ['Freight type', (r) => r.freightType], ['Rate', (r) => r.rate], ['Advance', (r) => r.advance], ['Status', (r) => r.status], ['Remarks', (r) => r.remarks],
    ...extraKeys.map((k) => [k, (r: Lr) => r.extra?.[k] ?? ''] as [string, (r: Lr) => string]),
  ];

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
        <Box>
          <Typography variant="h5">Loading Sheet</Typography>
          <Typography color="text.secondary">Every LR row in one spreadsheet. Upload your plant&apos;s sheet as CSV; unknown columns are kept as extra columns.</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          {access.can('lr', 'create') && (
            <>
              <Button variant="outlined" startIcon={<FileUploadOutlined />} onClick={() => file.current?.click()}>Upload / verify</Button>
              <Button variant="contained" onClick={() => { create.reset(); setAdding(true); }}>New LR entry</Button>
            </>
          )}
          <Button variant="outlined" startIcon={<FileDownloadOutlined />} disabled={!rows.length} onClick={() => downloadCsv('loading-sheet.csv', [columns.map((c) => c[0]), ...rows.map((r) => columns.map((c) => c[1](r)))])}>Excel</Button>
          <input ref={file} hidden type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { bulk.reset(); setUpload(rowsFromSheet(await f.text())); } e.target.value = ''; }} />
        </Stack>
      </Stack>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
        <TextField select size="small" label="Plant" value={plant} onChange={(e) => setPlant(e.target.value)} sx={{ minWidth: 220 }}>
          <MenuItem value="">All plants</MenuItem>
          {plants.data?.map((p) => <MenuItem key={p.value} value={String(p.value)}>{p.label}</MenuItem>)}
        </TextField>
        <TextField size="small" label="Search all columns" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ flexGrow: 1 }} />
      </Stack>
      <Grid container spacing={2}>
        {([
          ['Total LRs', num(rows.length)],
          ['Vehicles', num(new Set(rows.map((r) => r.vehicleNo)).size)],
          ['Total weight', `${num(rows.reduce((s, r) => s + (r.chargedWeight ?? 0), 0))} MT`],
          ['Own fleet', `${own.length} trips · ${rows.length ? Math.round((own.length / rows.length) * 100) : 0}%`],
          ['Market fleet', `${rows.length - own.length} trips`],
        ] as [string, string][]).map(([k, v]) => (
          <Grid key={k} size={{ xs: 6, md: 2.4 }}><Card><CardContent><Typography variant="body2" color="text.secondary">{k}</Typography><Typography variant="h6">{v}</Typography></CardContent></Card></Grid>
        ))}
      </Grid>
      <Card>
        <TableContainer sx={{ maxHeight: 'calc(100vh - 380px)', minHeight: 200 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>#</TableCell>
                {columns.map(([h]) => <TableCell key={h} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 && <TableRow><TableCell colSpan={columns.length + 1}><Typography color="text.secondary" sx={{ py: 2 }}>No rows. Upload a loading sheet or add an LR.</Typography></TableCell></TableRow>}
              {rows.map((r, i) => (
                <TableRow key={r.id} hover>
                  <TableCell>{i + 1}</TableCell>
                  {columns.map(([h, get]) => <TableCell key={h} sx={{ whiteSpace: 'nowrap' }}>{get(r) ?? ''}</TableCell>)}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
      <Typography variant="caption" color="text.secondary">Plant names come from {n.ready ? 'Plants & Stores' : 'master data'}.</Typography>

      {adding && <EntityForm title="New LR entry" fields={lrFields} initial={{ fleetType: 'own', status: 'generated', plantId: plant ? Number(plant) : undefined, extra: {} }} isNew onCancel={() => setAdding(false)} onSubmit={(v) => create.mutate(v)} busy={create.isPending} error={create.isError ? errorMessage(create.error) : null} />}

      <Dialog open={Boolean(upload)} onClose={() => setUpload(null)} maxWidth="md" fullWidth>
        <DialogTitle>Upload loading sheet</DialogTitle>
        <DialogContent dividers>
          <Typography gutterBottom>{upload?.rows.length ?? 0} rows read{plant ? ' for the selected plant' : ''}.</Typography>
          {upload && upload.unmapped.length > 0 && <Alert severity="info" sx={{ mb: 1 }}>Kept as extra columns: {upload.unmapped.join(', ')}</Alert>}
          {bulk.isError && <Alert severity="error">{errorMessage(bulk.error)}</Alert>}
          {bulk.data && (
            <>
              <Alert severity={bulk.data.errors.length ? 'warning' : 'success'} sx={{ mb: 1 }}>{bulk.data.created} LRs created{bulk.data.errors.length ? `, ${bulk.data.errors.length} rows need fixing` : ''}.</Alert>
              <List dense>{bulk.data.errors.slice(0, 50).map((e) => <ListItem key={e.row} disableGutters><ListItemText primary={`Row ${e.row}: ${e.error}`} /></ListItem>)}</List>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUpload(null)}>{bulk.data ? 'Close' : 'Cancel'}</Button>
          {!bulk.data && <Button variant="contained" disabled={!upload?.rows.length || bulk.isPending} onClick={() => upload && bulk.mutate(upload.rows)}>Create {upload?.rows.length ?? 0} LRs</Button>}
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

/* -------------------------------------------------------- freight memos */

interface Memo {
  id: number;
  memoNo: string;
  memoDate: string;
  vehicleNo: string;
  driverName: string | null;
  brokerId: number;
  origin: string | null;
  destination: string | null;
  material: string | null;
  weightMt: number | null;
  rateBasis: string;
  rate: number;
  totalFreight: number;
  advance: number;
  commission: number;
  tds: number;
  balance: number;
  lrNos: string[];
  status: string;
}

export function FreightMemosPage() {
  const n = useNames();
  const config: EntityConfig<Memo> = {
    title: 'Freight Memos',
    singular: 'freight memo',
    subtitle: 'Hire contracts with market vehicles and brokers over the attached LRs.',
    endpoint: '/erp/ops/freight-memos',
    queryKey: 'freight-memos',
    docType: 'freight_memo',
    defaults: { rateBasis: 'per_mt', status: 'issued', advance: 0, commission: 0, tds: 0, lrNos: [] },
    searchText: (m) => `${m.memoNo} ${m.vehicleNo} ${n.party(m.brokerId)} ${m.origin ?? ''} ${m.destination ?? ''} ${m.lrNos.join(' ')}`,
    canEditRow: (m) => m.status !== 'settled',
    columns: [
      { label: 'Memo', render: (m) => <Box><b>{m.memoNo}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{date(m.memoDate)}</Typography></Box>, csv: (m) => m.memoNo },
      { label: 'Vehicle', render: (m) => <Box>{m.vehicleNo}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{m.driverName ?? ''}</Typography></Box>, csv: (m) => m.vehicleNo },
      { label: 'Broker', render: (m) => n.party(m.brokerId) },
      { label: 'Route', render: (m) => `${m.origin ?? '—'} → ${m.destination ?? '—'}` },
      { label: 'Freight', render: (m) => <Box><b>{inr(m.totalFreight)}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{m.rateBasis === 'per_mt' ? `${inr(m.rate)} / MT × ${num(m.weightMt)}` : 'Lump sum'}</Typography></Box>, csv: (m) => m.totalFreight },
      { label: 'Advance', render: (m) => inr(m.advance) },
      { label: 'Commission / TDS', render: (m) => `${inr(m.commission)} / ${inr(m.tds)}` },
      { label: 'Balance due', render: (m) => <b>{inr(m.balance)}</b>, csv: (m) => m.balance },
      { label: 'LRs', render: (m) => m.lrNos.join(', ') || '—' },
      { label: 'Status', render: (m) => <StatusChip status={m.status} />, csv: (m) => m.status },
    ],
    fields: [
      { section: 'Vehicle & broker', path: 'vehicleNo', label: 'Vehicle no.', required: true },
      { section: 'Vehicle & broker', path: 'brokerId', label: 'Broker / market vendor', type: 'autocomplete', required: true, options: partyOptions('broker'), optionsKey: 'broker-options' },
      { section: 'Vehicle & broker', path: 'driverName', label: 'Driver name' },
      { section: 'Vehicle & broker', path: 'driverPhone', label: 'Driver phone' },
      { section: 'Route & load', path: 'origin', label: 'Origin (loading point)' },
      { section: 'Route & load', path: 'destination', label: 'Destination (unloading point)' },
      { section: 'Route & load', path: 'material', label: 'Material' },
      { section: 'Route & load', path: 'weightMt', label: 'Weight (MT)', type: 'number' },
      { section: 'Money', path: 'rateBasis', label: 'Rate basis', type: 'select', options: opts([['per_mt', 'Per MT'], ['fixed', 'Fixed lump sum']]) },
      { section: 'Money', path: 'rate', label: 'Rate (₹)', type: 'number', visible: (v) => v.rateBasis === 'per_mt' },
      { section: 'Money', path: 'totalFreight', label: 'Total freight (₹)', type: 'number', visible: (v) => v.rateBasis === 'fixed' },
      { section: 'Money', path: 'advance', label: 'Advance paid (₹)', type: 'number' },
      { section: 'Money', path: 'advanceMode', label: 'Advance mode', type: 'select', options: opts([['Bank transfer', 'Bank transfer'], ['Cash', 'Cash'], ['UPI', 'UPI'], ['Fuel card', 'Fuel card']]) },
      { section: 'Money', path: 'commission', label: 'Commission / brokerage (₹)', type: 'number' },
      { section: 'Money', path: 'tds', label: 'TDS (₹)', type: 'number' },
      { section: 'Other', path: 'lrNos', label: 'Attached LRs', type: 'list' },
      { section: 'Other', path: 'status', label: 'Status', type: 'select', options: opts([['issued', 'Issued'], ['loaded', 'Loaded'], ['in_transit', 'In transit'], ['settled', 'Settled']]) },
      { section: 'Other', path: 'remarks', label: 'Remarks / contract terms', type: 'textarea' },
    ],
  };
  return <EntityPage config={config} />;
}

/* ------------------------------------------------------ incoming vehicles */

interface Incoming {
  id: number;
  vehicleNo: string;
  plantId: number;
  vendorName: string | null;
  doNo: string | null;
  driverName: string | null;
  driverPhone: string | null;
  material: string | null;
  weightMt: number | null;
  sentAt: string;
  status: string;
}

export function IncomingVehiclesPage() {
  const access = useAccess();
  const plants = useQuery({ queryKey: ['options', 'plant-options'], queryFn: plantOptions });
  const plantName = (id: number) => plants.data?.find((p) => p.value === id)?.label ?? `#${id}`;
  const config: EntityConfig<Incoming> = {
    title: 'Incoming Vehicles',
    singular: 'incoming vehicle',
    subtitle: 'Vehicles sent to your plants, oldest first.',
    endpoint: '/erp/ops/incoming',
    queryKey: 'incoming',
    docType: 'incoming_vehicle',
    defaults: { status: 'in_transit' },
    searchText: (v) => `${v.vehicleNo} ${v.vendorName ?? ''} ${v.doNo ?? ''} ${v.driverName ?? ''} ${v.material ?? ''}`,
    canEditRow: (v) => v.status !== 'received',
    columns: [
      { label: 'Vehicle', render: (v) => <b>{v.vehicleNo}</b>, csv: (v) => v.vehicleNo },
      { label: 'Destination plant', render: (v) => plantName(v.plantId) },
      { label: 'Vendor / shipper', render: (v) => v.vendorName ?? '—' },
      { label: 'Driver', render: (v) => <Box>{v.driverName ?? '—'}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{v.driverPhone ?? ''}</Typography></Box>, csv: (v) => v.driverName },
      { label: 'DO / LR', render: (v) => v.doNo ?? '—' },
      { label: 'Commodity', render: (v) => `${v.material ?? '—'}${v.weightMt ? ` · ${num(v.weightMt)} MT` : ''}` },
      { label: 'Sent', render: (v) => <Box>{dayjs(v.sentAt).format('D MMM, HH:mm')}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{dayjs(v.sentAt).fromNow()}</Typography></Box>, csv: (v) => v.sentAt },
      { label: 'Status', render: (v) => <StatusChip status={v.status} />, csv: (v) => v.status },
    ],
    fields: [
      { path: 'vehicleNo', label: 'Vehicle no.', required: true },
      { path: 'plantId', label: 'Destination plant', type: 'select', required: true, options: plantOptions, optionsKey: 'plant-options' },
      { path: 'vendorName', label: 'Vendor / supplier' },
      { path: 'doNo', label: 'DO / LR number' },
      { path: 'driverName', label: 'Driver name' },
      { path: 'driverPhone', label: 'Driver phone' },
      { path: 'material', label: 'Material / commodity' },
      { path: 'weightMt', label: 'Weight (MT)', type: 'number' },
      { path: 'sentAt', label: 'Sent at', type: 'datetime' },
      { path: 'status', label: 'Status', type: 'select', options: opts([['in_transit', 'In transit'], ['approaching', 'Approaching'], ['at_gate', 'At gate'], ['arrived', 'Arrived']]) },
    ],
    rowActions: (v, run) =>
      v.status !== 'received' && access.can('incoming_vehicle', 'edit') ? (
        <Button size="small" variant="contained" onClick={() => run(() => post(`/erp/ops/incoming/${v.id}/receive`))}>Receive</Button>
      ) : null,
  };
  return <EntityPage config={config} />;
}

/* ------------------------------------------------------ material received */

interface MaterialReturn {
  id: number;
  returnNo: string;
  storeId: number;
  returnDate: string;
  vehicleNo: string;
  lrNo: string | null;
  indentNo: string | null;
  condition: string;
  lines: { itemId: number; qty: number; serials: string[] }[];
  notes: string | null;
}

const returnFields: Field[] = [
  { section: 'Return', path: 'storeId', label: 'Into store', type: 'select', required: true, options: storeOptions, optionsKey: 'store-options' },
  { section: 'Return', path: 'returnDate', label: 'Date', type: 'date' },
  { section: 'Return', path: 'vehicleNo', label: 'Vehicle no.', required: true },
  { section: 'Return', path: 'lrNo', label: 'LR no.' },
  { section: 'Return', path: 'indentNo', label: 'Indent no.' },
  { section: 'Return', path: 'condition', label: 'Condition', type: 'select', options: opts([['good', 'Good, back to stock'], ['damaged', 'Damaged (serial pieces marked damaged)']]) },
  {
    section: 'Return',
    path: 'lines',
    label: 'What came back (include the GPS tracker if it was returned)',
    type: 'lines',
    newLine: { qty: 1 },
    lineFields: [
      { path: 'itemId', label: 'Item', type: 'autocomplete', required: true, options: itemOptions, optionsKey: 'item-options', fullWidth: true },
      { path: 'qty', label: 'Qty', type: 'number', required: true },
      { path: 'serials', label: 'Serials / IMEI', type: 'list' },
    ],
  },
  { section: 'Return', path: 'notes', label: 'Notes / reason', type: 'textarea' },
];

export function MaterialReceivedPage() {
  const qc = useQueryClient();
  const n = useNames();
  const access = useAccess();
  const [key, setKey] = useState(0);
  const save = useMutation({
    mutationFn: (v: Record<string, unknown>) => http<MaterialReturn>('/erp/ops/returns/receive', { method: 'POST', body: JSON.stringify(v) }),
    onSuccess: () => setKey((k) => k + 1),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['material-returns'] });
      void qc.invalidateQueries({ queryKey: ['stock'] });
    },
  });
  const history: EntityConfig<MaterialReturn> = {
    title: 'Received history',
    singular: 'return',
    endpoint: '/erp/ops/returns',
    queryKey: 'material-returns',
    docType: 'material_return',
    readOnly: true,
    searchText: (r) => `${r.returnNo} ${r.vehicleNo} ${r.lrNo ?? ''} ${r.indentNo ?? ''}`,
    columns: [
      { label: 'Return', render: (r) => r.returnNo },
      { label: 'Date', render: (r) => date(r.returnDate) },
      { label: 'Vehicle', render: (r) => r.vehicleNo },
      { label: 'Store', render: (r) => n.store(r.storeId) },
      { label: 'Items', render: (r) => r.lines.map((l) => `${num(l.qty)} × ${n.item(l.itemId)}${l.serials.length ? ` (${l.serials.join(', ')})` : ''}`).join('; ') },
      { label: 'Condition', render: (r) => <StatusChip status={r.condition === 'good' ? 'in_stock' : 'damaged'} />, csv: (r) => r.condition },
      { label: 'LR / indent', render: (r) => [r.lrNo, r.indentNo].filter(Boolean).join(' · ') || '—' },
    ],
    fields: [],
  };
  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5">Material Received</Typography>
        <Typography color="text.secondary">Material and GPS trackers coming back from vehicles go straight into the chosen store.</Typography>
      </Box>
      {save.data && <Alert severity="success">Received {save.data.returnNo} into {n.store(save.data.storeId)}.</Alert>}
      {access.can('material_return', 'create') && (
        <RecordForm key={key} fields={returnFields} initial={{ condition: 'good', lines: [] }} onSubmit={(v) => save.mutate(v)} busy={save.isPending} error={save.isError ? errorMessage(save.error) : null} submitLabel="Save received movement" />
      )}
      <EntityPage config={history} />
    </Stack>
  );
}
