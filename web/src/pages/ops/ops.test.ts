import { describe, expect, it } from 'vitest';
import { rowsFromSheet } from './operations';

describe('loading sheet upload', () => {
  it('maps known headers, keeps unknown ones as extra columns and parses numbers', () => {
    const csv = 'LR No.,VEHICLE NO,Own/Market,Charged Weight,Coil ID,Remarks,EWAY No.\nLR-1,MH12AB1234,MKT,"1,200.5",C-9,,241811223344\nLR-2,GJ01AX4589,Own,26,,late,\n';
    const { rows, unmapped } = rowsFromSheet(csv);
    expect(unmapped).toEqual(['Coil ID']);
    expect(rows[0]).toEqual({ lrNo: 'LR-1', vehicleNo: 'MH12AB1234', fleetType: 'market', chargedWeight: 1200.5, ewayBillNo: '241811223344', extra: { 'Coil ID': 'C-9' } });
    expect(rows[1]).toEqual({ lrNo: 'LR-2', vehicleNo: 'GJ01AX4589', fleetType: 'own', chargedWeight: 26, remarks: 'late', extra: {} });
  });
});
