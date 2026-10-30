import { describe, expect, it } from 'vitest';
import { csvToDevices } from './DeviceBulkUpload';
import { buildIcal, parseIcal } from './entities';

describe('device bulk upload', () => {
  it('maps columns in any order and collects row errors', () => {
    const csv = 'imei,Name,group,operator,expiry\n111,MH-01-AA-1,North,Jio,2027-01-31\n,missing-imei,,,\n222,MH-02-BB-2,,,not-a-date\n';
    const { drafts, errors } = csvToDevices(csv);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({ name: 'MH-01-AA-1', uniqueId: '111', groupName: 'North', attributes: { operator: 'Jio' } });
    expect(drafts[0].expirationTime).toContain('2027-01-3');
    expect(errors).toEqual(['Row 3: name and imei are required', 'Row 4: expiry "not-a-date" is not a date']);
  });

  it('requires name and imei headers', () => {
    expect(csvToDevices('model\nx').errors[0]).toMatch(/name.*imei/);
  });
});

describe('calendar iCal', () => {
  it('round-trips a repeating window', () => {
    const data = buildIcal('2026-11-02T03:30:00.000Z', '2026-11-02T12:30:00.000Z', 'WEEKLY');
    expect(parseIcal(data)).toEqual({ from: '2026-11-02T03:30:00.000Z', to: '2026-11-02T12:30:00.000Z', repeat: 'WEEKLY' });
  });

  it('handles non-repeating and invalid data', () => {
    expect(parseIcal(buildIcal('2026-11-02T03:30:00.000Z', '2026-11-02T04:30:00.000Z', '')).repeat).toBe('');
    expect(parseIcal('%%%')).toEqual({ from: '', to: '', repeat: '' });
  });
});
