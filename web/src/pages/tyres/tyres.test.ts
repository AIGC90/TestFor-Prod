import { describe, expect, it } from 'vitest';
import { axles } from './tyres';

describe('tyre axle layout', () => {
  it('groups positions into axles with outer tyres on the outside', () => {
    const rows = axles(['FL', 'FR', 'D1LO', 'D1LI', 'D1RI', 'D1RO', 'D2LI', 'D2LO', 'D2RO', 'D2RI', 'SPARE']);
    expect(rows).toEqual([
      { axle: 'F', name: 'Steer', left: ['FL'], right: ['FR'] },
      { axle: 'D1', name: 'Drive 1', left: ['D1LO', 'D1LI'], right: ['D1RI', 'D1RO'] },
      { axle: 'D2', name: 'Drive 2', left: ['D2LO', 'D2LI'], right: ['D2RI', 'D2RO'] },
    ]);
  });

  it('handles the 6-wheel rear axle and the second steer axle', () => {
    expect(axles(['FL', 'FR', 'F2L', 'F2R', 'RLO', 'RLI', 'RRI', 'RRO']).map((a) => [a.name, a.left, a.right])).toEqual([
      ['Steer', ['FL'], ['FR']],
      ['Second steer', ['F2L'], ['F2R']],
      ['Rear', ['RLO', 'RLI'], ['RRI', 'RRO']],
    ]);
  });
});
