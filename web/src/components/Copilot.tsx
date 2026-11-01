import AutoAwesome from '@mui/icons-material/AutoAwesome';
import Close from '@mui/icons-material/Close';
import History from '@mui/icons-material/History';
import Send from '@mui/icons-material/Send';
import { Alert, Box, Button, Chip, CircularProgress, Drawer, IconButton, List, ListItemButton, ListItemText, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { http } from '../api/http';
import { errorMessage } from './EntityPage';

interface Turn { role: 'user' | 'assistant'; text: string; tools?: string[]; actions?: string[] }
interface ChatReply { conversationId: number; answer: string; toolsUsed: string[]; proposedActions: string[] }
interface AiStatus { enabled: boolean; model: string }

const SUGGESTIONS = [
  'Which vehicles are offline right now?',
  'What needs my attention today?',
  'Which trucks have PM overdue? Propose job cards for the worst two.',
  'How did we do on profit this month, and which vehicle lost money?',
  'Any documents expiring in the next 30 days?',
];
const TOOL_LABEL: Record<string, string> = {
  fleet_status: 'Live GPS', recent_events: 'GPS events', trips: 'Trips', workshop_overview: 'Workshop', pm_due: 'PM due', tyre_health: 'Tyres',
  compliance_status: 'Compliance', safety_status: 'Safety & SOS', drivers_overview: 'Drivers', finance_kpis: 'Finance', receivables: 'Receivables',
  stock_lookup: 'Stock', pending_approvals: 'Approvals', propose_action: 'Proposal',
};

/** Opens the copilot from anywhere, optionally with a question. */
export const openCopilot = (question?: string) => window.dispatchEvent(new CustomEvent('open-copilot', { detail: question ?? '' }));

/** Minimal markdown: paragraphs, bullet and numbered lists, **bold**, `code` and pipe tables. */
export function Markdown({ text }: { text: string }) {
  const inline = (s: string): ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith('`') && part.endsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : <Fragment key={i}>{part}</Fragment>,
    );
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().slice(1, -1).split('|').map((c) => c.trim()));
        i++;
      }
      i--;
      blocks.push(
        <Box key={i} component="table" sx={{ borderCollapse: 'collapse', my: 1, fontSize: 13, width: '100%', '& td, & th': { border: 1, borderColor: 'divider', px: 0.75, py: 0.25, textAlign: 'left' } }}>
          <tbody>{rows.map((r, j) => <tr key={j}>{r.map((c, k) => (j === 0 ? <th key={k}>{inline(c)}</th> : <td key={k}>{inline(c)}</td>))}</tr>)}</tbody>
        </Box>,
      );
    } else if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      i--;
      blocks.push(<Box key={i} component={ordered ? 'ol' : 'ul'} sx={{ pl: 2.5, my: 0.5 }}>{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</Box>);
    } else if (/^#{1,4}\s/.test(line)) {
      blocks.push(<Typography key={i} variant="subtitle2" sx={{ mt: 1 }}>{inline(line.replace(/^#+\s/, ''))}</Typography>);
    } else if (line.trim()) {
      blocks.push(<Typography key={i} variant="body2" sx={{ my: 0.5 }}>{inline(line)}</Typography>);
    }
  }
  return <>{blocks}</>;
}

export function Copilot({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => http<AiStatus>('/erp/ai/status'), staleTime: 300_000, enabled: open });
  const history = useQuery({ queryKey: ['ai-conversations'], queryFn: () => http<{ id: number; title: string; updatedAt: string }[]>('/erp/ai/conversations'), enabled: open && showHistory });
  const send = useMutation({
    mutationFn: (message: string) => http<ChatReply>('/erp/ai/chat', { method: 'POST', body: JSON.stringify({ conversationId, message }) }),
    onSuccess: (r) => {
      setConversationId(r.conversationId);
      setTurns((t) => [...t, { role: 'assistant', text: r.answer, tools: r.toolsUsed, actions: r.proposedActions }]);
      qc.invalidateQueries({ queryKey: ['ai-conversations'] });
      if (r.proposedActions.length) qc.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
  const ask = (q: string) => {
    const text = q.trim();
    if (!text || send.isPending) return;
    setTurns((t) => [...t, { role: 'user', text }]);
    setInput('');
    send.mutate(text);
  };
  const load = async (id: number) => {
    const c = await http<{ id: number; turns: Turn[] }>(`/erp/ai/conversations/${id}`);
    setConversationId(c.id);
    setTurns(c.turns);
    setShowHistory(false);
  };

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, send.isPending]);
  useEffect(() => {
    const onOpen = (e: Event) => {
      const q = (e as CustomEvent<string>).detail;
      if (q) setInput(q);
    };
    window.addEventListener('open-copilot', onOpen);
    return () => window.removeEventListener('open-copilot', onOpen);
  }, []);

  return (
    <Drawer anchor="right" open={open} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 460 }, display: 'flex' } } }}>
      <Stack direction="row" sx={{ alignItems: 'center', px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider', gap: 1 }}>
        <AutoAwesome color="primary" />
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>Fleet Copilot</Typography>
          <Typography variant="caption" color="text.secondary">Reads live data you can see · actions need approval</Typography>
        </Box>
        <Tooltip title="Past conversations"><IconButton onClick={() => setShowHistory((s) => !s)} aria-label="past conversations"><History /></IconButton></Tooltip>
        <Button size="small" onClick={() => { setConversationId(null); setTurns([]); send.reset(); }}>New</Button>
        <IconButton onClick={onClose} aria-label="close copilot"><Close /></IconButton>
      </Stack>
      {showHistory ? (
        <List dense sx={{ flexGrow: 1, overflow: 'auto' }}>
          {history.data?.length === 0 && <Typography color="text.secondary" sx={{ p: 2 }}>No conversations yet.</Typography>}
          {history.data?.map((c) => (
            <ListItemButton key={c.id} selected={c.id === conversationId} onClick={() => void load(c.id)}>
              <ListItemText primary={c.title} secondary={new Date(c.updatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} />
            </ListItemButton>
          ))}
        </List>
      ) : (
        <Box sx={{ flexGrow: 1, overflow: 'auto', p: 2, bgcolor: 'background.default' }}>
          {status.data && !status.data.enabled && <Alert severity="info">AI is not switched on for this server. An administrator sets the ANTHROPIC_API_KEY environment secret on the API server to enable the copilot.</Alert>}
          {turns.length === 0 && status.data?.enabled && (
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">Ask about vehicles, trips, maintenance, tyres, compliance, drivers or money. For example:</Typography>
              {SUGGESTIONS.map((s) => <Chip key={s} label={s} onClick={() => ask(s)} variant="outlined" sx={{ justifyContent: 'flex-start', height: 'auto', py: 0.75, '& .MuiChip-label': { whiteSpace: 'normal' } }} />)}
            </Stack>
          )}
          <Stack spacing={1.5}>
            {turns.map((t, i) => (
              <Box key={i} sx={{ display: 'flex', justifyContent: t.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <Paper variant="outlined" sx={{ px: 1.5, py: 1, maxWidth: '92%', bgcolor: t.role === 'user' ? 'primary.main' : 'background.paper', color: t.role === 'user' ? 'primary.contrastText' : 'text.primary', borderRadius: 2 }}>
                  {t.role === 'user' ? <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{t.text}</Typography> : <Markdown text={t.text} />}
                  {!!t.tools?.length && (
                    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                      {[...new Set(t.tools)].map((x) => <Chip key={x} size="small" variant="outlined" label={TOOL_LABEL[x] ?? x} />)}
                    </Stack>
                  )}
                  {!!t.actions?.length && (
                    <Alert severity="warning" sx={{ mt: 1 }} action={<Button size="small" onClick={() => { onClose(); navigate('/pending-inbox'); }}>Review</Button>}>
                      {t.actions.join(', ')} waiting for approval
                    </Alert>
                  )}
                </Paper>
              </Box>
            ))}
            {send.isPending && (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', color: 'text.secondary' }}>
                <CircularProgress size={16} /> <Typography variant="body2">Looking at your fleet data…</Typography>
              </Stack>
            )}
            {send.isError && <Alert severity="error">{errorMessage(send.error)}</Alert>}
            <div ref={end} />
          </Stack>
        </Box>
      )}
      <Box component="form" onSubmit={(e) => { e.preventDefault(); ask(input); }} sx={{ p: 1.5, borderTop: 1, borderColor: 'divider', display: 'flex', gap: 1 }}>
        <TextField
          size="small"
          fullWidth
          multiline
          maxRows={5}
          placeholder={status.data?.enabled === false ? 'AI is not enabled' : 'Ask about your fleet…'}
          value={input}
          disabled={status.data?.enabled === false}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input); } }}
          slotProps={{ htmlInput: { 'aria-label': 'Ask the copilot' } }}
        />
        <IconButton type="submit" color="primary" disabled={!input.trim() || send.isPending} aria-label="send"><Send /></IconButton>
      </Box>
    </Drawer>
  );
}
