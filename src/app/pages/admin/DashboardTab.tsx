import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/app/components/ui/button';
import { getDashboard, getStoredPassword, DashboardData } from '@/services/adminService';
import { toast } from 'sonner';
import { Loader2, RefreshCw, ShoppingBag, CalendarCheck, Users, Wallet, Clock, AlertCircle, PartyPopper, TrendingUp } from 'lucide-react';

const EGP = (n: number) => 'EGP ' + Math.round(n).toLocaleString();

function StatCard({ icon, label, value, tone = 'plain', hint }: { icon: React.ReactNode; label: string; value: string; tone?: 'plain' | 'accent' | 'warn'; hint?: string }) {
  const tones: Record<string, string> = {
    plain: 'bg-white border',
    accent: 'bg-[#12207e] text-white border-transparent',
    warn: 'bg-amber-50 border-amber-200',
  };
  const sub = tone === 'accent' ? 'text-white/70' : 'text-muted-foreground';
  return (
    <div className={`rounded-xl p-4 ${tones[tone]}`}>
      <div className={`flex items-center gap-1.5 text-xs font-medium ${sub}`}>{icon} {label}</div>
      <div className="mt-1.5 text-2xl font-bold tabular-nums leading-none">{value}</div>
      {hint && <div className={`mt-1 text-[11px] ${sub}`}>{hint}</div>}
    </div>
  );
}

function Sparkline({ data }: { data: { date: string; total: number }[] }) {
  const max = Math.max(1, ...data.map(d => d.total));
  const W = 100, H = 32;
  const step = data.length > 1 ? W / (data.length - 1) : W;
  const pts = data.map((d, i) => `${i * step},${H - (d.total / max) * (H - 4) - 2}`);
  const line = pts.join(' ');
  const area = `0,${H} ${line} ${W},${H}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-16">
      <polygon points={area} fill="#12207e" opacity="0.08" />
      <polyline points={line} fill="none" stroke="#12207e" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      {data.length > 0 && (
        <circle cx={(data.length - 1) * step} cy={H - (data[data.length - 1].total / max) * (H - 4) - 2} r="2" fill="#12207e" />
      )}
    </svg>
  );
}

export function DashboardTab({ onNavigate }: { onNavigate?: (section: 'orders') => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const pw = getStoredPassword();
    if (!pw) return;
    setLoading(true);
    try { setData(await getDashboard(pw)); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to load dashboard'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <div className="flex items-center justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (!data) return null;

  const s = data.stats;
  const spark = data.revenueSpark;
  const weekTotal = spark.slice(-7).reduce((a, b) => a + b.total, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#1b2350]">Command Center</h2>
          <p className="text-xs text-muted-foreground">Today · {new Date(data.today).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="size-3 mr-1 animate-spin" /> : <RefreshCw className="size-3 mr-1" />} Refresh
        </Button>
      </div>

      {/* Top-line stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard tone="accent" icon={<Wallet className="size-3.5" />} label="Revenue today" value={EGP(s.revenue_today)} hint={`${s.orders_today} order${s.orders_today === 1 ? '' : 's'}`} />
        <StatCard icon={<ShoppingBag className="size-3.5" />} label="Open orders" value={String(s.open_orders)} hint="in the pipeline" />
        <StatCard icon={<CalendarCheck className="size-3.5" />} label="Bookings today" value={String(s.reservations_today)} hint={`${s.covers_today} covers confirmed`} />
        <StatCard icon={<Users className="size-3.5" />} label="Covers today" value={String(s.covers_today)} hint="confirmed guests" />
      </div>

      {/* Action-needed row */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard tone={s.pending_reservations > 0 ? 'warn' : 'plain'} icon={<Clock className="size-3.5" />} label="Pending bookings" value={String(s.pending_reservations)} hint="awaiting your decision" />
        <StatCard tone={s.awaiting_payment > 0 ? 'warn' : 'plain'} icon={<AlertCircle className="size-3.5" />} label="Awaiting payment" value={String(s.awaiting_payment)} hint="approved, not paid" />
        <StatCard tone={s.pending_events > 0 ? 'warn' : 'plain'} icon={<PartyPopper className="size-3.5" />} label="Event requests" value={String(s.pending_events)} hint="new enquiries" />
      </div>

      {/* Revenue trend */}
      <div className="rounded-xl border bg-white p-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-[#1b2350]"><TrendingUp className="size-4" /> Revenue · last 14 days</h3>
          <span className="text-xs text-muted-foreground">This week: <span className="font-semibold text-[#1b2350]">{EGP(weekTotal)}</span></span>
        </div>
        <Sparkline data={spark} />
      </div>

      {/* Action queues */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2 text-[#1b2350]"><Clock className="size-4" /> Bookings to action</h3>
            {onNavigate && data.queues.pendingReservations.length > 0 && (
              <button className="text-xs text-[#12207e] hover:underline" onClick={() => onNavigate('orders')}>Open →</button>
            )}
          </div>
          <div className="divide-y">
            {data.queues.pendingReservations.length === 0 && <p className="text-sm text-muted-foreground py-2">Nothing waiting. 🎉</p>}
            {data.queues.pendingReservations.map(r => (
              <div key={r.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="font-medium text-[#1b2350]">{r.name}</div>
                  <div className="text-xs text-muted-foreground capitalize">{r.type} · {new Date(r.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {r.party} guest{r.party === 1 ? '' : 's'}{r.sunbeds ? ` · ${r.sunbeds} beds` : ''}</div>
                </div>
                <span className="text-[11px] rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5">pending</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2 text-[#1b2350]"><ShoppingBag className="size-4" /> Orders to approve</h3>
            {onNavigate && data.queues.pendingOrders.length > 0 && (
              <button className="text-xs text-[#12207e] hover:underline" onClick={() => onNavigate('orders')}>Open →</button>
            )}
          </div>
          <div className="divide-y">
            {data.queues.pendingOrders.length === 0 && <p className="text-sm text-muted-foreground py-2">All caught up. ✓</p>}
            {data.queues.pendingOrders.map(o => (
              <div key={o.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="font-medium text-[#1b2350]">{o.name} <span className="text-xs text-muted-foreground">{o.ref}</span></div>
                  <div className="text-xs text-muted-foreground capitalize">{o.mode}</div>
                </div>
                <span className="font-semibold tabular-nums text-[#1b2350]">{EGP(Number(o.total) || 0)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
