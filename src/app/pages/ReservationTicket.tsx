import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { format, parseISO } from 'date-fns';
import { API_BASE, SITE_URL } from '../../lib/apiConfig';

// ── Date/time helpers ─────────────────────────────────────────────────────

/** Format a raw DB date string (e.g. "2026-07-15") into "Wed, Jul 15". */
function prettyDate(d: string): string {
  try { return format(parseISO(d), 'EEE, MMM d'); } catch { return d; }
}

/**
 * Format a time value that may already be a display string ("7:00 PM") or
 * a DB timestamp ("19:00:00"). Falls back to the raw string on any failure.
 */
function prettyTime(t: string): string {
  if (/[APap][Mm]/.test(t)) return t;          // already "7:00 PM"
  const m = t.match(/^(\d{1,2}):(\d{2})/);     // "19:00:00" or "19:00"
  if (!m) return t;
  const h = +m[1]; const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m[2]} ${ampm}`;
}

type Ticket = {
  name: string;
  type: 'beach' | 'restaurant';
  res_date: string;
  res_time: string;
  party_size: number;
  sunbeds: number;
  status: string;
  arrived_at: string | null;
  table_label: string | null;
  payment_amount?: number | null;
  payment_link?: string | null;
};

export default function ReservationTicketPage() {
  const { token } = useParams<{ token: string }>();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!token) { setError('Ticket not found'); return; }
    const controller = new AbortController();
    fetch(`${API_BASE}/api/reservation-ticket?token=${encodeURIComponent(token)}`, { signal: controller.signal })
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: Ticket) => setTicket(data))
      .catch((err) => { if (err?.name !== 'AbortError') setError('Ticket not found'); });
    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    // Only draw when the QR view is actually rendered (confirmed/arrived).
    // On pending/declined screens the canvas is not mounted, so skip.
    const showQR = ticket?.status === 'confirmed' || ticket?.status === 'arrived';
    if (ticket && showQR && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, `${SITE_URL}/r/${token}`, { width: 240, margin: 2 })
        .catch(() => setError('Ticket not found'));
    }
  }, [ticket, token]);

  function download() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `mazi-reservation-${token}.png`;
    a.click();
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#f6f2e8] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <h1 className="font-montserrat font-bold text-2xl text-gray-800 mb-2">
            Ticket Not Found
          </h1>
          <p className="text-gray-500 mb-6">
            We couldn't find a reservation with this link. It may have expired or the link is incomplete.
          </p>
          <Link
            to="/reserve"
            className="inline-flex items-center gap-2 text-[#12207e] font-semibold hover:underline"
          >
            Make a Reservation
          </Link>
        </div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="min-h-screen bg-[#f6f2e8] flex items-center justify-center">
        <p className="font-montserrat text-gray-600 text-lg">Loading…</p>
      </div>
    );
  }

  const arrived = ticket.status === 'arrived';
  const showQR = ticket.status === 'confirmed' || ticket.status === 'arrived';

  // Truthful badge for the QR-ticket view (confirmed/arrived/completed/no_show).
  const statusLabel =
    ticket.status === 'arrived'
      ? `Checked in ✓${ticket.table_label ? ` · ${ticket.table_label}` : ''}`
      : ticket.status === 'confirmed'
      ? 'Confirmed'
      : ticket.status === 'completed'
      ? 'Completed'
      : ticket.status === 'no_show'
      ? 'No-show'
      : ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1);
  const statusColor = arrived ? '#22319a' : '#666666';

  const partyLine =
    ticket.type === 'beach'
      ? `${ticket.sunbeds} sunbed(s)`
      : `Party of ${ticket.party_size}`;

  // ── Pending: awaiting admin confirmation — booking details, no QR ──────────
  if (ticket.status === 'pending') {
    return (
      <div className="min-h-screen bg-[#f6f2e8] flex flex-col items-center justify-center px-4 py-10">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-sm w-full text-center">
          {/* Branding */}
          <img
            src="/mazi-logo-full.png"
            alt="Mazi"
            className="h-14 w-auto mx-auto mb-1"
            style={{ maxWidth: '100%' }}
          />
          <p className="text-gray-400 text-xs uppercase tracking-widest mb-6">Reservation Request</p>

          {/* Pending badge */}
          <div className="text-sm font-semibold mb-4" style={{ color: '#b45309' }}>
            Reservation Pending — awaiting confirmation
          </div>

          {/* Booking details */}
          <p className="font-montserrat text-gray-800 text-base mb-1">
            Reservation for <strong>{ticket.name}</strong>
          </p>
          <p className="text-gray-500 text-sm mb-6">
            {prettyDate(ticket.res_date)} · {prettyTime(ticket.res_time)} · {partyLine}
          </p>

          <p className="text-gray-500 text-sm">
            Your booking is not confirmed yet. Once we confirm it, your QR check-in
            ticket will be emailed to you.
          </p>
        </div>
      </div>
    );
  }

  // ── Awaiting payment: payment-pending screen with Pay now, no QR ───────────
  if (ticket.status === 'awaiting_payment') {
    return (
      <div className="min-h-screen bg-[#f6f2e8] flex flex-col items-center justify-center px-4 py-10">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-sm w-full text-center">
          {/* Branding */}
          <img
            src="/mazi-logo-full.png"
            alt="Mazi"
            className="h-14 w-auto mx-auto mb-1"
            style={{ maxWidth: '100%' }}
          />
          <p className="text-gray-400 text-xs uppercase tracking-widest mb-6">Reservation Request</p>

          {/* Payment pending badge */}
          <div className="text-sm font-semibold mb-4" style={{ color: '#b45309' }}>
            Payment Pending
          </div>

          {/* Booking details */}
          <p className="font-montserrat text-gray-800 text-base mb-1">
            Reservation for <strong>{ticket.name}</strong>
          </p>
          <p className="text-gray-500 text-sm mb-6">
            {prettyDate(ticket.res_date)} · {prettyTime(ticket.res_time)} · {partyLine}
          </p>

          {/* Amount due */}
          {ticket.payment_amount != null && (
            <div className="mb-6">
              <p className="text-gray-400 text-xs uppercase tracking-widest mb-1">Amount Due</p>
              <p className="font-montserrat font-bold text-2xl text-gray-800">
                EGP {Number.isFinite(Number(ticket.payment_amount)) ? Number(ticket.payment_amount).toLocaleString('en-US') : ticket.payment_amount}
              </p>
            </div>
          )}

          <p className="text-gray-500 text-sm mb-6">
            Your booking is approved. Complete the payment to secure your reservation —
            your QR check-in ticket will be emailed once payment is confirmed.
          </p>

          {/* Pay now button */}
          {ticket.payment_link && (
            <a
              href={ticket.payment_link}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full font-montserrat font-semibold text-white rounded-xl py-3 px-6 transition-opacity hover:opacity-90"
              style={{ background: '#12207e' }}
            >
              Pay now
            </a>
          )}
        </div>
      </div>
    );
  }

  // ── Declined / cancelled: clear message, no QR ─────────────────────────────
  if (ticket.status === 'declined' || ticket.status === 'cancelled') {
    const wasCancelled = ticket.status === 'cancelled';
    return (
      <div className="min-h-screen bg-[#f6f2e8] flex flex-col items-center justify-center px-4 py-10">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-sm w-full text-center">
          {/* Branding */}
          <img
            src="/mazi-logo-full.png"
            alt="Mazi"
            className="h-14 w-auto mx-auto mb-1"
            style={{ maxWidth: '100%' }}
          />
          <p className="text-gray-400 text-xs uppercase tracking-widest mb-6">Reservation Ticket</p>

          <h2 className="font-montserrat font-bold text-xl text-gray-800 mb-2">
            {wasCancelled ? 'This reservation was cancelled' : 'This reservation was not confirmed'}
          </h2>
          <p className="text-gray-500 text-sm mb-6">
            {wasCancelled
              ? 'This booking has been cancelled, so there is no check-in ticket.'
              : 'This booking was not confirmed, so there is no check-in ticket.'}
          </p>
          <Link
            to="/reserve"
            className="inline-flex items-center gap-2 text-[#12207e] font-semibold hover:underline"
          >
            Make a Reservation
          </Link>
        </div>
      </div>
    );
  }

  // ── Confirmed / arrived: full QR ticket ────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#f6f2e8] flex flex-col items-center justify-center px-4 py-10">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-sm w-full text-center">
        {/* Branding */}
        <img
          src="/mazi-logo-full.png"
          alt="Mazi"
          className="h-14 w-auto mx-auto mb-1"
          style={{ maxWidth: '100%' }}
        />
        <p className="text-gray-400 text-xs uppercase tracking-widest mb-6">Reservation Ticket</p>

        {/* Booking details */}
        <p className="font-montserrat text-gray-800 text-base mb-1">
          Reservation for <strong>{ticket.name}</strong>
        </p>
        <p className="text-gray-500 text-sm mb-6">
          {prettyDate(ticket.res_date)} · {prettyTime(ticket.res_time)} · {partyLine}
        </p>

        {/* QR code canvas */}
        {showQR && (
          <div className="flex justify-center mb-4">
            <canvas
              ref={canvasRef}
              role="img"
              aria-label="Reservation QR code"
              className="rounded-lg"
            />
          </div>
        )}

        {/* Live status badge */}
        <div
          className="text-sm font-semibold mb-6"
          style={{ color: statusColor }}
        >
          {statusLabel}
        </div>

        {/* Download button */}
        {showQR && (
          <button
            onClick={download}
            className="w-full font-montserrat font-semibold text-white rounded-xl py-3 px-6 transition-opacity hover:opacity-90"
            style={{ background: '#12207e' }}
          >
            Download Ticket
          </button>
        )}
      </div>
    </div>
  );
}
