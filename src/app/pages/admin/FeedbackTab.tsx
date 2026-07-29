import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { getFeedback, resolveFeedback, getStoredPassword, FeedbackEntry, FeedbackSummary } from '@/services/adminService';
import { toast } from 'sonner';
import { exportToCsv } from './lib/csv';
import { Loader2, RefreshCw, Download, Star, MessageSquare, Check, RotateCcw } from 'lucide-react';

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`size-3.5 ${i <= n ? 'fill-[#c9a24a] text-[#c9a24a]' : 'text-gray-300'}`} />
      ))}
    </span>
  );
}

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

type Filter = 'all' | 'unresolved' | 'low' | '5' | '4' | '3' | '2' | '1';

export function FeedbackTab() {
  const [rows, setRows] = useState<FeedbackEntry[]>([]);
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const pw = getStoredPassword();
    if (!pw) return;
    setLoading(true);
    try { const d = await getFeedback(pw); setRows(d.rows); setSummary(d.summary); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to load feedback'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => rows.filter(r => {
    if (filter === 'all') return true;
    if (filter === 'unresolved') return !r.resolved;
    if (filter === 'low') return (r.rating || 0) <= 3;
    return String(r.rating) === filter;
  }), [rows, filter]);

  async function toggleResolved(r: FeedbackEntry) {
    const pw = getStoredPassword(); if (!pw) return;
    setBusyId(r.id);
    const next = !r.resolved;
    try {
      await resolveFeedback(pw, r.id, { resolved: next });
      setRows(rs => rs.map(x => x.id === r.id ? { ...x, resolved: next } : x));
      toast.success(next ? 'Marked resolved' : 'Reopened');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusyId(null); }
  }

  function exportCsv() {
    exportToCsv('mazi-feedback', [
      { header: 'When', value: (r: FeedbackEntry) => r.created_at },
      { header: 'Rating', value: (r: FeedbackEntry) => r.rating },
      { header: 'Name', value: (r: FeedbackEntry) => r.customer_name || '' },
      { header: 'Email', value: (r: FeedbackEntry) => r.customer_email || '' },
      { header: 'Order', value: (r: FeedbackEntry) => r.order_ref || '' },
      { header: 'Comment', value: (r: FeedbackEntry) => r.comment || '' },
      { header: 'Resolved', value: (r: FeedbackEntry) => r.resolved ? 'yes' : 'no' },
    ], visible);
    toast.success(`Exported ${visible.length}`);
  }

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'unresolved', label: 'Unresolved' },
    { key: 'low', label: '≤ 3 ★' },
    { key: '5', label: '5 ★' }, { key: '4', label: '4 ★' }, { key: '3', label: '3 ★' }, { key: '2', label: '2 ★' }, { key: '1', label: '1 ★' },
  ];

  if (loading && rows.length === 0) return <div className="flex items-center justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;

  const maxBar = summary ? Math.max(1, ...Object.values(summary.distribution)) : 1;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2 text-[#1b2350]"><MessageSquare className="size-5" /> Feedback</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={visible.length === 0}><Download className="size-3 mr-1" /> Export</Button>
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="size-3 mr-1" /> Refresh</Button>
        </div>
      </div>

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-5 rounded-xl border bg-white p-5 mb-4">
          <div className="flex flex-col items-center justify-center pr-5 md:border-r">
            <div className="text-4xl font-bold text-[#1b2350] tabular-nums">{summary.avg.toFixed(1)}</div>
            <Stars n={Math.round(summary.avg)} />
            <div className="text-xs text-muted-foreground mt-1">{summary.count} review{summary.count === 1 ? '' : 's'}</div>
            {summary.unresolved > 0 && <Badge className="mt-2 bg-red-50 text-red-700 border-red-200">{summary.unresolved} to action</Badge>}
          </div>
          <div className="space-y-1.5 self-center">
            {[5, 4, 3, 2, 1].map(star => (
              <div key={star} className="flex items-center gap-2 text-xs">
                <span className="w-3 text-right tabular-nums text-muted-foreground">{star}</span>
                <Star className="size-3 fill-[#c9a24a] text-[#c9a24a]" />
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-[#c9a24a]" style={{ width: `${((summary.distribution[star] || 0) / maxBar) * 100}%` }} />
                </div>
                <span className="w-6 tabular-nums text-muted-foreground">{summary.distribution[star] || 0}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filter === f.key ? 'bg-[#12207e] text-white' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="space-y-3">
        {visible.map(r => (
          <div key={r.id} className={`rounded-xl border bg-white p-4 ${!r.resolved && (r.rating || 0) <= 3 ? 'border-l-4 border-l-red-400' : ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Stars n={r.rating} />
                  <span className="text-sm font-medium text-[#1b2350]">{r.customer_name || 'Anonymous'}</span>
                  {r.resolved && <Badge variant="outline" className="text-emerald-700 border-emerald-200"><Check className="size-3 mr-0.5" /> Resolved</Badge>}
                </div>
                {r.comment && <p className="text-sm text-gray-700 mt-1.5">{r.comment}</p>}
                <div className="text-xs text-muted-foreground mt-1.5">
                  {r.order_ref ? `${r.order_ref} · ` : ''}{r.customer_email || '—'} · {timeAgo(r.created_at)}
                </div>
              </div>
              <Button size="sm" variant={r.resolved ? 'ghost' : 'outline'} disabled={busyId === r.id} onClick={() => toggleResolved(r)} className="shrink-0">
                {busyId === r.id ? <Loader2 className="size-3.5 animate-spin" /> : r.resolved ? <><RotateCcw className="size-3.5 mr-1" /> Reopen</> : <><Check className="size-3.5 mr-1" /> Resolve</>}
              </Button>
            </div>
          </div>
        ))}
        {visible.length === 0 && <div className="rounded-xl border bg-white p-8 text-center text-sm text-muted-foreground">{rows.length === 0 ? 'No feedback yet.' : 'Nothing matches this filter.'}</div>}
      </div>
    </div>
  );
}
