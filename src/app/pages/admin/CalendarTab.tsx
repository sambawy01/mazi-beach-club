import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/app/components/ui/dialog';
import {
  fetchReservationsFromSupabase,
  getStoredPassword,
  SupabaseReservation,
} from '@/services/adminService';
import { AdminLang } from './useAdminLang';
import { localKey, prettyTime, timeToMinutes } from './calendarUtils';
import { toast } from 'sonner';
import {
  Loader2, RefreshCw, ChevronLeft, ChevronRight, CalendarDays,
  Umbrella, UtensilsCrossed, Phone, Clock, Users, Hash,
} from 'lucide-react';

// Status badge styling — mirrors ReservationsTab for visual consistency.
const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  awaiting_payment: { label: 'Awaiting payment', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  confirmed: { label: 'Confirmed', className: 'bg-green-100 text-green-800 border-green-200' },
  arrived: { label: 'Arrived', className: 'bg-teal-100 text-teal-800 border-teal-200' },
  declined: { label: 'Declined', className: 'bg-red-100 text-red-800 border-red-200' },
  cancelled: { label: 'Cancelled', className: 'bg-gray-100 text-gray-600 border-gray-200' },
  completed: { label: 'Completed', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  no_show: { label: 'No show', className: 'bg-gray-100 text-gray-600 border-gray-200' },
};

// Only secured bookings that carry their QR ticket appear on the calendar.
const CALENDAR_STATUSES = new Set(['confirmed', 'arrived']);

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Reservations may carry an assigned table id even though it is not on the
// shared type — read it defensively.
type ReservationWithTable = SupabaseReservation & { table_id?: string | null };

function firstName(name: string): string {
  if (!name) return '—';
  return name.trim().split(/\s+/)[0];
}

// Per-type chip / accent styling. Beach = teal (#12207e family),
// restaurant = amber.
const TYPE_STYLE = {
  beach: {
    chip: 'bg-teal-50 text-teal-800 border border-teal-200 hover:bg-teal-100',
    emoji: '🏖️',
  },
  restaurant: {
    chip: 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100',
    emoji: '🍽️',
  },
} as const;

function typeStyle(type: string) {
  return type === 'beach' ? TYPE_STYLE.beach : TYPE_STYLE.restaurant;
}

interface CalendarTabProps {
  l: AdminLang;
}

export function CalendarTab({ l }: CalendarTabProps) {
  void l; // localization handle kept for signature parity with sibling tabs
  const [reservations, setReservations] = useState<SupabaseReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Currently-viewed month, anchored to the 1st of the month.
  const [viewDate, setViewDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  // Selected day for the detail dialog (local YYYY-MM-DD), or null.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const fetchReservations = useCallback(async () => {
    const pw = getStoredPassword();
    if (!pw) { setLoading(false); setError('Not authenticated'); return; }
    try {
      setError(null);
      const data = await fetchReservationsFromSupabase(pw);
      setReservations(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load reservations';
      setError(msg);
      toast.error('Failed to load reservations');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchReservations(); }, [fetchReservations]);

  // Filter to secured bookings and group by their res_date ('YYYY-MM-DD').
  const byDate = useMemo(() => {
    const map = new Map<string, SupabaseReservation[]>();
    for (const r of reservations) {
      if (!CALENDAR_STATUSES.has(r.status)) continue;
      if (!r.res_date) continue;
      const key = r.res_date.slice(0, 10);
      const arr = map.get(key);
      if (arr) arr.push(r); else map.set(key, [r]);
    }
    // Sort each day's bookings by time for a tidy chip / list order.
    for (const arr of map.values()) {
      arr.sort((a, b) => timeToMinutes(a.res_time) - timeToMinutes(b.res_time));
    }
    return map;
  }, [reservations]);

  // Build the 6×7 grid of days covering the viewed month, starting on Sunday.
  const cells = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const gridStart = new Date(year, month, 1 - firstOfMonth.getDay()); // back up to Sunday
    const out: { date: Date; key: string; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      out.push({ date: d, key: localKey(d), inMonth: d.getMonth() === month });
    }
    return out;
  }, [viewDate]);

  const todayKey = localKey(new Date());
  const monthLabel = `${MONTH_NAMES[viewDate.getMonth()]} ${viewDate.getFullYear()}`;

  const goPrev = () => setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const goNext = () => setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  const goToday = () => {
    const now = new Date();
    setViewDate(new Date(now.getFullYear(), now.getMonth(), 1));
  };

  const selectedList = selectedKey ? (byDate.get(selectedKey) ?? []) : [];
  const selectedLabel = selectedKey
    ? new Date(`${selectedKey}T00:00:00`).toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      })
    : '';

  // Count only the secured bookings whose res_date falls in the currently-viewed
  // month/year, so the badge and empty-state reflect what is actually on screen.
  const monthPrefix = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}`;
  const totalOnCalendar = useMemo(
    () => reservations.filter(
      r => CALENDAR_STATUSES.has(r.status) && (r.res_date ?? '').slice(0, 7) === monthPrefix,
    ).length,
    [reservations, monthPrefix],
  );

  return (
    <div>
      {/* Header: title + month nav + refresh */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <CalendarDays className="size-5 text-[#12207e]" />
          {monthLabel}
          <Badge className="bg-teal-50 text-teal-800 border-teal-200">
            {totalOnCalendar} booked
          </Badge>
        </h2>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={goPrev} aria-label="Previous month">
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToday}>Today</Button>
          <Button variant="outline" size="sm" onClick={goNext} aria-label="Next month">
            <ChevronRight className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="ml-2"
            onClick={() => { setLoading(true); fetchReservations(); }}
          >
            <RefreshCw className="size-3 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block size-3 rounded-sm bg-teal-200 border border-teal-300" /> 🏖️ Beach
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-3 rounded-sm bg-amber-200 border border-amber-300" /> 🍽️ Restaurant
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-red-600 mb-3">{error}</p>
          <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetchReservations(); }}>
            <RefreshCw className="size-3 mr-1" /> Retry
          </Button>
        </Card>
      ) : (
        <>
          {totalOnCalendar === 0 && (
            <p className="text-sm text-muted-foreground mb-3">
              No confirmed or arrived bookings to display.
            </p>
          )}

          {/* Horizontal scroll wrapper so the grid never squashes on mobile. */}
          <div className="overflow-x-auto -mx-1 px-1">
            <div className="min-w-[720px]">
              {/* Weekday header */}
              <div className="grid grid-cols-7 gap-1 mb-1">
                {WEEKDAYS.map(w => (
                  <div
                    key={w}
                    className="text-center text-xs font-semibold text-muted-foreground py-1"
                  >
                    {w}
                  </div>
                ))}
              </div>

              {/* Day cells */}
              <div className="grid grid-cols-7 gap-1">
                {cells.map(cell => {
                  const dayRes = byDate.get(cell.key) ?? [];
                  const isToday = cell.key === todayKey;
                  const shown = dayRes.slice(0, 3);
                  const extra = dayRes.length - shown.length;
                  const clickable = dayRes.length > 0;
                  // Accessible name derived from the cell's own date (accurate even
                  // for trailing/leading days that belong to an adjacent month).
                  const dateLabel = cell.date.toLocaleDateString('en-US', {
                    month: 'long', day: 'numeric', year: 'numeric',
                  });
                  return (
                    <div
                      key={cell.key}
                      onClick={clickable ? () => setSelectedKey(cell.key) : undefined}
                      role={clickable ? 'button' : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      aria-label={
                        clickable
                          ? `${dateLabel} — ${dayRes.length} booking${dayRes.length === 1 ? '' : 's'}`
                          : undefined
                      }
                      onKeyDown={
                        clickable
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setSelectedKey(cell.key);
                              }
                            }
                          : undefined
                      }
                      className={[
                        'min-h-[104px] rounded-md border p-1.5 flex flex-col gap-1 transition-colors',
                        cell.inMonth ? 'bg-white' : 'bg-muted/40',
                        clickable ? 'cursor-pointer hover:border-[#12207e]' : '',
                        isToday ? 'border-[#12207e] ring-1 ring-[#12207e]' : 'border-gray-200',
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={[
                            'text-xs font-medium',
                            cell.inMonth ? 'text-gray-700' : 'text-gray-400',
                            isToday
                              ? 'bg-[#12207e] text-white rounded-full size-5 flex items-center justify-center'
                              : '',
                          ].join(' ')}
                        >
                          {cell.date.getDate()}
                        </span>
                        {dayRes.length > 0 && (
                          <span className="text-[11px] text-muted-foreground">{dayRes.length}</span>
                        )}
                      </div>

                      <div className="flex flex-col gap-0.5">
                        {shown.map(r => {
                          const st = typeStyle(r.type);
                          return (
                            <div
                              key={r.id}
                              className={`text-[11px] leading-tight rounded px-1 py-0.5 truncate ${st.chip}`}
                              title={`${r.customer_name} · ${prettyTime(r.res_time)}`}
                            >
                              {st.emoji} {prettyTime(r.res_time)} · {firstName(r.customer_name)}
                            </div>
                          );
                        })}
                        {extra > 0 && (
                          <div className="text-[11px] text-muted-foreground pl-1">+{extra} more</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Day detail dialog */}
      <Dialog open={!!selectedKey} onOpenChange={(o) => { if (!o) setSelectedKey(null); }}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="size-5 text-[#12207e]" />
              {selectedLabel}
            </DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground -mt-1">
            {selectedList.length} booking{selectedList.length === 1 ? '' : 's'}
          </p>

          <div className="space-y-3">
            {selectedList.map(r => {
              const st = typeStyle(r.type);
              const badge = STATUS_BADGE[r.status];
              const tableId = (r as ReservationWithTable).table_id;
              return (
                <div key={r.id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium text-sm flex items-center gap-1.5">
                      <span>{st.emoji}</span>
                      {r.customer_name}
                    </div>
                    {badge
                      ? <Badge className={badge.className}>{badge.label}</Badge>
                      : <Badge variant="outline">{r.status}</Badge>}
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      {r.type === 'beach'
                        ? <Umbrella className="size-3" />
                        : <UtensilsCrossed className="size-3" />}
                      {r.type === 'beach' ? 'Beach' : 'Restaurant'}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" /> {prettyTime(r.res_time)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Phone className="size-3" /> {r.customer_phone || '—'}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="size-3" />
                      {r.type === 'beach'
                        ? `${r.party_size} guests · ${r.sunbeds} sunbeds`
                        : `${r.party_size} guests`}
                    </span>
                    {tableId && (
                      <span className="flex items-center gap-1">
                        <Hash className="size-3" /> Table {tableId}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {selectedList.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">No bookings this day.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
