import AutoAwesome from '@mui/icons-material/AutoAwesome';
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Grid, List, ListItemButton, ListItemText, MenuItem, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { http } from '../../api/http';
import { openCopilot } from '../../components/Copilot';
import { errorMessage } from '../../components/EntityPage';
import { useAccess } from '../../lib/access';
import { num, StatusChip } from '../inventory/shared';

interface Issue { severity: 'critical' | 'high' | 'medium' | 'low'; category: string; title: string; detail: string; vehicles: string[]; recommendedAction: string; link: string }
interface Triage { headline: string; issues: Issue[] }
interface Briefing { title: string; summary: string; sections: { heading: string; bullets: string[] }[]; decisions: string[] }
interface Report<T> { id: number; kind: string; title: string; content: T; createdAt: string; createdBy: number | null }
interface Action { id: number; actNo: string; kind: string; summary: string; reason: string | null; status: string; params: Record<string, unknown>; result: Record<string, unknown> | null; error: string | null; createdAt: string; executedAt: string | null }
interface Status { enabled: boolean; model: string; briefingHour: number | null; actions: Record<string, string> }
interface Usage { days: number; features: { feature: string; runs: number; failed: number; requests: number; inputTokens: number; outputTokens: number; cacheReadTokens: number }[] }

const SEV_COLOR = { critical: 'error', high: 'warning', medium: 'info', low: 'default' } as const;
const SEV_ORDER = ['critical', 'high', 'medium', 'low'] as const;

function TriageView({ t, at }: { t: Triage; at: string }) {
  const navigate = useNavigate();
  return (
    <Stack spacing={1.5}>
      <Alert severity={t.issues.some((i) => i.severity === 'critical') ? 'error' : t.issues.some((i) => i.severity === 'high') ? 'warning' : 'success'} icon={<AutoAwesome />}>
        <b>{t.headline}</b> <Typography component="span" variant="caption" color="text.secondary">· {dayjs(at).format('D MMM HH:mm')}</Typography>
      </Alert>
      <Stack direction="row" spacing={1}>
        {SEV_ORDER.map((s) => <Chip key={s} size="small" color={SEV_COLOR[s]} variant="outlined" label={`${s}: ${t.issues.filter((i) => i.severity === s).length}`} />)}
      </Stack>
      {[...t.issues].sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity)).map((i, k) => (
        <Card key={k} variant="outlined" sx={{ borderLeft: 4, borderLeftColor: `${SEV_COLOR[i.severity] === 'default' ? 'grey.400' : `${SEV_COLOR[i.severity]}.main`}` }}>
          <CardContent sx={{ pb: '12px !important' }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
              <Box>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                  <Chip size="small" color={SEV_COLOR[i.severity]} label={i.severity} />
                  <Chip size="small" variant="outlined" label={i.category} />
                  <Typography variant="subtitle2">{i.title}</Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary">{i.detail}</Typography>
                <Typography variant="body2" sx={{ mt: 0.5 }}><b>Do:</b> {i.recommendedAction}</Typography>
                {i.vehicles.length > 0 && <Stack direction="row" sx={{ gap: 0.5, mt: 0.75, flexWrap: 'wrap' }}>{i.vehicles.map((v) => <Chip key={v} size="small" label={v} onClick={() => navigate(`/map?search=${encodeURIComponent(v)}`)} />)}</Stack>}
              </Box>
              <Stack direction={{ xs: 'row', sm: 'column' }} spacing={1} sx={{ flexShrink: 0 }}>
                {i.link?.startsWith('/') && <Button size="small" variant="outlined" onClick={() => navigate(i.link)}>Open</Button>}
                <Button size="small" onClick={() => openCopilot(`About "${i.title}": ${i.recommendedAction} What should I do first? Propose actions if needed.`)}>Ask copilot</Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}

function BriefingView({ b, at }: { b: Briefing; at: string }) {
  return (
    <Card>
      <CardContent>
        <Typography variant="h6">{b.title}</Typography>
        <Typography variant="caption" color="text.secondary">{dayjs(at).format('dddd, D MMM YYYY HH:mm')}</Typography>
        <Typography sx={{ my: 1.5 }}>{b.summary}</Typography>
        {b.decisions.length > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            <b>Decide today</b>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>{b.decisions.map((d) => <li key={d}>{d}</li>)}</Box>
          </Alert>
        )}
        <Grid container spacing={2}>
          {b.sections.map((s) => (
            <Grid key={s.heading} size={{ xs: 12, md: 6 }}>
              <Typography variant="subtitle2">{s.heading}</Typography>
              <Box component="ul" sx={{ mt: 0.5, pl: 2.5 }}>{s.bullets.map((x, k) => <li key={k}><Typography variant="body2">{x}</Typography></li>)}</Box>
            </Grid>
          ))}
        </Grid>
      </CardContent>
    </Card>
  );
}

function ReportsTab<T>({ kind, run, runLabel, render, controls }: { kind: 'triage' | 'briefing'; run: () => Promise<Report<T>>; runLabel: string; render: (c: T, at: string) => React.ReactNode; controls?: React.ReactNode }) {
  const qc = useQueryClient();
  const access = useAccess();
  const reports = useQuery({ queryKey: ['ai-reports', kind], queryFn: () => http<Report<T>[]>(`/erp/ai/reports?kind=${kind}`) });
  const [selected, setSelected] = useState<number | null>(null);
  const go = useMutation({ mutationFn: run, onSuccess: (r) => { setSelected(r.id); qc.invalidateQueries({ queryKey: ['ai-reports', kind] }); } });
  const current = reports.data?.find((r) => r.id === selected) ?? reports.data?.[0];
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 9 }}>
        <Stack spacing={2}>
          {access.can('ai_ops', 'create') && (
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              {controls}
              <Button variant="contained" startIcon={go.isPending ? <CircularProgress size={16} color="inherit" /> : <AutoAwesome />} disabled={go.isPending} onClick={() => go.mutate()}>
                {go.isPending ? 'Working…' : runLabel}
              </Button>
            </Stack>
          )}
          {go.isError && <Alert severity="error">{errorMessage(go.error)}</Alert>}
          {current ? render(current.content, current.createdAt) : <Typography color="text.secondary">Nothing yet.</Typography>}
        </Stack>
      </Grid>
      <Grid size={{ xs: 12, md: 3 }}>
        <Card>
          <CardContent sx={{ pb: 0 }}><Typography variant="subtitle2">History</Typography></CardContent>
          <List dense>
            {reports.data?.map((r) => (
              <ListItemButton key={r.id} selected={r.id === current?.id} onClick={() => setSelected(r.id)}>
                <ListItemText primary={r.title} secondary={`${dayjs(r.createdAt).format('D MMM HH:mm')}${r.createdBy === null ? ' · scheduled' : ''}`} slotProps={{ primary: { noWrap: true } }} />
              </ListItemButton>
            ))}
          </List>
        </Card>
      </Grid>
    </Grid>
  );
}

export function AiOpsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'triage';
  const [hours, setHours] = useState(24);
  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => http<Status>('/erp/ai/status') }).data;
  const actions = useQuery({ queryKey: ['ai-actions'], queryFn: () => http<Action[]>('/erp/ai/actions'), enabled: tab === 'actions' });
  const usage = useQuery({ queryKey: ['ai-usage'], queryFn: () => http<Usage>('/erp/ai/usage?days=30'), enabled: tab === 'usage' });
  const post = <T,>(url: string, body?: unknown) => http<T>(url, { method: 'POST', body: JSON.stringify(body ?? {}) });

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
        <Box>
          <Typography variant="h5">AI Ops</Typography>
          <Typography color="text.secondary">Claude triages alerts across GPS, safety, compliance, maintenance, tyres and money, writes the morning briefing, and proposes actions that wait for your approval.</Typography>
        </Box>
        <Button variant="outlined" startIcon={<AutoAwesome />} onClick={() => openCopilot()}>Open copilot</Button>
      </Stack>
      {status && !status.enabled && <Alert severity="info">AI is off. Set the ANTHROPIC_API_KEY environment secret on the API server (model {status.model}). Past reports stay visible.</Alert>}
      {status?.enabled && <Typography variant="caption" color="text.secondary">Model {status.model}{status.briefingHour !== null ? ` · daily briefing after ${status.briefingHour}:00 IST` : ' · daily briefing not scheduled'}</Typography>}
      <Tabs value={tab} onChange={(_, v) => setParams({ tab: v })} variant="scrollable" allowScrollButtonsMobile>
        <Tab value="triage" label="Alert triage" />
        <Tab value="briefing" label="Morning briefing" />
        <Tab value="actions" label="Proposed actions" />
        <Tab value="usage" label="Usage" />
      </Tabs>
      {tab === 'triage' && (
        <ReportsTab<Triage>
          kind="triage"
          runLabel="Triage now"
          run={() => post('/erp/ai/triage', { hours })}
          render={(c, at) => <TriageView t={c} at={at} />}
          controls={
            <TextField select size="small" label="Look back" value={hours} onChange={(e) => setHours(Number(e.target.value))} sx={{ width: 140 }}>
              {[6, 12, 24, 48, 72, 168].map((h) => <MenuItem key={h} value={h}>{h < 48 ? `${h} hours` : `${h / 24} days`}</MenuItem>)}
            </TextField>
          }
        />
      )}
      {tab === 'briefing' && <ReportsTab<Briefing> kind="briefing" runLabel="Write today's briefing" run={() => post('/erp/ai/briefing')} render={(c, at) => <BriefingView b={c} at={at} />} />}
      {tab === 'actions' && (
        <Card sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead><TableRow>{['Proposal', 'What', 'Why', 'Status', 'Result'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
            <TableBody>
              {actions.data?.length === 0 && <TableRow><TableCell colSpan={5}><Typography color="text.secondary" sx={{ py: 2 }}>No proposals yet. Ask the copilot to open a job card, assign a driver or log an incident; it lands here and in the Pending Inbox.</Typography></TableCell></TableRow>}
              {actions.data?.map((a) => (
                <TableRow key={a.id} hover>
                  <TableCell><b>{a.actNo}</b><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{dayjs(a.createdAt).format('D MMM HH:mm')}</Typography></TableCell>
                  <TableCell>{a.summary}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{status?.actions[a.kind] ?? a.kind}</Typography></TableCell>
                  <TableCell><Typography variant="body2">{a.reason ?? '—'}</Typography></TableCell>
                  <TableCell><StatusChip status={a.status} /></TableCell>
                  <TableCell>{a.result ? Object.values(a.result).filter((v) => typeof v === 'string').join(', ') : a.error ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {tab === 'usage' && (
        <Card>
          <CardContent><Typography variant="h6">Last 30 days</Typography><Typography variant="body2" color="text.secondary">Cached input is billed at about a tenth of the normal input rate.</Typography></CardContent>
          <Table size="small">
            <TableHead><TableRow>{['Feature', 'Runs', 'Failed', 'Model calls', 'Input tokens', 'Cached input', 'Output tokens'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
            <TableBody>
              {usage.data?.features.length === 0 && <TableRow><TableCell colSpan={7}><Typography color="text.secondary">No AI use yet.</Typography></TableCell></TableRow>}
              {usage.data?.features.map((f) => (
                <TableRow key={f.feature}><TableCell>{f.feature}</TableCell><TableCell>{f.runs}</TableCell><TableCell>{f.failed}</TableCell><TableCell>{f.requests}</TableCell><TableCell>{num(f.inputTokens)}</TableCell><TableCell>{num(f.cacheReadTokens)}</TableCell><TableCell>{num(f.outputTokens)}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </Stack>
  );
}
