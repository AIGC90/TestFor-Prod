import DeleteOutlined from '@mui/icons-material/DeleteOutlined';
import { Alert, Box, Button, Card, CardContent, Checkbox, Chip, IconButton, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { erpAdmin, ROLE_LABEL } from '../../api/erp-admin';
import { errorMessage } from '../../components/EntityPage';

const ACTION_LABEL: Record<string, string> = { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete', approve: 'Approve' };
const humanize = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function DocumentPermissionsPage() {
  const qc = useQueryClient();
  const meta = useQuery({ queryKey: ['erp-meta'], queryFn: erpAdmin.meta });
  const [role, setRole] = useState('');
  const matrix = useQuery({ queryKey: ['permissions', role], queryFn: () => erpAdmin.permissions(role), enabled: Boolean(role) });
  const save = useMutation({
    mutationFn: erpAdmin.setPermission,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['permissions', role] });
      void qc.invalidateQueries({ queryKey: ['access-me'] });
    },
  });
  const modules = [...new Set(Object.values(meta.data?.docTypes ?? {}).map((d) => d.module))];

  function toggle(docType: string, action: string, value: boolean) {
    const current = { ...(matrix.data?.[docType] ?? {}) };
    current[action] = value;
    if (action !== 'view' && value) current.view = true; // any right implies view
    if (action === 'view' && !value) Object.keys(current).forEach((k) => (current[k] = false));
    save.mutate({ role, docType, view: !!current.view, create: !!current.create, edit: !!current.edit, delete: !!current.delete, approve: !!current.approve });
  }

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5">Document Permissions</Typography>
        <Typography color="text.secondary">What each role can do with every type of document. Administrators always have full access.</Typography>
      </Box>
      <TextField select label="Role" value={role} onChange={(e) => setRole(e.target.value)} sx={{ maxWidth: 320 }}>
        {(meta.data?.roles ?? []).map((r) => <MenuItem key={r} value={r}>{ROLE_LABEL[r] ?? r}</MenuItem>)}
      </TextField>
      {!role && <Typography color="text.secondary">Choose a role to view or change its access.</Typography>}
      {save.isError && <Alert severity="error">{errorMessage(save.error)}</Alert>}
      {role && matrix.data && (
        <Card>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Document</TableCell>
                {(meta.data?.actions ?? []).map((a) => <TableCell key={a} align="center" sx={{ fontWeight: 700 }}>{ACTION_LABEL[a] ?? a}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {modules.flatMap((m) => [
                <TableRow key={`m-${m}`}>
                  <TableCell colSpan={6} sx={{ bgcolor: 'action.hover', fontWeight: 700, textTransform: 'uppercase', fontSize: 12, letterSpacing: 0.5 }}>{m}</TableCell>
                </TableRow>,
                ...Object.entries(meta.data!.docTypes)
                  .filter(([, d]) => d.module === m)
                  .map(([key, d]) => (
                    <TableRow key={key} hover>
                      <TableCell>{d.label}</TableCell>
                      {meta.data!.actions.map((a) => (
                        <TableCell key={a} align="center" padding="checkbox">
                          <Checkbox
                            size="small"
                            checked={Boolean(matrix.data[key]?.[a])}
                            disabled={save.isPending}
                            onChange={(e) => toggle(key, a, e.target.checked)}
                            slotProps={{ input: { 'aria-label': `${d.label} ${a}` } }}
                          />
                        </TableCell>
                      ))}
                    </TableRow>
                  )),
              ])}
            </TableBody>
          </Table>
        </Card>
      )}
    </Stack>
  );
}

export function FieldMasksPage() {
  const qc = useQueryClient();
  const meta = useQuery({ queryKey: ['erp-meta'], queryFn: erpAdmin.meta });
  const [docType, setDocType] = useState('');
  const masks = useQuery({ queryKey: ['field-masks', docType], queryFn: () => erpAdmin.masks(docType), enabled: Boolean(docType) });
  const [draft, setDraft] = useState({ role: '', field: '', mode: 'hidden' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['field-masks', docType] });
  const add = useMutation({ mutationFn: erpAdmin.addMask, onSuccess: () => setDraft({ role: '', field: '', mode: 'hidden' }), onSettled: refresh });
  const remove = useMutation({ mutationFn: erpAdmin.removeMask, onSettled: refresh });
  const fields = docType ? (meta.data?.fields[docType] ?? []) : [];
  const withFields = Object.entries(meta.data?.docTypes ?? {}).filter(([k]) => meta.data?.fields[k]?.length);

  return (
    <Stack spacing={2} sx={{ maxWidth: 960 }}>
      <Box>
        <Typography variant="h5">Field Masks</Typography>
        <Typography color="text.secondary">Hide a field from a role, or let them see it but not change it after the document is created.</Typography>
      </Box>
      <TextField select label="Document type" value={docType} onChange={(e) => setDocType(e.target.value)} sx={{ maxWidth: 360 }}>
        {withFields.map(([k, d]) => <MenuItem key={k} value={k}>{d.label}</MenuItem>)}
      </TextField>
      {!docType && <Typography color="text.secondary">Choose a document type to view or configure its field masks.</Typography>}
      {docType && (
        <>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Add a mask</Typography>
              {add.isError && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage(add.error)}</Alert>}
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                <TextField select size="small" label="Role" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} sx={{ minWidth: 220 }}>
                  {(meta.data?.roles ?? []).map((r) => <MenuItem key={r} value={r}>{ROLE_LABEL[r] ?? r}</MenuItem>)}
                </TextField>
                <TextField select size="small" label="Field" value={draft.field} onChange={(e) => setDraft({ ...draft, field: e.target.value })} sx={{ minWidth: 200 }}>
                  {fields.map((f) => <MenuItem key={f} value={f}>{humanize(f)}</MenuItem>)}
                </TextField>
                <TextField select size="small" label="Mode" value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value })} sx={{ minWidth: 160 }}>
                  <MenuItem value="hidden">Hidden</MenuItem>
                  <MenuItem value="readonly">Read-only</MenuItem>
                </TextField>
                <Button variant="contained" disabled={!draft.role || !draft.field || add.isPending} onClick={() => add.mutate({ docType, ...draft })}>Add mask</Button>
              </Stack>
            </CardContent>
          </Card>
          <Card>
            <Table size="small">
              <TableHead>
                <TableRow>{['Role', 'Field', 'Mode', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow>
              </TableHead>
              <TableBody>
                {masks.data?.length === 0 && <TableRow><TableCell colSpan={4}><Typography color="text.secondary">No masks: every role with access sees every field.</Typography></TableCell></TableRow>}
                {masks.data?.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{ROLE_LABEL[m.role] ?? m.role}</TableCell>
                    <TableCell>{humanize(m.field)}</TableCell>
                    <TableCell><Chip size="small" label={m.mode === 'hidden' ? 'Hidden' : 'Read-only'} color={m.mode === 'hidden' ? 'warning' : 'default'} /></TableCell>
                    <TableCell align="right">
                      <IconButton size="small" aria-label="remove mask" onClick={() => remove.mutate(m.id)}><DeleteOutlined fontSize="small" /></IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </Stack>
  );
}
