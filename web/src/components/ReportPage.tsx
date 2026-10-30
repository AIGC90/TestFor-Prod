import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { http, qs } from '../api/http';
import { useDevices, useGroups } from '../lib/live';
import { errorMessage } from './EntityPage';
import { FleetMap, type MapLine, type MapPoint } from './FleetMap';
import { type Period, PeriodPicker, resolvePeriod } from './PeriodPicker';

export interface ReportColumn<R> {
  label: string;
  render: (row: R) => ReactNode;
  /** Value used for sorting; defaults to the rendered value when primitive. */
  sort?: (row: R) => string | number;
}

export interface ReportFilters {
  deviceIds: number[];
  groupIds: number[];
  from: string;
  to: string;
  extra: Record<string, unknown>;
}

export interface ReportConfig<R> {
  title: string;
  description?: string;
  /** Traccar report path under /api/reports (enables Excel export), or a custom loader. */
  endpoint?: string;
  load?: (f: ReportFilters) => Promise<R[]>;
  columns: ReportColumn<R>[];
  /** 'devices' needs at least one vehicle or group; 'none' hides the vehicle filters. */
  scope?: 'devices' | 'none';
  /** Extra query params for the endpoint (e.g. daily summary, event types). */
  params?: (f: ReportFilters) => Record<string, string | number | boolean | (string | number)[] | undefined>;
  extraFilters?: (value: Record<string, unknown>, set: (v: Record<string, unknown>) => void) => ReactNode;
  /** Optional map of the result (or of the selected row). */
  map?: (rows: R[], selected: R | null) => { lines?: MapLine[]; points?: MapPoint[] };
  /** Content above the table, e.g. KPI cards or a chart. */
  header?: (rows: R[]) => ReactNode;
  rowKey?: (row: R, index: number) => string | number;
}

export function ReportPage<R>({ config }: { config: ReportConfig<R> }) {
  const [params] = useSearchParams();
  const devices = useDevices();
  const groups = useGroups();
  const scope = config.scope ?? 'devices';
  const [deviceIds, setDeviceIds] = useState<number[]>(() => (params.get('device') ? [Number(params.get('device'))] : []));
  const [groupIds, setGroupIds] = useState<number[]>([]);
  const [period, setPeriod] = useState<Period>(() => resolvePeriod('today'));
  const [extra, setExtra] = useState<Record<string, unknown>>({});
  const [request, setRequest] = useState<ReportFilters | null>(() =>
    params.get('device') ? { deviceIds: [Number(params.get('device'))], groupIds: [], from: period.from, to: period.to, extra: {} } : null,
  );
  const [sort, setSort] = useState<{ col: number; dir: 'asc' | 'desc' } | null>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [selected, setSelected] = useState<R | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const query = (f: ReportFilters) => qs({ deviceId: f.deviceIds, groupId: f.groupIds, from: f.from, to: f.to, ...(config.params?.(f) ?? {}) });
  const result = useQuery({
    queryKey: ['report', config.title, request],
    queryFn: () => (config.load ? config.load(request!) : http<R[]>(`/api/reports/${config.endpoint}?${query(request!)}`)),
    enabled: request !== null,
  });

  const rows = useMemo(() => {
    const list = result.data ?? [];
    if (!sort) return list;
    const col = config.columns[sort.col];
    const key = (r: R) => {
      if (col.sort) return col.sort(r);
      const v = col.render(r);
      return typeof v === 'number' || typeof v === 'string' ? v : '';
    };
    return [...list].sort((a, b) => {
      const [x, y] = [key(a), key(b)];
      const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [result.data, sort, config.columns]);

  const canRun = scope === 'none' || deviceIds.length > 0 || groupIds.length > 0;
  const run = () => {
    setSelected(null);
    setPage(0);
    setRequest({ deviceIds, groupIds, from: period.from, to: period.to, extra });
  };

  async function exportXlsx() {
    if (!request || !config.endpoint) return;
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch(`/api/reports/${config.endpoint}/xlsx?${query(request)}`, {
        credentials: 'include',
        headers: { Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${config.endpoint}-report.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  const mapData = config.map && rows.length ? config.map(rows, selected) : null;

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5">{config.title}</Typography>
        {config.description && <Typography color="text.secondary">{config.description}</Typography>}
      </Box>
      <Card>
        <CardContent>
          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} sx={{ alignItems: { lg: 'center' }, flexWrap: 'wrap' }}>
            {scope === 'devices' && (
              <>
                <Autocomplete
                  multiple
                  size="small"
                  limitTags={2}
                  sx={{ minWidth: 260, flexGrow: 1, maxWidth: 420 }}
                  options={devices.data ?? []}
                  getOptionLabel={(d) => d.name}
                  value={(devices.data ?? []).filter((d) => deviceIds.includes(d.id))}
                  onChange={(_, list) => setDeviceIds(list.map((d) => d.id))}
                  disableCloseOnSelect
                  renderOption={(props, d, { selected: sel }) => (
                    <li {...props} key={d.id}>
                      <Checkbox size="small" checked={sel} sx={{ mr: 1 }} />
                      {d.name}
                    </li>
                  )}
                  renderInput={(p) => <TextField {...p} label="Vehicles" placeholder={deviceIds.length ? '' : 'All in selected groups'} />}
                />
                <Autocomplete
                  multiple
                  size="small"
                  limitTags={1}
                  sx={{ minWidth: 200 }}
                  options={groups.data ?? []}
                  getOptionLabel={(g) => g.name}
                  value={(groups.data ?? []).filter((g) => groupIds.includes(g.id))}
                  onChange={(_, list) => setGroupIds(list.map((g) => g.id))}
                  renderInput={(p) => <TextField {...p} label="Groups" />}
                />
              </>
            )}
            <PeriodPicker value={period} onChange={setPeriod} />
            {config.extraFilters?.(extra, setExtra)}
            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={run} disabled={!canRun}>Show</Button>
              {config.endpoint && (
                <Button variant="outlined" startIcon={<FileDownloadOutlined />} onClick={() => void exportXlsx()} disabled={!request || exporting}>
                  Excel
                </Button>
              )}
            </Stack>
          </Stack>
          {!canRun && <Typography variant="caption" color="text.secondary">Choose at least one vehicle or group.</Typography>}
        </CardContent>
      </Card>

      {result.isError && <Alert severity="error">{errorMessage(result.error)}</Alert>}
      {exportError && <Alert severity="error">{exportError}</Alert>}
      {config.header && result.data && config.header(rows)}

      {mapData && (
        <Box sx={{ height: 380 }}>
          <FleetMap lines={mapData.lines} points={mapData.points} fitToLines={Boolean(mapData.lines?.length)} fitToPoints={!mapData.lines?.length} />
        </Box>
      )}

      {request && (
        <Card>
          <TableContainer sx={{ maxHeight: 640 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {config.columns.map((c, i) => (
                    <TableCell key={c.label} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                      <TableSortLabel
                        active={sort?.col === i}
                        direction={sort?.col === i ? sort.dir : 'asc'}
                        onClick={() => setSort((s) => ({ col: i, dir: s?.col === i && s.dir === 'asc' ? 'desc' : 'asc' }))}
                      >
                        {c.label}
                      </TableSortLabel>
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {result.isLoading && <TableRow><TableCell colSpan={config.columns.length}>Loading…</TableCell></TableRow>}
                {result.isSuccess && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={config.columns.length}>
                      <Typography color="text.secondary" sx={{ py: 2 }}>No data for this selection. Try a wider period.</Typography>
                    </TableCell>
                  </TableRow>
                )}
                {rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage).map((r, i) => (
                  <TableRow
                    key={config.rowKey ? config.rowKey(r, i) : i}
                    hover
                    selected={selected === r}
                    onClick={() => config.map && setSelected(r)}
                    sx={{ cursor: config.map ? 'pointer' : undefined }}
                  >
                    {config.columns.map((c) => <TableCell key={c.label}>{c.render(r)}</TableCell>)}
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
            rowsPerPageOptions={[50, 100, 500]}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(Number(e.target.value));
              setPage(0);
            }}
          />
        </Card>
      )}
    </Stack>
  );
}
