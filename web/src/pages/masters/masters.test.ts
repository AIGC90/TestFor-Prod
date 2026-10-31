import { describe, expect, it } from 'vitest';
import { type Category, categoryPath, effective } from './ItemMasterPage';

const cat = (id: number, parentId: number | null, extra: Partial<Category> = {}): Category => ({
  id, parentId, name: `C${id}`, level: 1, unit: null, gstRate: null, hsn: null, countingMode: null, ...extra,
});
const byId = new Map([
  [1, cat(1, null, { unit: 'pcs', gstRate: 28, hsn: '401120', countingMode: 'serial' })],
  [2, cat(2, 1, { unit: 'tyres' })],
  [3, cat(3, 2)],
]);

describe('item master inheritance', () => {
  it('takes the nearest value up the category chain', () => {
    expect(effective({ categoryId: 3, unit: null, gstRate: null, hsn: null, countingMode: null }, byId)).toEqual({
      unit: 'tyres', gstRate: 28, hsn: '401120', countingMode: 'serial',
    });
  });

  it('prefers the item’s own values', () => {
    expect(effective({ categoryId: 3, unit: 'sets', gstRate: 18, hsn: null, countingMode: 'standard' }, byId)).toMatchObject({
      unit: 'sets', gstRate: 18, hsn: '401120', countingMode: 'standard',
    });
  });

  it('builds the category path', () => {
    expect(categoryPath(3, byId)).toBe('C1 › C2 › C3');
  });
});
