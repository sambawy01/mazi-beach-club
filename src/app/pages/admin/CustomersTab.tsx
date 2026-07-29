import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Badge } from '@/app/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/app/components/ui/dialog';
import { getCustomers, getStoredPassword, Customer } from '@/services/adminService';
import { toast } from 'sonner';
import { exportToCsv } from './lib/csv';
import { Loader2, RefreshCw, Download, Search, Users, Crown, ShoppingBag, CalendarCheck, Phone, Mail, Star } from 'lucide-react';

const EGP = (n: number) => 'EGP ' + Math.round(n).toLocaleString();
const VIP_THRESHOLD = 10000; // lifetime spend (EGP) that marks a VIP

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

type Segment = 'all' | 'vip' | 'members' | 'repeat';

export function CustomersTab() {
  const [rows, setRows] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [segment, setSegment] = useState<Segment>('all');
  const [selected, setSelected] = useState<Customer | null>(null);

  const load = useCallback(async () => {
    const pw = getStoredPassword();
    if (!pw) return;
    setLoading(true);
    try { setRows(await getCustomers(pw)); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to load customers'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const isVip = (c: Customer) => c.spend >= VIP_THRESHOLD;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(c => {
      if (segment === 'vip' && !isVip(c)) return false;
      if (segment === 'members' && !c.has_account) return false;
      if (segment === 'repeat' && c.visits < 2) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || (c.phone || '').toLowerCase().includes(q);
    });
  }, [rows, query, segment]);

  const totals = useMemo(() => ({
    count: rows.length,
    vip: rows.filter(isVip).length,
    members: rows.filter(c => c.has_account).length,
    revenue: rows.reduce((s, c) => s + c.spend, 0),
  }), [rows]);

  function exportCsv() {
    exportToCsv('mazi-customers', [
      { header: 'Name', value: (c: Customer) => c.name },
      { header: 'Email', value: (c: Customer) => c.email },
      { header: 'Phone', value: (c: Customer) => c.phone },
      { header: 'Account', value: (c: Customer) => c.has_account ? 'yes' : 'no' },
      { header: 'Orders', value: (c: Customer) => c.orders },
      { header: 'Lifetime spend', value: (c: Customer) => c.spend },
      { header: 'Reservations', value: (c: Customer) => c.reservations },
      { header: 'Visits', value: (c: Customer) => c.visits },
      { header: 'First seen', value: (c: Customer) => c.first_seen || '' },
      { header: 'Last activity', value: (c: Customer) => c.last_activity || '' },
    ], visible);
    toast.success(`Exported ${visible.length} customer${visible.length === 1 ? '' : 's'}`);
  }

  const SEGMENTS: { key: Segment; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'vip', label: 'VIP' },
    { key: 'members', label: 'Members' },
    { key: 'repeat', label: 'Repeat' },
  ];

  if (loading && rows.length === 0) return <div className="flex items-center justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2 text-[#1b2350]"><Users className="size-5" /> Customers</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={visible.length === 0}><Download className="size-3 mr-1" /> Export</Button>
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="size-3 mr-1" /> Refresh</Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="rounded-xl border bg-white p-3"><div className="text-xs text-muted-foreground">Guests</div><div className="text-xl font-bold tabular-nums">{totals.count}</div></div>
        <div className="rounded-xl border bg-white p-3"><div className="text-xs text-muted-foreground flex items-center gap-1"><Crown className="size-3" /> VIP</div><div className="text-xl font-bold tabular-nums">{totals.vip}</div></div>
        <div className="rounded-xl border bg-white p-3"><div className="text-xs text-muted-foreground">Members</div><div className="text-xl font-bold tabular-nums">{totals.members}</div></div>
        <div className="rounded-xl border bg-white p-3"><div className="text-xs text-muted-foreground">Lifetime revenue</div><div className="text-xl font-bold tabular-nums">{EGP(totals.revenue)}</div></div>
      </div>

      {/* Search + segments */}
      <div className="mb-4 space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, email, phone…" className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SEGMENTS.map(sg => (
            <button key={sg.key} onClick={() => setSegment(sg.key)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${segment === sg.key ? 'bg-[#12207e] text-white' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}>
              {sg.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border bg-white divide-y">
        {visible.map(c => (
          <button key={c.email} onClick={() => setSelected(c)} className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/40 transition-colors">
            <div className="flex-1 min-w-0">
              <div className="font-medium text-[#1b2350] flex items-center gap-1.5 truncate">
                {c.name || c.email}
                {isVip(c) && <Crown className="size-3.5 text-[#c9a24a]" />}
                {c.has_account && <Star className="size-3 text-[#12207e]" />}
              </div>
              <div className="text-xs text-muted-foreground truncate">{c.email}{c.phone ? ` · ${c.phone}` : ''}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="font-semibold tabular-nums text-[#1b2350]">{EGP(c.spend)}</div>
              <div className="text-[11px] text-muted-foreground">{c.orders} order{c.orders === 1 ? '' : 's'} · {c.reservations} booking{c.reservations === 1 ? '' : 's'}</div>
            </div>
          </button>
        ))}
        {visible.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">{rows.length === 0 ? 'No customers yet.' : 'No customers match your search.'}</div>}
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <DialogContent className="sm:max-w-md">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {selected.name || selected.email}
                  {isVip(selected) && <Badge className="bg-[#c9a24a]/15 text-[#8a6d1f] border-[#c9a24a]/30"><Crown className="size-3 mr-1" /> VIP</Badge>}
                  {selected.has_account && <Badge variant="outline"><Star className="size-3 mr-1" /> Member</Badge>}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground"><Mail className="size-3.5" /> {selected.email}</div>
                {selected.phone && <div className="flex items-center gap-2 text-muted-foreground"><Phone className="size-3.5" /> {selected.phone}</div>}
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground flex items-center gap-1"><ShoppingBag className="size-3" /> Orders</div>
                    <div className="text-lg font-bold">{selected.orders}</div>
                    {selected.cancelled_orders > 0 && <div className="text-[11px] text-red-500">{selected.cancelled_orders} cancelled</div>}
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground flex items-center gap-1"><CalendarCheck className="size-3" /> Bookings</div>
                    <div className="text-lg font-bold">{selected.reservations}</div>
                    <div className="text-[11px] text-muted-foreground">{selected.confirmed_reservations} confirmed</div>
                  </div>
                  <div className="rounded-lg border p-3 col-span-2 bg-[#12207e] text-white">
                    <div className="text-xs text-white/70">Lifetime value</div>
                    <div className="text-2xl font-bold tabular-nums">{EGP(selected.spend)}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground pt-1">
                  <div>First seen<div className="text-[#1b2350] font-medium">{fmtDate(selected.first_seen)}</div></div>
                  <div>Last activity<div className="text-[#1b2350] font-medium">{fmtDate(selected.last_activity)}</div></div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
