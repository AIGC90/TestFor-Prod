import DeleteOutlined from '@mui/icons-material/DeleteOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import SearchIcon from '@mui/icons-material/Search';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControlLabel,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { http } from '../api/http';
import type { Geofence, Group } from '../api/traccar';
import { errorMessage } from '../components/EntityPage';
import { FleetMap, type MapArea } from '../components/FleetMap';
import { useGeofences } from '../lib/live';
import { gpxToShape, parseWkt, type Shape, shapeCenter, toWkt } from '../lib/wkt';

type Tool = 'circle' | 'polygon' | 'line';

interface Draft {
  id?: number;
  name: string;
  description: string;
  calendarId: number;
  shape: Shape | null;
  linkAllGroups: boolean;
}

const EMPTY: Draft = { name: '', description: '', calendarId: 0, shape: null, linkAllGroups: true };

function shapeIsComplete(shape: Shape | null) {
  if (!shape) return false;
  if (shape.kind === 'circle') return shape.radius > 0;
  return shape.coords.length >= (shape.kind === 'polygon' ? 3 : 2);
}

export function GeofencesPage() {
  const qc = useQueryClient();
  const geofences = useGeofences();
  const calendars = useQuery({ queryKey: ['calendars'], queryFn: () => http<{ id: number; name: string }[]>('/api/calendars') });
  const [tab, setTab] = useState<'list' | 'edit'>('list');
  const [filter, setFilter] = useState('');
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [tool, setTool] = useState<Tool>('circle');
  const [focus, setFocus] = useState<[number, number] | null>(null);
  const [place, setPlace] = useState('');
  const [placeError, setPlaceError] = useState<string | null>(null);
  const gpxInput = useRef<HTMLInputElement>(null);

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const body = { id: d.id, name: d.name, description: d.description || null, calendarId: d.calendarId, area: toWkt(d.shape!), attributes: {} };
      const saved = await http<Geofence>(d.id ? `/api/geofences/${d.id}` : '/api/geofences', {
        method: d.id ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });
      // Traccar only checks geofences linked to a device or its group.
      if (!d.id && d.linkAllGroups) {
        const groups = await http<Group[]>('/api/groups');
        await Promise.all(
          groups.map((g) =>
            http('/api/permissions', { method: 'POST', body: JSON.stringify({ groupId: g.id, geofenceId: saved.id }) }),
          ),
        );
      }
      return saved;
    },
    onSuccess: () => {
      setDraft(EMPTY);
      setTab('list');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['geofences'] }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => http(`/api/geofences/${id}`, { method: 'DELETE' }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['geofences'] }),
  });

  const areas: MapArea[] = useMemo(() => {
    const saved = (geofences.data ?? [])
      .filter((g) => g.id !== draft.id)
      .flatMap((g): MapArea[] => {
        const shape = parseWkt(g.area);
        return shape ? [{ id: g.id, shape, label: g.name }] : [];
      });
    return draft.shape ? [...saved, { id: 'draft', shape: draft.shape, label: draft.name || 'New zone', highlight: true }] : saved;
  }, [geofences.data, draft]);

  function onMapClick(lngLat: [number, number]) {
    if (tab !== 'edit') return;
    setDraft((d) => {
      if (tool === 'circle') {
        const radius = d.shape?.kind === 'circle' ? d.shape.radius : 1000;
        return { ...d, shape: { kind: 'circle', center: lngLat, radius } };
      }
      const coords = d.shape && d.shape.kind === tool ? d.shape.coords : [];
      return { ...d, shape: { kind: tool, coords: [...coords, lngLat] } };
    });
  }

  function edit(g: Geofence) {
    const shape = parseWkt(g.area);
    setDraft({ id: g.id, name: g.name, description: g.description ?? '', calendarId: g.calendarId, shape, linkAllGroups: false });
    if (shape) {
      setTool(shape.kind);
      setFocus(shapeCenter(shape));
    }
    setTab('edit');
  }

  async function findPlace() {
    setPlaceError(null);
    try {
      const res = await fetch(`https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(place)}`);
      const data = (await res.json()) as { features: { geometry: { coordinates: [number, number] } }[] };
      if (data.features[0]) setFocus(data.features[0].geometry.coordinates);
      else setPlaceError('Place not found');
    } catch {
      setPlaceError('Address search is unavailable');
    }
  }

  const list = (geofences.data ?? []).filter((g) => g.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', md: 'row' }, height: { md: 'calc(100vh - 112px)' } }}>
      <Card sx={{ width: { md: 380 }, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth">
          <Tab value="list" label={`Saved zones (${geofences.data?.length ?? 0})`} />
          <Tab value="edit" label={draft.id ? 'Edit zone' : 'New zone'} />
        </Tabs>

        {tab === 'list' && (
          <>
            <Box sx={{ p: 2, pb: 1 }}>
              <TextField
                size="small"
                fullWidth
                placeholder="Filter saved zones..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
              />
            </Box>
            <List dense sx={{ overflowY: 'auto', flexGrow: 1 }}>
              {list.map((g) => {
                const shape = parseWkt(g.area);
                return (
                  <ListItemButton key={g.id} onClick={() => shape && setFocus(shapeCenter(shape))}>
                    <ListItemText primary={g.name} secondary={`${shape?.kind ?? 'unknown'}${g.description ? ` · ${g.description}` : ''}`} />
                    <IconButton size="small" aria-label="edit" onClick={(e) => { e.stopPropagation(); edit(g); }}>
                      <EditOutlined fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label="delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Delete zone "${g.name}"?`)) remove.mutate(g.id);
                      }}
                    >
                      <DeleteOutlined fontSize="small" />
                    </IconButton>
                  </ListItemButton>
                );
              })}
              {list.length === 0 && <Typography sx={{ p: 2 }} color="text.secondary">No zones.</Typography>}
            </List>
            <Box sx={{ p: 2 }}>
              <Button fullWidth variant="contained" onClick={() => { setDraft(EMPTY); setTab('edit'); }}>
                New zone
              </Button>
            </Box>
          </>
        )}

        {tab === 'edit' && (
          <CardContent sx={{ overflowY: 'auto' }}>
            <Stack spacing={2}>
              {save.isError && <Alert severity="error">{errorMessage(save.error)}</Alert>}
              <TextField size="small" label="Name" required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <TextField size="small" label="Description" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              <TextField select size="small" label="Active schedule (calendar)" value={draft.calendarId} onChange={(e) => setDraft({ ...draft, calendarId: Number(e.target.value) })}>
                <MenuItem value={0}>Always</MenuItem>
                {calendars.data?.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
              </TextField>

              <Box>
                <Typography variant="subtitle2" gutterBottom>Area</Typography>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={tool}
                  onChange={(_, v: Tool | null) => {
                    if (!v) return;
                    setTool(v);
                    if (draft.shape && draft.shape.kind !== v) setDraft({ ...draft, shape: null });
                  }}
                >
                  <ToggleButton value="circle">Circle</ToggleButton>
                  <ToggleButton value="polygon">Polygon</ToggleButton>
                  <ToggleButton value="line">Route line</ToggleButton>
                </ToggleButtonGroup>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {tool === 'circle' ? 'Click the map to place the centre, then set the radius.' : 'Click the map to add points in order.'}
                </Typography>
              </Box>

              {draft.shape?.kind === 'circle' && (
                <TextField
                  size="small"
                  type="number"
                  label="Radius (metres)"
                  value={draft.shape.radius}
                  onChange={(e) => setDraft({ ...draft, shape: { ...(draft.shape as Extract<Shape, { kind: 'circle' }>), radius: Number(e.target.value) } })}
                />
              )}
              {draft.shape && draft.shape.kind !== 'circle' && (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography variant="body2">{draft.shape.coords.length} points</Typography>
                  <Button size="small" onClick={() => setDraft({ ...draft, shape: draft.shape && draft.shape.kind !== 'circle' ? { ...draft.shape, coords: draft.shape.coords.slice(0, -1) } : null })}>
                    Undo point
                  </Button>
                </Stack>
              )}

              <Stack direction="row" spacing={1}>
                <Button size="small" variant="outlined" onClick={() => gpxInput.current?.click()}>Upload GPX</Button>
                <Button size="small" onClick={() => setDraft({ ...draft, shape: null })}>Reset area</Button>
              </Stack>
              <input
                ref={gpxInput}
                type="file"
                accept=".gpx"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const shape = gpxToShape(await file.text());
                  if (shape) {
                    setTool('line');
                    setDraft((d) => ({ ...d, shape }));
                    setFocus(shapeCenter(shape));
                  }
                  e.target.value = '';
                }}
              />

              {!draft.id && (
                <FormControlLabel
                  control={<Checkbox checked={draft.linkAllGroups} onChange={(e) => setDraft({ ...draft, linkAllGroups: e.target.checked })} />}
                  label="Watch this zone for all vehicle groups"
                />
              )}

              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  disabled={!draft.name.trim() || !shapeIsComplete(draft.shape) || save.isPending}
                  onClick={() => save.mutate(draft)}
                >
                  {draft.id ? 'Save zone' : 'Create zone'}
                </Button>
                <Button onClick={() => { setDraft(EMPTY); setTab('list'); }}>Cancel</Button>
              </Stack>
            </Stack>
          </CardContent>
        )}
      </Card>

      <Box sx={{ position: 'relative', flexGrow: 1, minHeight: { xs: 460, md: 0 } }}>
        <FleetMap areas={areas} onMapClick={onMapClick} focus={focus} />
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            void findPlace();
          }}
          sx={{ position: 'absolute', top: 10, left: 150, right: 60, maxWidth: 360 }}
        >
          <TextField
            size="small"
            fullWidth
            placeholder="Search an address or place"
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            error={Boolean(placeError)}
            helperText={placeError}
            sx={{ bgcolor: 'background.paper', borderRadius: 1 }}
          />
        </Box>
      </Box>
    </Box>
  );
}
