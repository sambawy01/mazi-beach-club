import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { API_BASE } from '../../../lib/apiConfig';
import { getStoredPassword } from '../../../services/adminService';
import { supabase } from '../../../lib/supabase';
import { SearchableSelect } from './SearchableSelect';

// ── Types ─────────────────────────────────────────────────────────────────

type TableRow = { id: string; label: string; zone: string };

type ReservationInfo = {
  id: string; customer_name: string; type: string; res_date: string;
  res_time: string; party_size: number; sunbeds: number; status: string;
  arrived_at: string | null; table_id: string | null;
};

// Non-mutating lookup shown the instant a QR is scanned.
type Preview = {
  state: 'ok' | 'already' | 'invalid';
  reason?: string;
  arrived_at?: string;
  reservation: ReservationInfo | null;
  table_label: string | null;
};

type Result =
  | { state: 'ok'; table_label: string | null; reservation: ReservationInfo }
  | { state: 'already'; arrived_at: string; table_id: string | null }
  | { state: 'invalid'; reason: string };

// ── Helpers ───────────────────────────────────────────────────────────────

/** Extract the reservation token from a QR URL or bare token string. */
function tokenFromScan(text: string): string {
  const m = text.match(/\/r\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : text.trim();
}

/** Human-readable message for a preview/check-in failure reason. */
function reasonLabel(reason?: string): string {
  switch (reason) {
    case 'not_found': return 'No reservation matches this code.';
    case 'wrong_day': return "This reservation isn't for today.";
    case 'not_checkinable': return 'This reservation was cancelled or declined.';
    case 'network_error': return 'Network error — please try again.';
    case 'server_401': return 'Session expired — please re-login via /admin.';
    default: return reason ? reason.replace(/_/g, ' ') : 'Could not verify this code.';
  }
}

/** One-line party summary: "Party of 4" or "3 sunbeds" for beach. */
function partySummary(r: ReservationInfo): string {
  return r.type === 'beach'
    ? `${r.sunbeds} sunbed${r.sunbeds === 1 ? '' : 's'}`
    : `Party of ${r.party_size}`;
}

/** Group an array of tables by zone, returning zone keys in a stable order. */
function groupByZone(tables: TableRow[]): Record<string, TableRow[]> {
  const order = ['dining', 'bar', 'daybed'];
  const map: Record<string, TableRow[]> = {};
  for (const t of tables) {
    if (!map[t.zone]) map[t.zone] = [];
    map[t.zone].push(t);
  }
  // Sort keys: known zones first, then any unknowns alphabetically
  const knownFirst = order.filter(z => map[z]);
  const unknowns = Object.keys(map)
    .filter(z => !order.includes(z))
    .sort();
  return Object.fromEntries([...knownFirst, ...unknowns].map(z => [z, map[z]]));
}

// ── Gate wrapper ──────────────────────────────────────────────────────────

/**
 * Renders a "please log in via /admin first" message when no password is
 * stored. AdminLogin's full prop surface (AdminLang) is heavy to wire here;
 * the simple message+link fallback is cleaner for a standalone route.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const pw = getStoredPassword();
  if (!pw) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f6f2e8] px-4">
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-4">🔒</div>
          <h2 className="text-xl font-bold text-[#1b2350] mb-2">Admin login required</h2>
          <p className="text-sm text-muted-foreground mb-6">
            You must be signed in to the admin panel to access the door scanner.
          </p>
          <a
            href="/admin"
            className="inline-block px-6 py-2.5 rounded-lg text-sm font-medium text-white"
            style={{ background: '#12207e' }}
          >
            Go to Admin Login
          </a>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

// ── Main scanner component ────────────────────────────────────────────────

function Scanner() {
  const [scanned, setScanned] = useState('');
  const [manual, setManual] = useState('');
  const [tableId, setTableId] = useState('');
  const [tables, setTables] = useState<TableRow[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [camError, setCamError] = useState('');
  const [tablesError, setTablesError] = useState('');
  const scannerRef = useRef<Html5Qrcode | null>(null);

  // Fetch active tables from Supabase
  useEffect(() => {
    supabase
      .from('tables')
      .select('id,label,zone')
      .eq('is_active', true)
      .then(({ data, error }) => {
        if (error) setTablesError('Could not load tables — check connection.');
        else setTables(data || []);
      });
  }, []);

  // Initialise QR scanner
  useEffect(() => {
    let cancelled = false;
    const scanner = new Html5Qrcode('qr-reader');
    scannerRef.current = scanner;

    const startPromise = scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 250 },
        (text) => {
          if (!cancelled) {
            setScanned(tokenFromScan(text));
            // Pause after a successful scan so the UI reflects the result
            scanner.pause(true);
          }
        },
        // Per-frame error callback — intentionally silent
        () => {},
      )
      .catch((err: unknown) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setCamError(msg || 'Camera access denied or unavailable.');
        }
      });

    return () => {
      cancelled = true;
      // Wait for start() to settle before stopping, so we never stop a
      // not-yet-running scanner and never orphan a stream that goes live
      // after unmount (camera hardware leak on mobile).
      startPromise.finally(() => { scanner.stop().catch(() => {}); });
    };
  }, []);

  // Build table options grouped by zone for SearchableSelect
  const grouped = groupByZone(tables);
  const tableOptions = Object.entries(grouped).flatMap(([zone, rows]) =>
    rows.map(t => ({
      value: t.id,
      label: `${zone.charAt(0).toUpperCase() + zone.slice(1)} · ${t.label}`,
    })),
  );

  const activeToken = scanned || manual.trim();

  // Look up the reservation (without checking it in) the moment a token appears,
  // so staff see who they're admitting before confirming. Debounced for typing.
  useEffect(() => {
    const t = activeToken;
    if (!t) { setPreview(null); return; }
    let cancelled = false;
    const id = setTimeout(() => {
      setPreviewLoading(true);
      const pw = getStoredPassword();
      fetch(`${API_BASE}/api/reservation-checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pw}` },
        body: JSON.stringify({ token: t, preview: true }),
      })
        .then(async (r) => {
          if (r.ok) return r.json();
          const reason = `server_${r.status}`;
          console.error(`[CheckinScanner] Preview fetch returned ${r.status}`, r.statusText);
          return { state: 'invalid' as const, reason, reservation: null, table_label: null };
        })
        .then(d => { if (!cancelled) setPreview(d as Preview); })
        .catch((err) => {
          console.error('[CheckinScanner] Preview fetch failed:', err);
          if (!cancelled) setPreview({ state: 'invalid', reason: 'network_error', reservation: null, table_label: null });
        })
        .finally(() => { if (!cancelled) setPreviewLoading(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(id); };
  }, [activeToken]);

  const canCheckIn = preview?.state === 'ok';

  async function handleCheckin() {
    if (!activeToken || !canCheckIn) return;
    const pw = getStoredPassword();
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/reservation-checkin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pw}`,
        },
        body: JSON.stringify({ token: activeToken, tableId }),
      });

      if (res.status === 401) {
        setResult({ state: 'invalid', reason: 'Unauthorized — please re-login via /admin' });
        return;
      }

      if (!res.ok) {
        setResult({ state: 'invalid', reason: `Server error (${res.status}) — please try again` });
        return;
      }

      const data = (await res.json()) as Result;
      setResult(data);
    } catch {
      setResult({ state: 'invalid', reason: 'Network error — please try again' });
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setScanned('');
    setManual('');
    setTableId('');
    setResult(null);
    setPreview(null);
    // Resume scanner after a reset; guard against scanner that never started
    try { scannerRef.current?.resume(); } catch { /* scanner not running, ignore */ }
  }

  return (
    <div className="min-h-screen bg-[#f6f2e8]">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-40">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between">
          <h1 className="text-base font-bold text-[#1b2350] tracking-tight">
            Door Check-in
          </h1>
          <a
            href="/admin"
            className="text-xs text-muted-foreground hover:underline"
          >
            Admin panel
          </a>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-6">

        {/* Camera viewfinder */}
        <section className="bg-white rounded-xl border overflow-hidden">
          <div className="px-4 pt-4 pb-2">
            <h2 className="text-sm font-semibold text-[#1b2350]">Scan QR code</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Point at a reservation ticket QR code
            </p>
          </div>
          <div id="qr-reader" className="w-full" />
          {camError && (
            <div className="px-4 pb-4">
              <p className="text-xs text-destructive mt-2">{camError}</p>
            </div>
          )}
          {scanned && (
            <div className="px-4 pb-4 pt-2 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                Scanned: {scanned}
              </span>
              <button
                type="button"
                onClick={handleReset}
                className="text-xs text-muted-foreground hover:text-[#1b2350] ml-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#12207e] rounded"
              >
                Clear
              </button>
            </div>
          )}
        </section>

        {/* Manual entry */}
        <section className="bg-white rounded-xl border px-4 py-4 space-y-2">
          <label htmlFor="manual-code" className="block text-sm font-semibold text-[#1b2350]">
            Manual code entry
          </label>
          <p className="text-xs text-muted-foreground">
            Type a reservation token (r_…) if the QR scan fails
          </p>
          <input
            id="manual-code"
            type="text"
            placeholder="r_abc123…"
            value={manual}
            onChange={(e) => {
              setManual(e.target.value);
              setResult(null);
            }}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring placeholder:text-muted-foreground"
          />
        </section>

        {/* Reservation preview — who's at the door */}
        {activeToken && (
          <section aria-live="polite">
            {previewLoading && !preview && (
              <div className="rounded-xl border bg-white px-4 py-4 text-sm text-muted-foreground animate-pulse">Looking up reservation…</div>
            )}
            {preview && preview.state === 'ok' && preview.reservation && (
              <div className="rounded-xl border bg-white px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-bold text-[#1b2350]">{preview.reservation.customer_name}</p>
                    <p className="text-sm text-muted-foreground capitalize">
                      {preview.reservation.type} · {partySummary(preview.reservation)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{preview.reservation.res_time}</p>
                  </div>
                  <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1 whitespace-nowrap">
                    Ready to seat
                  </span>
                </div>
              </div>
            )}
            {preview && preview.state === 'already' && preview.reservation && (
              <div className="rounded-xl border bg-amber-50 border-amber-200 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-bold text-[#1b2350]">{preview.reservation.customer_name}</p>
                    <p className="text-sm text-muted-foreground capitalize">
                      {preview.reservation.type} · {partySummary(preview.reservation)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{preview.reservation.res_time}</p>
                  </div>
                  <span className="text-xs font-medium text-amber-800 bg-amber-100 border border-amber-300 rounded-full px-2.5 py-1 whitespace-nowrap">
                    Already in{preview.table_label ? ` · ${preview.table_label}` : ''}
                  </span>
                </div>
              </div>
            )}
            {preview && preview.state === 'invalid' && (
              <div className="rounded-xl border bg-red-50 border-red-200 px-4 py-4 text-sm font-medium text-red-800">
                ⚠️ {reasonLabel(preview.reason)}
              </div>
            )}
            {preview && !previewLoading && preview.state !== 'ok' && preview.state !== 'already' && preview.state !== 'invalid' && (
              <div className="rounded-xl border bg-red-50 border-red-200 px-4 py-4 text-sm font-medium text-red-800">
                ⚠️ Unexpected response — please try again.
              </div>
            )}
          </section>
        )}

        {/* Table picker (optional) */}
        <section className="bg-white rounded-xl border px-4 py-4 space-y-2">
          <div role="group" aria-label="Assign table">
            <p className="block text-sm font-semibold text-[#1b2350] mb-2">
              Assign table <span className="font-normal text-muted-foreground">(optional)</span>
            </p>
            {tableOptions.length > 0 ? (
              <>
                <p className="text-xs text-muted-foreground mb-2">
                  Select a table to seat the guest — or leave blank to check in without one
                </p>
                <SearchableSelect
                  options={tableOptions}
                  value={tableId}
                  onChange={setTableId}
                  placeholder="Choose a table…"
                />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                No tables set up yet — you can still check the guest in. Add tables in{' '}
                <a href="/admin" className="underline text-[#12207e]">Admin → Floor</a>.
              </p>
            )}
            {tablesError && (
              <p className="text-xs text-destructive mt-2">{tablesError}</p>
            )}
          </div>
        </section>

        {/* Active token indicator */}
        {activeToken && (
          <div className="text-xs text-muted-foreground px-1">
            Token to check in:{' '}
            <span className="font-mono font-medium text-[#1b2350]">{activeToken}</span>
          </div>
        )}

        {/* Check-in button — table is optional, so this enables as soon as the
            scanned reservation is valid & checkinable. */}
        <button
          type="button"
          disabled={!canCheckIn || loading}
          onClick={handleCheckin}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#12207e]"
          style={{ background: '#12207e' }}
          title={!canCheckIn && !loading
            ? (preview?.state === 'invalid'
              ? `Cannot check in: ${reasonLabel(preview.reason)}`
              : preview?.state === 'already'
                ? 'Guest already checked in'
                : 'Scan or enter a valid reservation code first')
            : undefined}
        >
          {loading ? 'Checking in…' : !canCheckIn && activeToken && !previewLoading
            ? (preview?.state === 'invalid'
              ? reasonLabel(preview.reason)
              : preview?.state === 'already'
                ? 'Already checked in'
                : 'Check in')
            : tableId ? 'Check in & seat' : 'Check in'}
        </button>

        {/* Result card */}
        {result && (
          <div
            className={`rounded-xl border px-4 py-4 text-sm font-medium flex items-start gap-3 ${
              result.state === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : result.state === 'already'
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            <span className="text-lg leading-none mt-0.5" aria-hidden>
              {result.state === 'ok' ? '✅' : result.state === 'already' ? '⚠️' : '❌'}
            </span>
            <div>
              {result.state === 'ok' && (
                <>
                  <p className="font-semibold">
                    {result.reservation?.customer_name
                      ? `${result.reservation.customer_name} checked in`
                      : 'Checked in'}
                  </p>
                  <p className="text-xs mt-0.5 opacity-80">
                    {result.reservation ? partySummary(result.reservation) : ''}
                    {result.table_label ? ` · Table ${result.table_label}` : ' · no table'}
                  </p>
                </>
              )}
              {result.state === 'already' && (
                <>
                  <p className="font-semibold">Already checked in</p>
                  <p className="text-xs mt-0.5 opacity-80">
                    Arrived at{' '}
                    {new Date(result.arrived_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </>
              )}
              {result.state === 'invalid' && (
                <>
                  <p className="font-semibold">Check-in failed</p>
                  <p className="text-xs mt-0.5 opacity-80">
                    {result.reason.replace(/_/g, ' ')}
                  </p>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="ml-auto text-xs opacity-60 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#12207e] rounded"
            >
              Scan next
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

// ── Default export: gated scanner ─────────────────────────────────────────

export default function CheckinScanner() {
  return (
    <AuthGate>
      <Scanner />
    </AuthGate>
  );
}
