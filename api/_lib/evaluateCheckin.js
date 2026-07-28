// api/_lib/evaluateCheckin.js
/**
 * Decide what a check-in scan should do. Pure — no I/O.
 * @param reservation row or null (null = token not found)
 * @param ctx { today: 'YYYY-MM-DD' (venue-local), tableId: string }
 */
export function evaluateCheckin(reservation, { today, tableId }) {
  if (!reservation) return { state: 'invalid', reason: 'not_found' };
  if (reservation.res_date !== today) return { state: 'invalid', reason: 'wrong_day' };
  if (['declined', 'cancelled', 'no_show'].includes(reservation.status))
    return { state: 'invalid', reason: 'not_checkinable' };
  if (reservation.status === 'arrived') {
    return { state: 'already', arrived_at: reservation.arrived_at, table_id: reservation.table_id };
  }
  if (!tableId) return { state: 'invalid', reason: 'no_table' };
  return { state: 'ok' };
}
