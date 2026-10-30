import { Box, Button, Card, Chip, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import dayjs from 'dayjs';
import { useEffect, useRef, useState } from 'react';

interface LogLine {
  deviceId?: number;
  protocol: string;
  uniqueId: string;
  data: string;
  at: string;
}

const MAX_LINES = 300;

/** Live raw tracker messages (Traccar streams them over the WebSocket once asked). */
export function LogsPage() {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${proto}://${window.location.host}/api/socket`);
    socket.onopen = () => {
      setConnected(true);
      socket.send(JSON.stringify({ logs: true }));
    };
    socket.onclose = () => setConnected(false);
    socket.onmessage = (msg) => {
      const data = JSON.parse(msg.data) as { logs?: Omit<LogLine, 'at'>[] };
      if (!data.logs?.length || pausedRef.current) return;
      const at = dayjs().format('HH:mm:ss');
      setLines((old) => [...data.logs!.map((l) => ({ ...l, at })), ...old].slice(0, MAX_LINES));
    };
    return () => socket.close();
  }, []);

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="h5">System Logs</Typography>
          <Typography color="text.secondary">Raw messages from trackers as they arrive — useful when installing or debugging a device.</Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Chip size="small" label={connected ? 'Live' : 'Disconnected'} color={connected ? 'success' : 'default'} />
          <Button variant="outlined" onClick={() => setPaused((p) => !p)}>{paused ? 'Resume' : 'Pause'}</Button>
          <Button onClick={() => setLines([])}>Clear</Button>
        </Stack>
      </Stack>
      <Card>
        <TableContainer sx={{ maxHeight: 'calc(100vh - 240px)' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {['Time', 'Identifier', 'Protocol', 'Data'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.length === 0 && (
                <TableRow><TableCell colSpan={4}><Typography color="text.secondary" sx={{ py: 2 }}>Waiting for tracker messages…</Typography></TableCell></TableRow>
              )}
              {lines.map((l, i) => (
                <TableRow key={`${l.at}-${i}`}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{l.at}</TableCell>
                  <TableCell>{l.uniqueId}{!l.deviceId && <Chip size="small" label="unknown" color="warning" sx={{ ml: 1 }} />}</TableCell>
                  <TableCell>{l.protocol}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{l.data}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </Stack>
  );
}
