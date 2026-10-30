import { MenuItem, Stack, TextField } from '@mui/material';
import dayjs from 'dayjs';

export type PeriodKey = 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'last7' | 'custom';

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  thisWeek: 'This week',
  lastWeek: 'Previous week',
  thisMonth: 'This month',
  last7: 'Last 7 days',
  custom: 'Custom',
};

export interface Period {
  key: PeriodKey;
  from: string; // ISO
  to: string; // ISO
}

/** Resolves a named period to an ISO range; custom keeps the given bounds. */
export function resolvePeriod(key: PeriodKey, custom?: { from: string; to: string }): Period {
  const now = dayjs();
  const range = (f: dayjs.Dayjs, t: dayjs.Dayjs) => ({ key, from: f.toISOString(), to: t.toISOString() });
  switch (key) {
    case 'today':
      return range(now.startOf('day'), now.endOf('day'));
    case 'yesterday':
      return range(now.subtract(1, 'day').startOf('day'), now.subtract(1, 'day').endOf('day'));
    case 'thisWeek':
      return range(now.startOf('week'), now.endOf('week'));
    case 'lastWeek':
      return range(now.subtract(1, 'week').startOf('week'), now.subtract(1, 'week').endOf('week'));
    case 'thisMonth':
      return range(now.startOf('month'), now.endOf('month'));
    case 'last7':
      return range(now.subtract(6, 'day').startOf('day'), now.endOf('day'));
    case 'custom':
      return { key, from: custom?.from ?? now.startOf('day').toISOString(), to: custom?.to ?? now.toISOString() };
  }
}

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const local = (iso: string) => dayjs(iso).format('YYYY-MM-DDTHH:mm');
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
      <TextField
        select
        size="small"
        label="Period"
        value={value.key}
        onChange={(e) => onChange(resolvePeriod(e.target.value as PeriodKey, value))}
        sx={{ minWidth: 150 }}
      >
        {(Object.keys(PERIOD_LABEL) as PeriodKey[]).map((k) => (
          <MenuItem key={k} value={k}>
            {PERIOD_LABEL[k]}
          </MenuItem>
        ))}
      </TextField>
      {value.key === 'custom' && (
        <>
          <TextField
            size="small"
            type="datetime-local"
            label="From"
            value={local(value.from)}
            onChange={(e) => onChange({ ...value, from: dayjs(e.target.value).toISOString() })}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            size="small"
            type="datetime-local"
            label="To"
            value={local(value.to)}
            onChange={(e) => onChange({ ...value, to: dayjs(e.target.value).toISOString() })}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </>
      )}
    </Stack>
  );
}
