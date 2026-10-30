import AddIcon from '@mui/icons-material/Add';
import DeleteOutline from '@mui/icons-material/DeleteOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import SearchIcon from '@mui/icons-material/Search';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { http, HttpError } from '../api/http';
import { downloadCsv } from '../lib/csv';

export interface Option {
  value: string | number;
  label: string;
}

export interface Field {
  /** Dotted path into the record, e.g. `name` or `attributes.operator`. */
  path: string;
  label: string;
  type?: 'text' | 'number' | 'password' | 'textarea' | 'select' | 'multiselect' | 'switch' | 'date' | 'datetime';
  required?: boolean;
  helper?: string;
  section?: string;
  /** Static options, or a loader (cached under `optionsKey`). */
  options?: Option[] | (() => Promise<Option[]>);
  optionsKey?: string;
  /** Stored value = shown value × scale (e.g. 1000 to show km and store metres). */
  scale?: number;
  /** Multiselects stored as a comma-separated string (Traccar notificators, alarms). */
  joined?: boolean;
  /** Only shown when creating (e.g. password). */
  createOnly?: boolean;
  /** Hidden unless this returns true for the current form values. */
  visible?: (values: Record<string, unknown>) => boolean;
  fullWidth?: boolean;
}

export interface Column<T> {
  label: string;
  render: (row: T) => ReactNode;
  /** Plain value for CSV export; defaults to the rendered value when it is a string or number. */
  csv?: (row: T) => string | number | null | undefined;
}

export interface EntityConfig<T extends { id: number }> {
  title: string;
  subtitle?: string;
  singular: string;
  endpoint: string;
  queryKey: string;
  columns: Column<T>[];
  fields: Field[];
  defaults?: Partial<T>;
  searchText?: (row: T) => string;
  /** Extra work after create/update, e.g. setting accumulators or ERP roles. */
  afterSave?: (saved: T, values: Record<string, unknown>, isNew: boolean) => Promise<void>;
  /** Values that live outside the Traccar record (loaded when editing). */
  loadExtra?: (row: T) => Promise<Record<string, unknown>>;
  /** Strip values that must not be sent to the endpoint. */
  omitOnSave?: string[];
  /** Final transform of the form values into the API body (runs before omitOnSave). */
  beforeSave?: (values: Record<string, unknown>) => Record<string, unknown>;
  toolbar?: ReactNode;
  readOnly?: boolean;
}

export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const [head, ...rest] = path.split('.');
  if (!rest.length) return { ...obj, [head]: value };
  return { ...obj, [head]: setPath((obj[head] as Record<string, unknown>) ?? {}, rest.join('.'), value) };
}

function omit(obj: Record<string, unknown>, paths: string[]) {
  let out = obj;
  for (const p of paths) {
    const [head, ...rest] = p.split('.');
    if (!rest.length) {
      const { [head]: _drop, ...keep } = out;
      out = keep;
    } else if (out[head]) {
      out = { ...out, [head]: omit(out[head] as Record<string, unknown>, [rest.join('.')]) };
    }
  }
  return out;
}

/** Converts a stored value to what the input shows. */
function toInput(field: Field, stored: unknown): unknown {
  if (stored === undefined || stored === null) return field.type === 'multiselect' ? [] : field.type === 'switch' ? false : '';
  if (field.type === 'multiselect' && field.joined) return String(stored).split(',').filter(Boolean);
  if (field.type === 'number' && field.scale) return Number(stored) / field.scale;
  if (field.type === 'date') return dayjs(String(stored)).format('YYYY-MM-DD');
  if (field.type === 'datetime') return dayjs(String(stored)).format('YYYY-MM-DDTHH:mm');
  return stored;
}

/** Converts an input value back to what the API stores. */
function toStored(field: Field, input: unknown): unknown {
  // Empty optional attributes are dropped rather than stored as "" / null.
  if (field.path.startsWith('attributes.') && (input === '' || input === null || (Array.isArray(input) && !input.length))) return undefined;
  if (field.type === 'multiselect' && field.joined) return (input as string[]).join(',');
  if (field.type === 'number') {
    if (input === '' || input === null || input === undefined) return field.required ? 0 : null;
    return Number(input) * (field.scale ?? 1);
  }
  if (field.type === 'date' || field.type === 'datetime') return input ? dayjs(String(input)).toISOString() : null;
  if (field.type === 'select' && input === '') return null;
  return input;
}

function FieldInput({ field, value, onChange }: { field: Field; value: unknown; onChange: (v: unknown) => void }) {
  const loader = typeof field.options === 'function' ? field.options : null;
  const loaded = useQuery({
    queryKey: ['options', field.optionsKey ?? field.path],
    queryFn: () => loader!(),
    enabled: Boolean(loader),
    staleTime: 300_000,
  });
  const options: Option[] = (loader ? loaded.data : (field.options as Option[] | undefined)) ?? [];
  const filled = value !== '' && value !== null && value !== undefined;
  const common = {
    label: field.label,
    required: field.required,
    helperText: field.helper,
    fullWidth: true,
    size: 'small' as const,
    slotProps: { inputLabel: { shrink: filled || undefined } },
  };

  switch (field.type) {
    case 'switch':
      return <FormControlLabel control={<Switch checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />} label={field.label} />;
    case 'select':
      return (
        <TextField select {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          {!field.required && <MenuItem value="">—</MenuItem>}
          {options.map((o) => (
            <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
          ))}
        </TextField>
      );
    case 'multiselect':
      return (
        <Autocomplete
          multiple
          size="small"
          options={options}
          disableCloseOnSelect
          getOptionLabel={(o) => o.label}
          isOptionEqualToValue={(a, b) => a.value === b.value}
          value={options.filter((o) => (value as unknown[]).map(String).includes(String(o.value)))}
          onChange={(_, list) => onChange(list.map((o) => o.value))}
          renderOption={(props, o, { selected }) => (
            <li {...props} key={o.value}>
              <Checkbox size="small" checked={selected} sx={{ mr: 1 }} />
              {o.label}
            </li>
          )}
          renderInput={(p) => <TextField {...p} label={field.label} helperText={field.helper} required={field.required && !(value as unknown[]).length} />}
        />
      );
    case 'textarea':
      return <TextField {...common} multiline minRows={3} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'date':
    case 'datetime':
      return (
        <TextField
          {...common}
          type={field.type === 'date' ? 'date' : 'datetime-local'}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      );
    default:
      return (
        <TextField
          {...common}
          type={field.type === 'number' ? 'number' : field.type === 'password' ? 'password' : 'text'}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/** Dialog that edits one record using field definitions. */
export function EntityForm({
  title,
  fields,
  initial,
  isNew,
  onCancel,
  onSubmit,
  busy,
  error,
}: {
  title: string;
  fields: Field[];
  initial: Record<string, unknown>;
  isNew: boolean;
  onCancel: () => void;
  onSubmit: (values: Record<string, unknown>) => void;
  busy?: boolean;
  error?: string | null;
}) {
  const [values, setValues] = useState(() =>
    fields.reduce((acc, f) => setPath(acc, f.path, toInput(f, getPath(initial, f.path))), { ...initial }),
  );
  const shown = fields.filter((f) => (!f.createOnly || isNew) && (!f.visible || f.visible(values)));
  const sections = [...new Set(shown.map((f) => f.section ?? ''))];

  return (
    <Dialog open onClose={onCancel} maxWidth="md" fullWidth>
      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          const stored = shown.reduce((acc, f) => setPath(acc, f.path, toStored(f, getPath(values, f.path))), { ...values });
          onSubmit(stored);
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            {error && <Alert severity="error">{error}</Alert>}
            {sections.map((section) => (
              <Box key={section || 'main'}>
                {section && (
                  <Typography variant="subtitle2" color="primary" sx={{ mb: 1.5, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {section}
                  </Typography>
                )}
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                  {shown
                    .filter((f) => (f.section ?? '') === section)
                    .map((f) => (
                      <Box key={f.path} sx={{ gridColumn: f.fullWidth || f.type === 'textarea' ? '1 / -1' : undefined }}>
                        <FieldInput field={f} value={getPath(values, f.path)} onChange={(v) => setValues((s) => setPath(s, f.path, v))} />
                      </Box>
                    ))}
                </Box>
              </Box>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

export function errorMessage(e: unknown) {
  if (e instanceof HttpError) {
    const text = e.message.split('\n')[0];
    return text.length > 200 ? `${text.slice(0, 200)}…` : text;
  }
  return e instanceof Error ? e.message : 'Something went wrong';
}

/** Standard list + create/edit/delete screen for one Traccar (or ERP) entity. */
export function EntityPage<T extends { id: number }>({ config }: { config: EntityConfig<T> }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: [config.queryKey], queryFn: () => http<T[]>(config.endpoint) });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [editing, setEditing] = useState<{ row: Record<string, unknown>; isNew: boolean } | null>(null);
  const [deleting, setDeleting] = useState<T | null>(null);
  const [params, setParams] = useSearchParams();

  const save = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const isNew = !values.id;
      const body = omit(config.beforeSave ? config.beforeSave(values) : values, config.omitOnSave ?? []);
      const saved = await http<T>(isNew ? config.endpoint : `${config.endpoint}/${values.id}`, {
        method: isNew ? 'POST' : 'PUT',
        body: JSON.stringify(body),
      });
      await config.afterSave?.(saved, values, isNew);
      return saved;
    },
    onSuccess: () => setEditing(null),
    // Refresh even on failure: the record may exist although a follow-up step failed.
    onSettled: () => qc.invalidateQueries({ queryKey: [config.queryKey] }),
  });
  const remove = useMutation({
    mutationFn: (row: T) => http<void>(`${config.endpoint}/${row.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: [config.queryKey] });
    },
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = list.data ?? [];
    if (!q) return all;
    return all.filter((r) => (config.searchText ? config.searchText(r) : JSON.stringify(r)).toLowerCase().includes(q));
  }, [list.data, search, config]);

  async function openEdit(row: T) {
    const extra = config.loadExtra ? await config.loadExtra(row) : {};
    save.reset();
    setEditing({ row: { ...row, ...extra }, isNew: false });
  }

  function openNew() {
    save.reset();
    setEditing({ row: { ...(config.defaults ?? {}) } as Record<string, unknown>, isNew: true });
  }

  // Deep links: ?new=1 opens an empty form, ?edit=<id> opens that record.
  const wantsNew = params.get('new') === '1';
  useEffect(() => {
    if (!wantsNew || config.readOnly) return;
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next, { replace: true });
    openNew();
  }, [wantsNew]);

  const editId = params.get('edit');
  useEffect(() => {
    if (!editId || !list.data) return;
    const row = list.data.find((r) => String(r.id) === editId);
    const next = new URLSearchParams(params);
    next.delete('edit');
    setParams(next, { replace: true });
    if (row) void openEdit(row);
  }, [editId, list.data]);

  function exportCsv() {
    const header = config.columns.map((c) => c.label);
    const body = rows.map((r) =>
      config.columns.map((c) => {
        if (c.csv) return c.csv(r);
        const v = c.render(r);
        return typeof v === 'string' || typeof v === 'number' ? v : '';
      }),
    );
    downloadCsv(`${config.queryKey}.csv`, [header, ...body]);
  }

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', gap: 1.5 }}>
        <Box>
          <Typography variant="h5">
            {config.title} <Chip size="small" label={list.data?.length ?? 0} sx={{ ml: 1, verticalAlign: 'middle' }} />
          </Typography>
          {config.subtitle && <Typography color="text.secondary">{config.subtitle}</Typography>}
        </Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {config.toolbar}
          <Button variant="outlined" startIcon={<FileDownloadOutlined />} onClick={exportCsv} disabled={!rows.length}>
            Export
          </Button>
          {!config.readOnly && (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={openNew}
            >
              Add {config.singular}
            </Button>
          )}
        </Stack>
      </Stack>

      <TextField
        size="small"
        placeholder={`Search ${config.title.toLowerCase()}...`}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(0);
        }}
        sx={{ maxWidth: 420 }}
        slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
      />

      {list.isError && <Alert severity="error">{errorMessage(list.error)}</Alert>}

      <Card>
        <TableContainer>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {config.columns.map((c) => (
                  <TableCell key={c.label} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{c.label}</TableCell>
                ))}
                {!config.readOnly && <TableCell align="right" />}
              </TableRow>
            </TableHead>
            <TableBody>
              {list.isLoading && (
                <TableRow><TableCell colSpan={config.columns.length + 1}>Loading…</TableCell></TableRow>
              )}
              {!list.isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={config.columns.length + 1}>
                    <Typography color="text.secondary" sx={{ py: 2 }}>
                      {search ? 'Nothing matches your search.' : `No ${config.title.toLowerCase()} yet.`}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage).map((r) => (
                <TableRow key={r.id} hover>
                  {config.columns.map((c) => (
                    <TableCell key={c.label}>{c.render(r)}</TableCell>
                  ))}
                  {!config.readOnly && (
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <IconButton size="small" aria-label="edit" onClick={() => void openEdit(r)}>
                        <EditOutlined fontSize="small" />
                      </IconButton>
                      <IconButton size="small" aria-label="delete" onClick={() => setDeleting(r)}>
                        <DeleteOutline fontSize="small" />
                      </IconButton>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={rows.length}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage}
          rowsPerPageOptions={[25, 50, 100]}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(Number(e.target.value));
            setPage(0);
          }}
        />
      </Card>

      {editing && (
        <EntityForm
          title={`${editing.isNew ? 'Add' : 'Edit'} ${config.singular}`}
          fields={config.fields}
          initial={editing.row}
          isNew={editing.isNew}
          onCancel={() => setEditing(null)}
          onSubmit={(v) => save.mutate(v)}
          busy={save.isPending}
          error={save.isError ? errorMessage(save.error) : null}
        />
      )}

      <Dialog open={Boolean(deleting)} onClose={() => setDeleting(null)}>
        <DialogTitle>Delete {config.singular}?</DialogTitle>
        <DialogContent>
          {remove.isError && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage(remove.error)}</Alert>}
          <Typography>This cannot be undone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)}>Cancel</Button>
          <Button color="error" variant="contained" disabled={remove.isPending} onClick={() => deleting && remove.mutate(deleting)}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

/** Inline (non-dialog) form for a single record such as server settings or the current user. */
export function RecordForm({
  fields,
  initial,
  onSubmit,
  busy,
  error,
  success,
  submitLabel = 'Save changes',
}: {
  fields: Field[];
  initial: Record<string, unknown>;
  onSubmit: (values: Record<string, unknown>) => void;
  busy?: boolean;
  error?: string | null;
  success?: string | null;
  submitLabel?: string;
}) {
  const [values, setValues] = useState(() =>
    fields.reduce((acc, f) => setPath(acc, f.path, toInput(f, getPath(initial, f.path))), { ...initial }),
  );
  const shown = fields.filter((f) => !f.visible || f.visible(values));
  const sections = [...new Set(shown.map((f) => f.section ?? ''))];
  return (
    <Box
      component="form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(shown.reduce((acc, f) => setPath(acc, f.path, toStored(f, getPath(values, f.path))), { ...values }));
      }}
    >
      <Stack spacing={2}>
        {error && <Alert severity="error">{error}</Alert>}
        {success && <Alert severity="success">{success}</Alert>}
        {sections.map((section) => (
          <Card key={section || 'main'} sx={{ p: 2.5 }}>
            {section && <Typography variant="h6" sx={{ mb: 2 }}>{section}</Typography>}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
              {shown
                .filter((f) => (f.section ?? '') === section)
                .map((f) => (
                  <Box key={f.path} sx={{ gridColumn: f.fullWidth || f.type === 'textarea' ? '1 / -1' : undefined }}>
                    <FieldInput field={f} value={getPath(values, f.path)} onChange={(v) => setValues((s) => setPath(s, f.path, v))} />
                  </Box>
                ))}
            </Box>
          </Card>
        ))}
        <Box>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? 'Saving…' : submitLabel}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
}
