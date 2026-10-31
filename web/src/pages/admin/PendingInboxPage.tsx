import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, Switch, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { type ApprovalRequest, type ApprovalRule, erpAdmin, ROLE_LABEL } from '../../api/erp-admin';
import { useAuth } from '../../auth/AuthProvider';
import { errorMessage } from '../../components/EntityPage';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

function RulesTab() {
  const qc = useQueryClient();
  const meta = useQuery({ queryKey: ['erp-meta'], queryFn: erpAdmin.meta });
  const rules = useQuery({ queryKey: ['approval-rules'], queryFn: erpAdmin.rules });
  const save = useMutation({ mutationFn: erpAdmin.setRule, onSettled: () => qc.invalidateQueries({ queryKey: ['approval-rules'] }) });
  const [drafts, setDrafts] = useState<Record<string, ApprovalRule>>({});
  const types = Object.entries(meta.data?.docTypes ?? {});
  const ruleFor = (docType: string): ApprovalRule =>
    drafts[docType] ?? rules.data?.find((r) => r.docType === docType) ?? { docType, enabled: false, minAmount: 0, approverRole: 'admin' };
  const set = (r: ApprovalRule) => setDrafts((d) => ({ ...d, [r.docType]: r }));

  return (
    <Card>
      <CardContent>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          A document needs approval when its rule is on and its amount is at least the threshold (0 = always). Anyone whose role may approve that document type sees it in their inbox.
        </Typography>
        {save.isError && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage(save.error)}</Alert>}
        <Table size="small">
          <TableHead>
            <TableRow>
              {['Document', 'Needs approval', 'From amount (₹)', 'Routed to', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}
            </TableRow>
          </TableHead>
          <TableBody>
            {types.map(([key, info]) => {
              const r = ruleFor(key);
              const dirty = Boolean(drafts[key]);
              return (
                <TableRow key={key}>
                  <TableCell>{info.label}</TableCell>
                  <TableCell><Switch checked={r.enabled} onChange={(e) => set({ ...r, enabled: e.target.checked })} /></TableCell>
                  <TableCell>
                    <TextField size="small" type="number" value={r.minAmount} onChange={(e) => set({ ...r, minAmount: Number(e.target.value) })} sx={{ width: 140 }} disabled={!r.enabled} />
                  </TableCell>
                  <TableCell>
                    <TextField select size="small" value={r.approverRole} onChange={(e) => set({ ...r, approverRole: e.target.value })} sx={{ minWidth: 200 }} disabled={!r.enabled}>
                      {Object.entries(ROLE_LABEL).map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
                    </TextField>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      variant="contained"
                      disabled={!dirty || save.isPending}
                      onClick={() => save.mutate(r, { onSuccess: () => setDrafts(({ [key]: _done, ...rest }) => rest) })}
                    >
                      Save
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function PendingInboxPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const meta = useQuery({ queryKey: ['erp-meta'], queryFn: erpAdmin.meta });
  const [view, setView] = useState<string>('all');
  const pending = useQuery({ queryKey: ['approvals', 'pending'], queryFn: () => erpAdmin.approvals('pending'), refetchInterval: 60_000 });
  const history = useQuery({ queryKey: ['approvals', 'history'], queryFn: () => erpAdmin.approvals('history'), enabled: view === 'history' });
  const [rejecting, setRejecting] = useState<ApprovalRequest | null>(null);
  const [reason, setReason] = useState('');
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['approvals'] });

  const approve = useMutation({ mutationFn: (id: number) => erpAdmin.approve(id), onSettled: refresh });
  const reject = useMutation({
    mutationFn: ({ id, comment }: { id: number; comment: string }) => erpAdmin.reject(id, comment),
    onSuccess: () => {
      setRejecting(null);
      setReason('');
    },
    onSettled: refresh,
  });
  const bulk = useMutation({
    mutationFn: erpAdmin.approveBulk,
    onSuccess: (res) => {
      const failed = res.filter((r) => !r.ok);
      setBulkResult(failed.length ? `${res.length - failed.length} approved, ${failed.length} skipped: ${failed[0].error}` : `${res.length} approved`);
    },
    onSettled: refresh,
  });

  const label = (t: string) => meta.data?.docTypes[t]?.label ?? t;
  const items = pending.data ?? [];
  const types = [...new Set(items.map((r) => r.docType))];
  const shown = view === 'history' ? (history.data ?? []) : view === 'all' ? items : items.filter((r) => r.docType === view);
  const actionError = approve.error ?? reject.error;

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
        <Box>
          <Typography variant="h5">Pending Inbox</Typography>
          <Typography color="text.secondary">Documents waiting for your approval, grouped by type.</Typography>
        </Box>
        {view !== 'history' && view !== 'rules' && (
          <Button variant="contained" disabled={!shown.length || bulk.isPending} onClick={() => bulk.mutate(shown.map((r) => r.id))}>
            Approve all ({shown.length})
          </Button>
        )}
      </Stack>
      <Card>
        <Tabs value={view} onChange={(_, v) => setView(v)} variant="scrollable" allowScrollButtonsMobile>
          <Tab value="all" label={`All (${items.length})`} />
          {types.map((t) => <Tab key={t} value={t} label={`${label(t)} (${items.filter((r) => r.docType === t).length})`} />)}
          <Tab value="history" label="History" />
          {user?.administrator && <Tab value="rules" label="Rules" />}
        </Tabs>
      </Card>
      {bulkResult && <Alert severity="info" onClose={() => setBulkResult(null)}>{bulkResult}</Alert>}
      {actionError && <Alert severity="error">{errorMessage(actionError)}</Alert>}

      {view === 'rules' ? (
        <RulesTab />
      ) : (
        <Stack spacing={1.5}>
          {(view === 'history' ? history.isLoading : pending.isLoading) && <Typography color="text.secondary">Loading…</Typography>}
          {shown.length === 0 && !pending.isLoading && (
            <Card><CardContent><Typography color="text.secondary">{view === 'history' ? 'No decisions yet.' : 'Nothing is waiting for your approval.'}</Typography></CardContent></Card>
          )}
          {shown.map((r) => (
            <Card key={r.id} sx={{ borderLeft: 4, borderLeftColor: r.priority === 'high' ? 'error.main' : 'primary.main' }}>
              <CardContent sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                <Box sx={{ flexGrow: 1, minWidth: 260 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography sx={{ fontWeight: 700 }}>{r.title}</Typography>
                    {r.docNo && <Chip size="small" variant="outlined" label={r.docNo} />}
                    <Chip size="small" label={label(r.docType)} />
                    {r.priority === 'high' && <Chip size="small" color="error" label="High priority" />}
                    {r.status !== 'pending' && <Chip size="small" color={r.status === 'approved' ? 'success' : 'default'} label={r.status} />}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {r.meta?.vehicle ? `Vehicle: ${r.meta.vehicle} · ` : ''}Raised by {r.requestedByName ?? 'unknown'} · {dayjs(r.createdAt).format('D MMM YYYY, HH:mm')}
                    {r.decidedAt && ` · ${r.status} by ${r.decidedByName} ${dayjs(r.decidedAt).format('D MMM, HH:mm')}`}
                  </Typography>
                  {r.summary && <Typography variant="body2" sx={{ mt: 0.5 }}>{r.summary}</Typography>}
                  {r.comment && <Typography variant="body2" sx={{ mt: 0.5, fontStyle: 'italic' }}>“{r.comment}”</Typography>}
                </Box>
                {r.amount !== null && (
                  <Box sx={{ textAlign: 'right', minWidth: 120 }}>
                    <Typography variant="caption" color="text.secondary">Amount</Typography>
                    <Typography sx={{ fontWeight: 700 }}>{inr(r.amount)}</Typography>
                  </Box>
                )}
                {r.status === 'pending' && (
                  <Stack direction="row" spacing={1}>
                    {r.meta?.link && <Button onClick={() => navigate(r.meta!.link!)}>Details</Button>}
                    <Button color="error" onClick={() => setRejecting(r)}>Reject</Button>
                    <Button variant="contained" disabled={approve.isPending} onClick={() => approve.mutate(r.id)}>Approve</Button>
                  </Stack>
                )}
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      <Dialog open={Boolean(rejecting)} onClose={() => setRejecting(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Reject {rejecting?.docNo ?? rejecting?.title}</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth multiline minRows={3} label="Reason (sent back to the requester)" value={reason} onChange={(e) => setReason(e.target.value)} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejecting(null)}>Cancel</Button>
          <Button color="error" variant="contained" disabled={!reason.trim() || reject.isPending} onClick={() => rejecting && reject.mutate({ id: rejecting.id, comment: reason })}>
            Reject
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
