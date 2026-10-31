import { Alert, Box, Button, Card, CardContent, Chip, Link, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { http } from '../../api/http';
import { errorMessage } from '../../components/EntityPage';

interface FlespiStatus {
  configured: boolean;
  tokenHint: string | null;
  traccarHost: string | null;
  traccarPort: number;
  streamId?: number;
  lastImportAt?: string;
  lastImportCount?: number;
  lastTestAt?: string;
  lastTestOk?: boolean;
}
interface FlespiDevice {
  id: number;
  name: string;
  ident: string | null;
  connected: boolean;
  lastActive: number | null;
  traccarDeviceId: number | null;
}
interface ImportResult {
  created: { flespiId: number; name: string }[];
  failed: { flespiId: number; name: string; error: string }[];
  skipped: { flespiId: number; name: string; reason: string }[];
}

export function IntegrationsPage() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['flespi'], queryFn: () => http<FlespiStatus>('/erp/integrations/flespi') });
  const [form, setForm] = useState<{ token: string; traccarHost: string | null; traccarPort: string | null }>({ token: '', traccarHost: null, traccarPort: null });
  const host = form.traccarHost ?? status.data?.traccarHost ?? '';
  const port = form.traccarPort ?? String(status.data?.traccarPort ?? 5149);
  const refresh = () => qc.invalidateQueries({ queryKey: ['flespi'] });

  const save = useMutation({
    mutationFn: () =>
      http<FlespiStatus>('/erp/integrations/flespi', {
        method: 'PUT',
        body: JSON.stringify({ ...(form.token ? { token: form.token } : {}), traccarHost: host, traccarPort: Number(port) }),
      }),
    onSuccess: () => setForm({ token: '', traccarHost: null, traccarPort: null }),
    onSettled: refresh,
  });
  const test = useMutation({ mutationFn: () => http('/erp/integrations/flespi/test', { method: 'POST' }), onSettled: refresh });
  const devices = useQuery({
    queryKey: ['flespi-devices'],
    queryFn: () => http<FlespiDevice[]>('/erp/integrations/flespi/devices'),
    enabled: Boolean(status.data?.configured),
    retry: false,
  });
  const importAll = useMutation({
    mutationFn: () => http<ImportResult>('/erp/integrations/flespi/import', { method: 'POST', body: '{}' }),
    onSettled: () => {
      void refresh();
      void qc.invalidateQueries({ queryKey: ['flespi-devices'] });
      void qc.invalidateQueries({ queryKey: ['devices'] });
    },
  });
  const stream = useMutation({
    mutationFn: () => http<{ streamId: number; subscribed: number }>('/erp/integrations/flespi/stream', { method: 'POST', body: '{}' }),
    onSettled: refresh,
  });

  const s = status.data;
  const missing = (devices.data ?? []).filter((d) => d.ident && !d.traccarDeviceId).length;
  const err = save.error ?? test.error ?? importAll.error ?? stream.error;

  return (
    <Stack spacing={2} sx={{ maxWidth: 1100 }}>
      <Box>
        <Typography variant="h5">Integrations</Typography>
        <Typography color="text.secondary">Connect external telematics platforms.</Typography>
      </Box>

      <Card>
        <CardContent>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
            <Typography variant="h6">flespi</Typography>
            <Chip size="small" label={s?.configured ? 'Connected' : 'Not connected'} color={s?.configured ? 'success' : 'default'} />
            {s?.streamId && <Chip size="small" variant="outlined" label={`Stream #${s.streamId}`} />}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Trackers connected to your flespi account appear here like any other device. flespi pushes their messages to Traccar
            through a stream, so Traccar must be reachable from the internet on the flespi port (5149). Each flespi device&apos;s
            <b> ident</b> becomes its Traccar unique ID. Commands to these trackers must be sent from flespi.
          </Typography>
          {err && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage(err)}</Alert>}
          {save.isSuccess && <Alert severity="success" sx={{ mb: 2 }}>Settings saved.</Alert>}
          {test.isSuccess && <Alert severity="success" sx={{ mb: 2 }}>flespi accepted the token.</Alert>}
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
            <TextField
              size="small"
              type="password"
              label="flespi token"
              autoComplete="off"
              value={form.token}
              onChange={(e) => setForm({ ...form, token: e.target.value })}
              placeholder={s?.tokenHint ? `${s.tokenHint} (leave blank to keep)` : 'Paste a flespi token'}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ flexGrow: 1 }}
            />
            <TextField size="small" label="Public Traccar host" placeholder="gps.yourcompany.com" value={host} onChange={(e) => setForm({ ...form, traccarHost: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField size="small" label="flespi port" type="number" value={port} onChange={(e) => setForm({ ...form, traccarPort: e.target.value })} sx={{ width: 120 }} />
            <Button variant="contained" disabled={!host || (!s?.configured && !form.token) || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Checking…' : 'Save'}
            </Button>
            <Button variant="outlined" disabled={!s?.configured || test.isPending} onClick={() => test.mutate()}>Test</Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Create a token in the flespi panel (<Link href="https://flespi.io" target="_blank" rel="noreferrer">flespi.io</Link> → Tokens). It is stored encrypted and never shown again.
            {s?.lastTestAt && ` Last test ${dayjs(s.lastTestAt).format('D MMM, HH:mm')}: ${s.lastTestOk ? 'OK' : 'failed'}.`}
          </Typography>
        </CardContent>
      </Card>

      {s?.configured && (
        <Card>
          <CardContent>
            <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', gap: 1, mb: 2 }}>
              <Box>
                <Typography variant="h6">flespi devices</Typography>
                <Typography variant="body2" color="text.secondary">
                  {devices.data ? `${devices.data.length} in flespi · ${missing} not yet in Traccar` : 'Loading…'}
                  {s.lastImportAt && ` · last import ${dayjs(s.lastImportAt).format('D MMM, HH:mm')} (${s.lastImportCount ?? 0} created)`}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1}>
                <Button variant="outlined" disabled={!missing || importAll.isPending} onClick={() => importAll.mutate()}>
                  Import {missing} missing
                </Button>
                <Button variant="contained" disabled={stream.isPending} onClick={() => stream.mutate()}>
                  {s.streamId ? 'Update stream' : 'Create stream'}
                </Button>
              </Stack>
            </Stack>
            {importAll.data && (
              <Alert severity={importAll.data.failed.length ? 'warning' : 'success'} sx={{ mb: 2 }}>
                Created {importAll.data.created.length} devices
                {importAll.data.failed.length ? `, ${importAll.data.failed.length} failed (${importAll.data.failed[0].error})` : ''}
                {importAll.data.skipped.length ? `, skipped ${importAll.data.skipped.length} without an ident` : ''}.
              </Alert>
            )}
            {stream.data && <Alert severity="success" sx={{ mb: 2 }}>Stream #{stream.data.streamId} is forwarding {stream.data.subscribed} devices to Traccar.</Alert>}
            {devices.isError && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage(devices.error)}</Alert>}
            <Table size="small">
              <TableHead>
                <TableRow>{['flespi ID', 'Name', 'Ident', 'flespi connection', 'Last active', 'In Traccar'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow>
              </TableHead>
              <TableBody>
                {devices.data?.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{d.id}</TableCell>
                    <TableCell>{d.name}</TableCell>
                    <TableCell>{d.ident ?? <Chip size="small" color="warning" label="no ident" />}</TableCell>
                    <TableCell><Chip size="small" label={d.connected ? 'Connected' : 'Offline'} color={d.connected ? 'success' : 'default'} /></TableCell>
                    <TableCell>{d.lastActive ? dayjs.unix(d.lastActive).format('D MMM, HH:mm') : '—'}</TableCell>
                    <TableCell>{d.traccarDeviceId ? <Chip size="small" color="success" label="Yes" /> : <Chip size="small" variant="outlined" label="No" />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}
