import { Alert, Box, Button, Card, CardContent, Checkbox, FormControlLabel, Stack, TextField, Typography } from '@mui/material';
import { type FormEvent, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { APP_NAME, APP_TAGLINE } from '../config';

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState(() => localStorage.getItem('loginEmail') ?? '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      if (remember) localStorage.setItem('loginEmail', email);
      else localStorage.removeItem('loginEmail');
    } catch {
      setError('Invalid email or password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: { md: '1fr 1fr' } }}>
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          justifyContent: 'center',
          px: 8,
          color: '#fff',
          background: 'linear-gradient(135deg, #0f1e33 0%, #0b5cad 100%)',
        }}
      >
        <Typography variant="h3" sx={{ fontWeight: 800 }}>{APP_NAME}</Typography>
        <Typography sx={{ letterSpacing: 2, opacity: 0.8, mb: 4 }}>{APP_TAGLINE}</Typography>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 2 }}>Complete fleet management</Typography>
        <Typography sx={{ opacity: 0.85, maxWidth: 460 }}>
          Live GPS tracking, trips, stores, tyres, workshop and compliance in one place.
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
        <Card sx={{ width: '100%', maxWidth: 420 }}>
          <CardContent component="form" onSubmit={submit} sx={{ p: 4 }}>
            <Typography variant="h5" gutterBottom>Welcome back</Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>Sign in to your fleet dashboard</Typography>
            <Stack spacing={2}>
              {error && <Alert severity="error">{error}</Alert>}
              <TextField label="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
              <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <FormControlLabel control={<Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)} />} label="Remember me" />
              <Button type="submit" variant="contained" size="large" disabled={busy}>
                {busy ? 'Signing in…' : 'Login'}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
