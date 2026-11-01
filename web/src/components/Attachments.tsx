import AttachFileIcon from '@mui/icons-material/AttachFile';
import AutoAwesome from '@mui/icons-material/AutoAwesome';
import DeleteOutlined from '@mui/icons-material/DeleteOutlined';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, List, ListItem, ListItemText, Stack, Table, TableBody, TableCell, TableRow, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useRef, useState } from 'react';
import { http } from '../api/http';
import { useAccess } from '../lib/access';
import { errorMessage } from './EntityPage';

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
const ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.pdf,.csv,.xlsx';

export interface Attachment {
  id: number;
  docType: string;
  docId: number;
  filename: string;
  mime: string;
  size: number;
  createdAt: string;
}

const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Browsers report CSV as text/csv or application/vnd.ms-excel; fall back on the extension. */
export function mimeOf(file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'csv') return 'text/csv';
  if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return file.type;
}

/** Checks a file before upload; returns an error message or null. */
export function checkFile(file: { name: string; size: number }, mime: string) {
  if (!ALLOWED_MIME.includes(mime)) return `${file.name}: only images, PDF, CSV and XLSX files can be attached`;
  if (file.size > MAX_ATTACHMENT_BYTES) return `${file.name} is larger than 8 MB`;
  if (!file.size) return `${file.name} is empty`;
  return null;
}

function readBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error ?? new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
}

/** Files attached to one ERP document: list, upload, open and delete. */
/** Lets Claude read an attached scan and suggest field values; the page decides how to apply them. */
export interface AttachmentAi {
  kind: 'compliance' | 'repair_bill';
  /** Label of the apply button, e.g. "Fill document details". Omit to only show the result. */
  applyLabel?: string;
  onApply?: (fields: Record<string, unknown>) => Promise<unknown>;
}

const fieldLabel = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
const fieldValue = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : Array.isArray(v) ? `${v.length} line${v.length === 1 ? '' : 's'}` : String(v));

function ExtractDialog({ fields, ai, onClose }: { fields: Record<string, unknown>; ai: AttachmentAi; onClose: () => void }) {
  const apply = useMutation({ mutationFn: () => ai.onApply!(fields), onSuccess: onClose });
  const lines = Array.isArray(fields.lineItems) ? (fields.lineItems as { description: string; qty: number | null; amount: number | null }[]) : [];
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>What the document says</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Alert severity={fields.confidence === 'high' ? 'success' : 'warning'} icon={<AutoAwesome />}>
            Read by AI with {String(fields.confidence)} confidence. Check each value against the scan before applying.
            {typeof fields.notes === 'string' && fields.notes && <Box sx={{ mt: 0.5 }}>{fields.notes}</Box>}
          </Alert>
          <Table size="small">
            <TableBody>
              {Object.entries(fields).filter(([k]) => !['confidence', 'notes', 'lineItems'].includes(k)).map(([k, v]) => (
                <TableRow key={k}><TableCell sx={{ color: 'text.secondary', width: '40%' }}>{fieldLabel(k)}</TableCell><TableCell>{fieldValue(v)}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
          {lines.length > 0 && (
            <Box>
              <Typography variant="subtitle2">Line items</Typography>
              {lines.map((l, i) => <Typography key={i} variant="body2">{l.description}{l.qty !== null ? ` × ${l.qty}` : ''}{l.amount !== null ? ` · ₹${l.amount.toLocaleString('en-IN')}` : ''}</Typography>)}
            </Box>
          )}
          {apply.isError && <Alert severity="error">{errorMessage(apply.error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        {ai.onApply && <Button variant="contained" disabled={apply.isPending} onClick={() => apply.mutate()}>{ai.applyLabel ?? 'Apply'}</Button>}
      </DialogActions>
    </Dialog>
  );
}

export function Attachments({ docType, docId, ai }: { docType: string; docId: number; ai?: AttachmentAi }) {
  const qc = useQueryClient();
  const access = useAccess();
  const canEdit = access.can(docType, 'edit');
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const key = ['attachments', docType, docId];
  const [extracted, setExtracted] = useState<Record<string, unknown> | null>(null);
  const read = useMutation({
    mutationFn: (attachmentId: number) => http<{ fields: Record<string, unknown> }>('/erp/ai/extract', { method: 'POST', body: JSON.stringify({ attachmentId, kind: ai!.kind }) }),
    onSuccess: (r) => setExtracted(r.fields),
    onError: (e) => setError(errorMessage(e)),
  });
  const list = useQuery({ queryKey: key, queryFn: () => http<Attachment[]>(`/erp/attachments?docType=${docType}&docId=${docId}`) });
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        const mime = mimeOf(file);
        const bad = checkFile(file, mime);
        if (bad) throw new Error(bad);
        await http('/erp/attachments', { method: 'POST', body: JSON.stringify({ docType, docId, filename: file.name, mime, data: await readBase64(file) }) });
      }
    },
    onError: (e) => setError(errorMessage(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => http(`/erp/attachments/${id}`, { method: 'DELETE' }),
    onError: (e) => setError(errorMessage(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  return (
    <Stack spacing={1}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {list.isError && <Alert severity="error">{errorMessage(list.error)}</Alert>}
      <List dense disablePadding>
        {list.data?.length === 0 && <Typography color="text.secondary" variant="body2">No files attached yet.</Typography>}
        {list.data?.map((a) => (
          <ListItem
            key={a.id}
            disableGutters
            divider
            secondaryAction={
              canEdit && (
                <IconButton edge="end" aria-label={`Delete ${a.filename}`} onClick={() => window.confirm(`Delete ${a.filename}?`) && remove.mutate(a.id)}>
                  <DeleteOutlined />
                </IconButton>
              )
            }
          >
            <ListItemText
              primary={
                <a href={`/erp/attachments/${a.id}`} target="_blank" rel="noreferrer">
                  {a.filename}
                </a>
              }
              secondary={
                <>
                  {`${kb(a.size)} · ${dayjs(a.createdAt).format('D MMM YYYY HH:mm')}`}
                  {ai && /^(image\/|application\/pdf)/.test(a.mime) && (
                    <Button size="small" startIcon={read.isPending && read.variables === a.id ? <CircularProgress size={14} /> : <AutoAwesome />} disabled={read.isPending} onClick={() => read.mutate(a.id)} sx={{ ml: 1, py: 0 }}>
                      Read with AI
                    </Button>
                  )}
                </>
              }
            />
          </ListItem>
        ))}
      </List>
      {canEdit && (
        <Box>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            data-testid="attachment-input"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              setError(null);
              if (files.length) upload.mutate(files);
            }}
          />
          <Button size="small" startIcon={<AttachFileIcon />} disabled={upload.isPending} onClick={() => input.current?.click()}>
            {upload.isPending ? 'Uploading…' : 'Attach file'}
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>Images, PDF, CSV or XLSX up to 8 MB</Typography>
        </Box>
      )}
      {extracted && ai && <ExtractDialog fields={extracted} ai={ai} onClose={() => setExtracted(null)} />}
    </Stack>
  );
}

/** Attachments in a dialog, for row actions. */
export function AttachmentsDialog({ title, docType, docId, onClose, note, ai }: { title: string; docType: string; docId: number; onClose: () => void; note?: string; ai?: AttachmentAi }) {
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        {note && <Alert severity="info" sx={{ mb: 2 }}>{note}</Alert>}
        <Attachments docType={docType} docId={docId} ai={ai} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
