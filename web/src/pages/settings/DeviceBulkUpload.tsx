import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Link, List, ListItem, ListItemText, Typography } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useRef, useState } from 'react';
import { http } from '../../api/http';
import type { Group } from '../../api/traccar';
import { errorMessage } from '../../components/EntityPage';
import { downloadCsv, parseCsv } from '../../lib/csv';

export const TEMPLATE_HEADER = ['name', 'imei', 'model', 'category', 'group', 'phone', 'operator', 'customer', 'sellType', 'expiry'];

export interface DeviceDraft {
  name: string;
  uniqueId: string;
  model?: string;
  category?: string;
  groupName?: string;
  phone?: string;
  expirationTime?: string;
  attributes: Record<string, string>;
}

/** Maps CSV rows (first row = header, any column order) to device drafts and row errors. */
export function csvToDevices(text: string): { drafts: DeviceDraft[]; errors: string[] } {
  const [header = [], ...rows] = parseCsv(text);
  const idx = (k: string) => header.findIndex((h) => h.trim().toLowerCase() === k.toLowerCase());
  const col = (row: string[], k: string) => {
    const i = idx(k);
    return i >= 0 ? row[i]?.trim() || undefined : undefined;
  };
  const errors: string[] = [];
  if (idx('name') < 0 || idx('imei') < 0) return { drafts: [], errors: ['The header must include at least "name" and "imei" columns.'] };
  const drafts: DeviceDraft[] = [];
  rows.forEach((row, i) => {
    const name = col(row, 'name');
    const imei = col(row, 'imei');
    if (!name || !imei) {
      errors.push(`Row ${i + 2}: name and imei are required`);
      return;
    }
    const expiry = col(row, 'expiry');
    if (expiry && !dayjs(expiry).isValid()) errors.push(`Row ${i + 2}: expiry "${expiry}" is not a date`);
    const attributes: Record<string, string> = {};
    for (const k of ['operator', 'customer', 'sellType']) {
      const v = col(row, k);
      if (v) attributes[k] = v;
    }
    drafts.push({
      name,
      uniqueId: imei,
      model: col(row, 'model'),
      category: col(row, 'category')?.toLowerCase(),
      groupName: col(row, 'group'),
      phone: col(row, 'phone'),
      expirationTime: expiry && dayjs(expiry).isValid() ? dayjs(expiry).toISOString() : undefined,
      attributes,
    });
  });
  return { drafts, errors };
}

export function DeviceBulkUpload() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<{ drafts: DeviceDraft[]; errors: string[] } | null>(null);
  const [results, setResults] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload() {
    if (!parsed) return;
    setBusy(true);
    const groups = await http<Group[]>('/api/groups');
    const byName = new Map(groups.map((g) => [g.name.toLowerCase(), g.id]));
    const out: string[] = [];
    for (const d of parsed.drafts) {
      const { groupName, ...device } = d;
      try {
        await http('/api/devices', {
          method: 'POST',
          body: JSON.stringify({ ...device, groupId: groupName ? (byName.get(groupName.toLowerCase()) ?? 0) : 0 }),
        });
        out.push(`✓ ${d.name}`);
      } catch (e) {
        out.push(`✗ ${d.name}: ${errorMessage(e)}`);
      }
    }
    setResults(out);
    setBusy(false);
    void qc.invalidateQueries({ queryKey: ['devices'] });
  }

  const close = () => {
    setParsed(null);
    setResults(null);
    if (input.current) input.current.value = '';
  };

  return (
    <>
      <Button variant="outlined" startIcon={<UploadFileOutlined />} onClick={() => input.current?.click()}>
        Bulk upload
      </Button>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) setParsed(csvToDevices(await file.text()));
        }}
      />
      <Dialog open={Boolean(parsed)} onClose={close} maxWidth="sm" fullWidth>
        <DialogTitle>Bulk upload devices</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Columns: {TEMPLATE_HEADER.join(', ')}.{' '}
            <Link component="button" onClick={() => downloadCsv('devices-template.csv', [TEMPLATE_HEADER, ['MH-12-AB-1234', '867010075160001', 'Tata Signa 4825.TK', 'truck', 'Western Corridor Freightways', '+919800000000', 'Airtel', 'Acme Logistics', 'rent', '2027-03-31']])}>
              Download template
            </Link>
          </Typography>
          {parsed?.errors.map((e) => <Alert key={e} severity="warning" sx={{ mb: 1 }}>{e}</Alert>)}
          {!results && <Typography>{parsed?.drafts.length ?? 0} devices ready to create.</Typography>}
          {results && (
            <List dense>
              {results.map((r) => <ListItem key={r} disableGutters><ListItemText primary={r} /></ListItem>)}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>{results ? 'Close' : 'Cancel'}</Button>
          {!results && (
            <Button variant="contained" disabled={busy || !parsed?.drafts.length} onClick={() => void upload()}>
              {busy ? 'Uploading…' : `Create ${parsed?.drafts.length ?? 0} devices`}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}
