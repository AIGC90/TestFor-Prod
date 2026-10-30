import { Alert, Box, Button, Card, CardContent, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { http } from '../../api/http';
import { errorMessage, type Field, type Option, RecordForm } from '../../components/EntityPage';
import { useAuth } from '../../auth/AuthProvider';

export interface Server {
  id: number;
  announcement: string | null;
  attributes: Record<string, unknown>;
  [k: string]: unknown;
}

export const useServer = () => useQuery({ queryKey: ['server'], queryFn: () => http<Server>('/api/server'), staleTime: 300_000 });

const timezones = async (): Promise<Option[]> => (await http<string[]>('/api/server/timezones')).map((z) => ({ value: z, label: z }));
const opts = (pairs: [string, string][]): Option[] => pairs.map(([value, label]) => ({ value, label }));

const MAPS = opts([['openFreeMap', 'Streets (OpenFreeMap)'], ['osm', 'OpenStreetMap'], ['googleRoad', 'Google road'], ['googleSatellite', 'Google satellite'], ['googleHybrid', 'Google hybrid']]);
const COORDS = opts([['dd', 'Decimal degrees'], ['ddm', 'Degrees, decimal minutes'], ['dms', 'Degrees, minutes, seconds']]);
const SPEED = opts([['kmh', 'km/h'], ['kn', 'knots'], ['mph', 'mph']]);
const DISTANCE = opts([['km', 'Kilometres'], ['mi', 'Miles'], ['nmi', 'Nautical miles']]);
const VOLUME = opts([['ltr', 'Litres'], ['usGallon', 'US gallons'], ['impGallon', 'Imperial gallons']]);

const unitFields = (section: string): Field[] => [
  { section, path: 'map', label: 'Default map', type: 'select', options: MAPS },
  { section, path: 'coordinateFormat', label: 'Coordinate format', type: 'select', options: COORDS },
  { section, path: 'attributes.timezone', label: 'Timezone', type: 'select', options: timezones, optionsKey: 'timezones' },
  { section, path: 'attributes.speedUnit', label: 'Speed unit', type: 'select', options: SPEED },
  { section, path: 'attributes.distanceUnit', label: 'Distance unit', type: 'select', options: DISTANCE },
  { section, path: 'attributes.volumeUnit', label: 'Volume unit', type: 'select', options: VOLUME },
];
const locationFields = (section: string): Field[] => [
  { section, path: 'latitude', label: 'Latitude', type: 'number' },
  { section, path: 'longitude', label: 'Longitude', type: 'number' },
  { section, path: 'zoom', label: 'Zoom', type: 'number' },
];

/* ----------------------------------------------------------- preferences */

export function PreferencesPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const me = useQuery({ queryKey: ['me-traccar', user?.id], queryFn: () => http<Record<string, unknown>>(`/api/users/${user!.id}`), enabled: Boolean(user) });
  const save = useMutation({
    mutationFn: (values: Record<string, unknown>) => http(`/api/users/${user!.id}`, { method: 'PUT', body: JSON.stringify(values) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me-traccar'] }),
  });
  const [expiry, setExpiry] = useState(() => dayjs().add(30, 'day').format('YYYY-MM-DD'));
  const token = useMutation({
    // The token endpoint answers with plain text, not JSON.
    mutationFn: async () => {
      const res = await fetch('/api/session/token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ expiration: dayjs(expiry).endOf('day').toISOString() }),
      });
      if (!res.ok) throw new Error(`Could not create a token (${res.status})`);
      return res.text();
    },
  });

  const fields: Field[] = [
    ...unitFields('Map & units'),
    ...locationFields('Where the map opens'),
    { section: 'Live tracking', path: 'attributes.mapLiveRoutes', label: 'Show live trails', type: 'switch' },
    { section: 'Live tracking', path: 'attributes.mapFollow', label: 'Follow the selected vehicle', type: 'switch' },
    { section: 'Live tracking', path: 'attributes.soundAlarms', label: 'Play a sound for alarms', type: 'switch' },
  ];

  return (
    <Stack spacing={2} sx={{ maxWidth: 960 }}>
      <Box>
        <Typography variant="h5">User Preferences</Typography>
        <Typography color="text.secondary">How maps, units and alerts behave for your account.</Typography>
      </Box>
      {me.data && (
        <RecordForm
          fields={fields}
          initial={me.data}
          onSubmit={(v) => save.mutate(v)}
          busy={save.isPending}
          error={save.isError ? errorMessage(save.error) : null}
          success={save.isSuccess ? 'Preferences saved.' : null}
        />
      )}
      <Card>
        <CardContent>
          <Typography variant="h6">API token</Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            For integrations and the mobile app. Treat it like a password.
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
            <TextField size="small" type="date" label="Expires" value={expiry} onChange={(e) => setExpiry(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            <Button variant="outlined" onClick={() => token.mutate()} disabled={token.isPending}>Generate token</Button>
          </Stack>
          {token.isError && <Alert severity="error" sx={{ mt: 2 }}>{errorMessage(token.error)}</Alert>}
          {token.data && <TextField sx={{ mt: 2 }} fullWidth multiline size="small" value={token.data} slotProps={{ input: { readOnly: true } }} />}
        </CardContent>
      </Card>
    </Stack>
  );
}

/* --------------------------------------------------------- server config */

export function ServerConfigPage() {
  const qc = useQueryClient();
  const server = useServer();
  const save = useMutation({
    mutationFn: (values: Record<string, unknown>) => http('/api/server', { method: 'PUT', body: JSON.stringify(values) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server'] }),
  });
  const fields: Field[] = [
    { section: 'Branding', path: 'attributes.title', label: 'Server name' },
    { section: 'Branding', path: 'attributes.description', label: 'Description' },
    { section: 'Branding', path: 'attributes.colorPrimary', label: 'Primary colour (hex)' },
    { section: 'Branding', path: 'attributes.logo', label: 'Logo image URL' },
    ...unitFields('Map, units & format'),
    { section: 'Map, units & format', path: 'forceSettings', label: 'Apply these settings to every user', type: 'switch', fullWidth: true },
    { section: 'Map, units & format', path: 'poiLayer', label: 'POI layer URL' },
    { section: 'Map, units & format', path: 'mapUrl', label: 'Custom map tile URL' },
    ...locationFields('Default location'),
    { section: 'Permissions', path: 'registration', label: 'Allow self-registration from the login page', type: 'switch' },
    { section: 'Permissions', path: 'readonly', label: 'Read-only (nobody can change data)', type: 'switch' },
    { section: 'Permissions', path: 'deviceReadonly', label: 'Users cannot edit or delete devices', type: 'switch' },
    { section: 'Permissions', path: 'limitCommands', label: 'Only saved commands may be sent', type: 'switch' },
    { section: 'Permissions', path: 'disableReports', label: 'Hide reports from users', type: 'switch' },
    { section: 'Permissions', path: 'fixedEmail', label: 'Users cannot change their email', type: 'switch' },
  ];
  return (
    <Stack spacing={2} sx={{ maxWidth: 960 }}>
      <Box>
        <Typography variant="h5">Server Configuration</Typography>
        <Typography color="text.secondary">Defaults, units, permissions and branding for everyone. Changes apply immediately.</Typography>
      </Box>
      {server.data && (
        <RecordForm
          fields={fields}
          initial={server.data}
          onSubmit={(v) => save.mutate(v)}
          busy={save.isPending}
          error={save.isError ? errorMessage(save.error) : null}
          success={save.isSuccess ? 'Server settings saved.' : null}
        />
      )}
    </Stack>
  );
}

/* ---------------------------------------------------------- announcement */

export function AnnouncementPage() {
  const qc = useQueryClient();
  const server = useServer();
  const users = useQuery({ queryKey: ['users'], queryFn: () => http<{ id: number; name: string; email: string }[]>('/api/users') });
  const [banner, setBanner] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [to, setTo] = useState<number[]>([]);

  const saveBanner = useMutation({
    mutationFn: (text: string) => http('/api/server', { method: 'PUT', body: JSON.stringify({ ...server.data, announcement: text || null }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server'] }),
  });
  const send = useMutation({
    mutationFn: () =>
      http(`/api/notifications/send/mail?${to.map((id) => `userId=${id}`).join('&')}`, {
        method: 'POST',
        body: JSON.stringify({ subject, body: message }),
      }),
  });
  const bannerText = banner ?? server.data?.announcement ?? '';

  return (
    <Stack spacing={2} sx={{ maxWidth: 960 }}>
      <Box>
        <Typography variant="h5">Server Announcements</Typography>
        <Typography color="text.secondary">Show a banner to everyone, or email a message to selected users.</Typography>
      </Box>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>Banner for all users</Typography>
          {saveBanner.isError && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage(saveBanner.error)}</Alert>}
          {saveBanner.isSuccess && <Alert severity="success" sx={{ mb: 2 }}>Banner updated.</Alert>}
          <TextField fullWidth multiline minRows={2} placeholder="e.g. Planned maintenance on Sunday 02:00–03:00 IST" value={bannerText} onChange={(e) => setBanner(e.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} />
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
            <Button variant="contained" onClick={() => saveBanner.mutate(bannerText)} disabled={saveBanner.isPending}>Publish banner</Button>
            <Button onClick={() => { setBanner(''); saveBanner.mutate(''); }}>Clear banner</Button>
          </Stack>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>Email a message</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Needs SMTP to be configured on the Traccar server.</Typography>
          {send.isError && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage(send.error)}</Alert>}
          {send.isSuccess && <Alert severity="success" sx={{ mb: 2 }}>Message sent.</Alert>}
          <Stack spacing={2}>
            <TextField
              select
              size="small"
              label="Recipients"
              value={to}
              onChange={(e) => setTo(e.target.value as unknown as number[])}
              slotProps={{ select: { multiple: true } }}
            >
              {users.data?.map((u) => (
                <MenuItem key={u.id} value={u.id}>{`${u.name} <${u.email}>`}</MenuItem>
              ))}
            </TextField>
            <TextField size="small" label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            <TextField multiline minRows={4} label="Message" value={message} onChange={(e) => setMessage(e.target.value)} helperText={`${message.length} / 500`} slotProps={{ htmlInput: { maxLength: 500 } }} />
            <Box>
              <Button variant="contained" disabled={!to.length || !subject || !message || send.isPending} onClick={() => send.mutate()}>Send</Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
