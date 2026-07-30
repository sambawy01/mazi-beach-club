import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Input } from '@/app/components/ui/input';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/app/components/ui/table';
import { fetchMemberships, updateMembership, getStoredPassword, MembershipApplication } from '@/services/adminService';
import { toast } from 'sonner';
import { exportToCsv } from './lib/csv';
import { Loader2, Check, X, RefreshCw, Search, Download, IdCard } from 'lucide-react';

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  approved: { label: 'Approved', className: 'bg-green-100 text-green-800 border-green-200' },
  declined: { label: 'Declined', className: 'bg-red-100 text-red-800 border-red-200' },
};

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function MembershipTab() {
  const [rows, setRows] = useState<MembershipApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const load = useCallback(async () => {
    const pw = getStoredPassword();
    if (!pw) { setLoading(false); return; }
    setLoading(true);
    try { setRows(await fetchMemberships(pw)); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to load applications'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!q) return true;
      return r.full_name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || (r.phone || '').toLowerCase().includes(q);
    });
  }, [rows, query, statusFilter]);

  const pendingCount = rows.filter(r => r.status === 'pending').length;

  async function decide(r: MembershipApplication, status: 'approved' | 'declined') {
    const pw = getStoredPassword(); if (!pw) return;
    if (status === 'declined' && !window.confirm(`Decline ${r.full_name}'s application? They'll get a polite email.`)) return;
    setBusyId(r.id);
    try {
      await updateMembership(pw, r.id, status);
      toast.success(status === 'approved' ? 'Approved — welcome email sent' : 'Declined — note emailed');
      setRows(rs => rs.map(x => x.id === r.id ? { ...x, status } : x));
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusyId(null); }
  }

  function exportCsv() {
    exportToCsv('mazi-memberships', [
      { header: 'Applied', value: (r: MembershipApplication) => r.created_at },
      { header: 'Name', value: (r: MembershipApplication) => r.full_name },
      { header: 'Email', value: (r: MembershipApplication) => r.email },
      { header: 'Phone', value: (r: MembershipApplication) => r.phone },
      { header: 'Type', value: (r: MembershipApplication) => r.membership_type },
      { header: 'Status', value: (r: MembershipApplication) => r.status },
      { header: 'Notes', value: (r: MembershipApplication) => r.notes },
    ], visible);
    toast.success(`Exported ${visible.length}`);
  }

  if (loading && rows.length === 0) return <div className="flex items-center justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2 text-[#1b2350]">
          <IdCard className="size-5" /> Memberships ({visible.length}{visible.length !== rows.length ? ` of ${rows.length}` : ''})
          {pendingCount > 0 && <Badge className="ml-2 bg-amber-100 text-amber-800 border-amber-200">{pendingCount} pending</Badge>}
        </h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={visible.length === 0}><Download className="size-3 mr-1" /> Export</Button>
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="size-3 mr-1" /> Refresh</Button>
        </div>
      </div>

      <div className="mb-4 space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, email, phone…" className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {['all', 'pending', 'approved', 'declined'].map(k => (
            <button key={k} onClick={() => setStatusFilter(k)}
              className={`px-3 py-1 rounded-full text-xs font-medium capitalize transition-colors ${statusFilter === k ? 'bg-[#12207e] text-white' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}>
              {k === 'all' ? 'All' : k}
            </button>
          ))}
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Applicant</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Applied</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map(r => {
            const badge = STATUS_BADGE[r.status];
            return (
              <TableRow key={r.id} className={r.status === 'pending' ? 'bg-amber-50/50' : undefined}>
                <TableCell className="text-sm font-medium">
                  {r.full_name}
                  <div className="text-xs text-muted-foreground">{r.email}</div>
                  <div className="text-xs text-muted-foreground">{r.phone}</div>
                  {r.notes && <div className="text-xs text-muted-foreground mt-0.5 italic">{r.notes}</div>}
                </TableCell>
                <TableCell className="text-sm capitalize">{r.membership_type}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{timeAgo(r.created_at)}</TableCell>
                <TableCell>{badge ? <Badge className={badge.className}>{badge.label}</Badge> : <Badge variant="outline">{r.status}</Badge>}</TableCell>
                <TableCell className="text-right">
                  {busyId === r.id ? (
                    <Loader2 className="size-4 animate-spin inline" />
                  ) : r.status === 'pending' ? (
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => decide(r, 'approved')}><Check className="size-3.5 mr-1" /> Approve</Button>
                      <Button size="sm" variant="destructive" onClick={() => decide(r, 'declined')}><X className="size-3.5 mr-1" /> Decline</Button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          {visible.length === 0 && (
            <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">{rows.length === 0 ? 'No applications yet.' : 'No applications match your search.'}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
