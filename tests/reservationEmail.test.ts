// tests/reservationEmail.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => { delete process.env.RESEND_API_KEY; });

import { sendReservationConfirmationEmail } from '../api/email.js';

describe('sendReservationConfirmationEmail', () => {
  it('skips silently in dev when RESEND_API_KEY is unset', async () => {
    const r = await sendReservationConfirmationEmail({
      customer_name: 'Sara', customer_email: 'sara@example.com',
      type: 'restaurant', res_date: '2026-07-15', res_time: '8:00 PM',
      party_size: 4, sunbeds: 0, checkin_token: 'r_testtoken',
    });
    expect(r.sent).toBe(false);
    expect(r.skipped).toBeTruthy();
  });
});
