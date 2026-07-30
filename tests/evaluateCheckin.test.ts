// tests/evaluateCheckin.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateCheckin } from '../api/_lib/evaluateCheckin.js';

const base = { res_date: '2026-07-15', status: 'confirmed', arrived_at: null, table_id: null };

describe('evaluateCheckin', () => {
  it('rejects unknown token', () => {
    expect(evaluateCheckin(null, { today: '2026-07-15', tableId: 't1' }))
      .toEqual({ state: 'invalid', reason: 'not_found' });
  });
  it('rejects wrong day', () => {
    expect(evaluateCheckin(base, { today: '2026-07-16', tableId: 't1' }).reason).toBe('wrong_day');
  });
  it('accepts check-in without a table (table is optional)', () => {
    expect(evaluateCheckin(base, { today: '2026-07-15', tableId: '' })).toEqual({ state: 'ok' });
  });
  it('reports already-arrived', () => {
    const arrived = { ...base, status: 'arrived', arrived_at: '2026-07-15T18:42:00Z', table_id: 'D12' };
    const r = evaluateCheckin(arrived, { today: '2026-07-15', tableId: 't1' });
    expect(r.state).toBe('already');
    expect(r.arrived_at).toBe('2026-07-15T18:42:00Z');
    expect(r.table_id).toBe('D12');
  });
  it('returns wrong_day (not already) for a yesterday-dated reservation whose status is arrived', () => {
    const arrivedYesterday = { ...base, res_date: '2026-07-14', status: 'arrived', arrived_at: '2026-07-14T18:00:00Z', table_id: 'D12' };
    const r = evaluateCheckin(arrivedYesterday, { today: '2026-07-15', tableId: 't1' });
    expect(r.state).toBe('invalid');
    expect(r.reason).toBe('wrong_day');
  });
  it('rejects a same-day declined reservation', () => {
    const declined = { ...base, status: 'declined' };
    expect(evaluateCheckin(declined, { today: '2026-07-15', tableId: 't1' }))
      .toEqual({ state: 'invalid', reason: 'not_checkinable' });
  });
  it('accepts a valid same-day check-in', () => {
    expect(evaluateCheckin(base, { today: '2026-07-15', tableId: 't1' })).toEqual({ state: 'ok' });
  });
});
