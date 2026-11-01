import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';
import { tollRowsFromCsv } from './fastag';
import { presetRange } from './revenue';

describe('FASTag statement import', () => {
  it('maps common bank headers, dates and amounts', () => {
    const csv = 'Transaction ID,Reader Read Time,Plaza Name,Vehicle Number,Txn Amount,Closing Balance,Txn Type,Branch\n' +
      'T1,"12-10-2026 14:05:09",Kishangarh Toll Plaza,RJ14GC6789,"₹ 395.00","1,105.00",Debit,X\n' +
      'T2,13/10/2026 09:00,Wallet,RJ14GC6789,5000,6105,Recharge,X\n';
    const { rows, unmapped } = tollRowsFromCsv(csv);
    expect(unmapped).toEqual(['Branch']);
    expect(rows[0]).toMatchObject({ txnRef: 'T1', plaza: 'Kishangarh Toll Plaza', vehicleNo: 'RJ14GC6789', amount: 395, balanceAfter: 1105, kind: 'toll' });
    expect(dayjs(rows[0].at as string).format('YYYY-MM-DD HH:mm:ss')).toBe('2026-10-12 14:05:09');
    expect(rows[1]).toMatchObject({ kind: 'recharge', amount: 5000 });
  });
});

describe('revenue periods', () => {
  it('starts the financial year on 1 April', () => {
    expect(dayjs(presetRange('fy', dayjs('2026-11-01T10:00:00')).from).format('YYYY-MM-DD')).toBe('2026-04-01');
    expect(dayjs(presetRange('fy', dayjs('2027-02-10T10:00:00')).from).format('YYYY-MM-DD')).toBe('2026-04-01');
    expect(dayjs(presetRange('month', dayjs('2026-11-15T10:00:00')).from).format('YYYY-MM-DD')).toBe('2026-11-01');
  });
});
