import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import { Alert, Box, Button, Card, CardContent, Chip, Grid, List, ListItem, ListItemIcon, ListItemText, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { http } from '../../api/http';
import { traccar } from '../../api/traccar';
import { EntityPage, type EntityConfig, errorMessage } from '../../components/EntityPage';
import { useFormDialog } from '../../components/useFormDialog';
import { useAccess } from '../../lib/access';
import { inr, num } from '../inventory/shared';
import { vehicleOptions } from '../workshop/workshop';

const post = (url: string, body?: unknown) => http(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

interface Plan { name: string; pricePerYear: number; features: string[] }
interface Summary {
  subscribed: number;
  active: number;
  expiring30: number;
  expired: number;
  sims: number;
  byPlan: { plan: string; name: string; count: number }[];
  unpaidInvoices: number;
  unpaidAmount: number;
  annualValue: number;
  plans: Record<string, Plan>;
  gstRate: number;
}
interface License { id: number; licNo: string; vehicleNo: string; deviceId: number | null; imei: string; simOperator: string | null; simNo: string | null; plan: string; activatedOn: string; expiresOn: string; status: string }
interface SubInvoice { id: number; sinvNo: string; invoiceDate: string; description: string; lines: { licNo: string; vehicleNo: string; plan: string; months: number; amount: number; from: string; to: string }[]; net: number; gst: number; total: number; paymentMethod: string | null; paymentRef: string | null; status: string }

const daysLeft = (d: string) => dayjs(d).startOf('day').diff(dayjs().startOf('day'), 'day');
const stateOf = (l: License) => (l.status !== 'active' ? l.status : daysLeft(l.expiresOn) < 0 ? 'expired' : daysLeft(l.expiresOn) <= 30 ? 'expiring' : 'active');
const STATE_CHIP: Record<string, { label: string; color: 'success' | 'warning' | 'error' | 'default' }> = {
  active: { label: 'Active', color: 'success' },
  expiring: { label: 'Expiring soon', color: 'warning' },
  expired: { label: 'Expired', color: 'error' },
  suspended: { label: 'Suspended', color: 'default' },
  cancelled: { label: 'Cancelled', color: 'default' },
};
const MONTHS = [1, 3, 6, 12, 24, 36].map((m) => ({ value: m, label: `${m} month${m > 1 ? 's' : ''}` }));

/** Opens a printable GST invoice in a new window. */
function printInvoice(inv: SubInvoice, gstRate: number) {
  const w = window.open('', '_blank', 'width=800,height=900');
  if (!w) return;
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  w.document.write(`<!doctype html><html><head><title>${esc(inv.sinvNo)}</title><style>body{font-family:system-ui,sans-serif;margin:32px;color:#222}table{width:100%;border-collapse:collapse;margin-top:16px}td,th{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left}td.r,th.r{text-align:right}h1{margin:0}.muted{color:#666}</style></head><body>
<h1>Tax invoice</h1><p class="muted">${esc(inv.sinvNo)} · ${esc(dayjs(inv.invoiceDate).format('D MMM YYYY'))}</p><p>${esc(inv.description)}</p>
<table><thead><tr><th>Licence</th><th>Vehicle</th><th>Plan</th><th>Period</th><th class="r">Amount</th></tr></thead><tbody>
${inv.lines.map((l) => `<tr><td>${esc(l.licNo)}</td><td>${esc(l.vehicleNo)}</td><td>${esc(l.plan)}</td><td>${esc(l.from)} to ${esc(l.to)} (${l.months} mo)</td><td class="r">${esc(inr(l.amount))}</td></tr>`).join('')}
<tr><td colspan="4" class="r">Net</td><td class="r">${esc(inr(inv.net))}</td></tr><tr><td colspan="4" class="r">GST @ ${gstRate}%</td><td class="r">${esc(inr(inv.gst))}</td></tr><tr><th colspan="4" class="r">Total</th><th class="r">${esc(inr(inv.total))}</th></tr></tbody></table>
<p class="muted">${inv.status === 'paid' ? `Paid by ${esc(inv.paymentMethod)} ${esc(inv.paymentRef ?? '')}` : 'Unpaid'}</p><script>window.print()</script></body></html>`);
  w.document.close();
}

export function SubscriptionsPage() {
  const qc = useQueryClient();
  const access = useAccess();
  const [tab, setTab] = useState(0);
  const [dialog, ask] = useFormDialog();
  const s = useQuery({ queryKey: ['subscriptions-summary'], queryFn: () => http<Summary>('/erp/subscriptions/summary') }).data;
  const invoices = useQuery({ queryKey: ['subscription-invoices'], queryFn: () => http<SubInvoice[]>('/erp/subscriptions/invoices') });
  const refresh = () => qc.invalidateQueries({ predicate: (q) => /^subscription|^licenses/.test(String(q.queryKey[0])) });
  const act = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSettled: refresh });
  const plans = Object.entries(s?.plans ?? {});
  const edit = access.can('subscription', 'edit');

  const renew = async (ids: number[], title: string) => {
    const v = await ask({ title, initial: { months: 12 }, fields: [{ path: 'months', label: 'Extend by', type: 'select', required: true, options: MONTHS }] });
    if (v) act.mutate(async () => post('/erp/subscriptions/renew', { licenseIds: ids, months: Number(v.months) }));
  };

  const config: EntityConfig<License> = {
    title: 'Device licences',
    singular: 'licence',
    subtitle: 'One licence per tracker. Renewals are billed with GST.',
    endpoint: '/erp/subscriptions/licenses',
    queryKey: 'licenses',
    docType: 'subscription',
    defaults: { plan: 'standard', status: 'active' },
    searchText: (l) => `${l.licNo} ${l.vehicleNo} ${l.imei} ${l.simNo ?? ''}`,
    columns: [
      { label: 'Vehicle & licence', render: (l) => <Box><b>{l.vehicleNo}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{l.licNo}</Typography></Box>, csv: (l) => `${l.vehicleNo} ${l.licNo}` },
      { label: 'IMEI & SIM', render: (l) => <Box>{l.imei}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{[l.simOperator, l.simNo].filter(Boolean).join(' · ') || 'no SIM on file'}</Typography></Box>, csv: (l) => l.imei },
      { label: 'Plan', render: (l) => s?.plans[l.plan]?.name ?? l.plan, csv: (l) => l.plan },
      { label: 'Expiry', render: (l) => <Box>{dayjs(l.expiresOn).format('D MMM YYYY')}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>activated {dayjs(l.activatedOn).format('D MMM YYYY')}</Typography></Box>, csv: (l) => l.expiresOn },
      { label: 'Days left', render: (l) => { const d = daysLeft(l.expiresOn); return <Typography sx={{ color: d < 0 ? 'error.main' : d <= 30 ? 'warning.main' : undefined }}>{d < 0 ? `${-d} days ago` : d}</Typography>; }, csv: (l) => daysLeft(l.expiresOn) },
      { label: 'Status', render: (l) => <Chip size="small" {...STATE_CHIP[stateOf(l)]} />, csv: (l) => stateOf(l) },
    ],
    fields: [
      { path: 'vehicleNo', label: 'Vehicle registration', type: 'autocomplete', required: true, options: vehicleOptions, optionsKey: 'vehicle-name-options' },
      { path: 'imei', label: 'IMEI (15 digits)', required: true },
      { path: 'plan', label: 'Plan', type: 'select', required: true, options: plans.map(([value, p]) => ({ value, label: `${p.name} · ${inr(p.pricePerYear)}/year` })) },
      { path: 'simOperator', label: 'M2M operator', type: 'select', options: ['Airtel', 'Jio', 'Vi', 'BSNL', 'Other'].map((o) => ({ value: o, label: o })) },
      { path: 'simNo', label: 'SIM number' },
      { path: 'activatedOn', label: 'Activated on', type: 'day', helper: 'Default: today' },
      { path: 'expiresOn', label: 'Expires on', type: 'day', helper: 'Default: one year after activation' },
      { path: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }, { value: 'cancelled', label: 'Cancelled' }] },
    ],
    // link the Traccar device when the IMEI matches one
    afterSave: async (saved) => {
      if (saved.deviceId) return;
      const dev = (await traccar.devices()).find((d) => d.uniqueId === saved.imei);
      if (dev) await http(`/erp/subscriptions/licenses/${saved.id}`, { method: 'PUT', body: JSON.stringify({ deviceId: dev.id }) });
    },
    rowActions: (l) => edit && l.status !== 'cancelled' && <Button size="small" onClick={() => renew([l.id], `Renew ${l.vehicleNo} (${l.licNo})`)}>Renew</Button>,
  };

  const licences = useQuery({ queryKey: ['licenses', 'all'], queryFn: () => http<License[]>('/erp/subscriptions/licenses') });
  const due = (licences.data ?? []).filter((l) => ['expiring', 'expired'].includes(stateOf(l)));

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
        <Box>
          <Typography variant="h5">Subscriptions & Licences</Typography>
          <Typography color="text.secondary">Tracker licences, SIMs, plans and GST invoices.</Typography>
        </Box>
        {access.can('subscription', 'create') && (
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" onClick={async () => { const v = await ask({ title: 'Add a licence for every tracker that has none', initial: { plan: 'standard' }, fields: [{ path: 'plan', label: 'Plan', type: 'select', required: true, options: plans.map(([value, p]) => ({ value, label: p.name })) }] }); if (v) act.mutate(() => post('/erp/subscriptions/import-devices', v)); }}>Import trackers</Button>
            {edit && due.length > 0 && <Button variant="contained" color="warning" onClick={() => renew(due.map((l) => l.id), `Renew ${due.length} expiring or expired licences`)}>Renew {due.length} due</Button>}
          </Stack>
        )}
      </Stack>
      {act.isError && <Alert severity="error" onClose={() => act.reset()}>{errorMessage(act.error)}</Alert>}
      {act.isSuccess && act.data !== undefined && (
        <Alert severity="success" onClose={() => act.reset()}>
          {'sinvNo' in (act.data as object) ? `Renewed. Invoice ${(act.data as SubInvoice).sinvNo} for ${inr((act.data as SubInvoice).total)} is in GST invoices.` : 'created' in (act.data as object) ? `Added ${(act.data as { created: number }).created} licences.${(act.data as { skipped: unknown[] }).skipped.length ? ` Skipped ${(act.data as { skipped: unknown[] }).skipped.length} trackers without a 15-digit IMEI.` : ''}` : 'Done.'}
        </Alert>
      )}
      <Grid container spacing={2}>
        {[
          ['Subscribed trackers', num(s?.subscribed), `${s?.active ?? 0} active · ${inr(s?.annualValue)}/year`],
          ['Expiring in 30 days', num(s?.expiring30), `${s?.expired ?? 0} expired`],
          ['M2M SIMs', num(s?.sims), 'on file'],
          ['Billing', s?.unpaidInvoices ? `${s.unpaidInvoices} unpaid` : 'All paid', s?.unpaidInvoices ? inr(s.unpaidAmount) : ''],
        ].map(([k, v, sub]) => (
          <Grid key={k} size={{ xs: 6, md: 3 }}>
            <Card sx={{ height: '100%' }}><CardContent><Typography variant="body2" color="text.secondary">{k}</Typography><Typography variant="h6">{v}</Typography><Typography variant="caption" color="text.secondary">{sub}</Typography></CardContent></Card>
          </Grid>
        ))}
      </Grid>
      <Tabs value={tab} onChange={(_, v) => setTab(v)}>
        <Tab label="Device licences" />
        <Tab label="Plans & pricing" />
        <Tab label={`GST invoices${s?.unpaidInvoices ? ` (${s.unpaidInvoices} unpaid)` : ''}`} />
      </Tabs>
      {tab === 0 && <EntityPage config={config} />}
      {tab === 1 && (
        <Grid container spacing={2}>
          {plans.map(([key, p]) => (
            <Grid key={key} size={{ xs: 12, md: 4 }}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Typography variant="h6">{p.name}</Typography>
                  <Typography variant="h4" sx={{ my: 1 }}>{inr(p.pricePerYear)}<Typography component="span" color="text.secondary"> / tracker / year + {s?.gstRate}% GST</Typography></Typography>
                  <Chip size="small" label={`${s?.byPlan.find((b) => b.plan === key)?.count ?? 0} trackers on this plan`} />
                  <List dense>
                    {p.features.map((f) => (
                      <ListItem key={f} disableGutters>
                        <ListItemIcon sx={{ minWidth: 30 }}><CheckCircleOutlined color="success" fontSize="small" /></ListItemIcon>
                        <ListItemText primary={f} />
                      </ListItem>
                    ))}
                  </List>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
      {tab === 2 && (
        <Card>
          <TableContainer>
            <Table size="small">
              <TableHead><TableRow>{['Invoice', 'Date', 'Description', 'Net', `GST ${s?.gstRate ?? 18}%`, 'Total', 'Payment', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
              <TableBody>
                {invoices.data?.length === 0 && <TableRow><TableCell colSpan={8}><Typography color="text.secondary" sx={{ py: 2 }}>No invoices yet. Renewing licences creates one.</Typography></TableCell></TableRow>}
                {invoices.data?.map((i) => (
                  <TableRow key={i.id} hover>
                    <TableCell><b>{i.sinvNo}</b></TableCell>
                    <TableCell>{dayjs(i.invoiceDate).format('D MMM YYYY')}</TableCell>
                    <TableCell>{i.description}</TableCell>
                    <TableCell>{inr(i.net)}</TableCell>
                    <TableCell>{inr(i.gst)}</TableCell>
                    <TableCell><b>{inr(i.total)}</b></TableCell>
                    <TableCell>{i.status === 'paid' ? <Chip size="small" color="success" label={`${i.paymentMethod?.toUpperCase()} ${i.paymentRef ?? ''}`} /> : <Chip size="small" color="warning" label="Unpaid" />}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <Button size="small" onClick={() => printInvoice(i, s?.gstRate ?? 18)}>Print</Button>
                      {edit && i.status !== 'paid' && (
                        <Button
                          size="small"
                          variant="contained"
                          onClick={async () => {
                            const v = await ask({ title: `Record payment of ${inr(i.total)}`, initial: { paymentMethod: 'upi' }, fields: [{ path: 'paymentMethod', label: 'Method', type: 'select', required: true, options: ['upi', 'card', 'netbanking', 'neft', 'cheque'].map((m) => ({ value: m, label: m.toUpperCase() })) }, { path: 'paymentRef', label: 'Reference' }] });
                            if (v) act.mutate(() => post(`/erp/subscriptions/invoices/${i.id}/pay`, v));
                          }}
                        >
                          Pay
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}
      {dialog}
    </Stack>
  );
}
