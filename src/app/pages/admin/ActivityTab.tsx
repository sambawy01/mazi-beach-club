import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/app/components/ui/button';
import { getAuditLog, getStoredPassword, AuditEntry } from '@/services/adminService';
import { toast } from 'sonner';
import { Loader2, RefreshCw, History } from 'lucide-react';

function timeAgo(iso: string) {
  const d = new Date(iso).getTime();
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleString();
}

export function ActivityTab() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const pw = getStoredPassword();
    if (!pw) return;
    setLoading(true);
    try { setRows(await getAuditLog(pw)); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to load activity'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2"><History className="size-5" /> Activity log</h2>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="size-3 mr-1" /> Refresh</Button>
      </div>
      <p className="text-sm text-muted-foreground mb-4">Every action taken in the admin — who, what, and when. Newest first.</p>

      <div className="rounded-xl border divide-y">
        {rows.map(r => (
          <div key={r.id} className="flex items-start gap-3 p-3">
            <div className="w-2 h-2 rounded-full bg-[#c9a24a] mt-2 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-[#1b2350]">
                <span className="font-medium">{r.actor}</span>
                <span className="text-gray-400"> · {r.actor_role}</span>
              </div>
              <div className="text-sm text-gray-600">{r.summary || r.action}{r.target_type ? <span className="text-gray-400"> · {r.target_type}</span> : null}</div>
            </div>
            <div className="text-xs text-gray-400 whitespace-nowrap shrink-0">{timeAgo(r.created_at)}</div>
          </div>
        ))}
        {rows.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No activity recorded yet.</div>}
      </div>
    </div>
  );
}
