import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Badge } from '@/app/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/app/components/ui/dialog';
import { getTables, createTable, updateTable, deleteTable, getStoredPassword, FloorTable, TableZone, Role } from '@/services/adminService';
import { toast } from 'sonner';
import { Loader2, Plus, RefreshCw, LayoutGrid, Trash2, Pencil, Users, UtensilsCrossed, Wine, Umbrella } from 'lucide-react';

const ZONES: { key: TableZone; label: string; icon: React.ReactNode }[] = [
  { key: 'dining', label: 'Dining', icon: <UtensilsCrossed className="size-4" /> },
  { key: 'bar', label: 'Bar', icon: <Wine className="size-4" /> },
  { key: 'daybed', label: 'Daybeds', icon: <Umbrella className="size-4" /> },
];

const EGP = (n: number) => 'EGP ' + Math.round(n).toLocaleString();

export function TablesTab({ role }: { role: Role }) {
  const canEdit = role === 'owner' || role === 'manager';
  const [tables, setTables] = useState<FloorTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<FloorTable | null>(null);
  const [form, setForm] = useState<{ label: string; zone: TableZone; capacity: string; qr_code: string }>({ label: '', zone: 'dining', capacity: '2', qr_code: '' });

  const load = useCallback(async () => {
    const pw = getStoredPassword();
    if (!pw) return;
    setLoading(true);
    try { setTables(await getTables(pw)); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to load tables'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function openAdd() { setEditing(null); setForm({ label: '', zone: 'dining', capacity: '2', qr_code: '' }); setOpen(true); }
  function openEdit(t: FloorTable) { setEditing(t); setForm({ label: t.label, zone: t.zone, capacity: String(t.capacity), qr_code: t.qr_code || '' }); setOpen(true); }

  async function save() {
    const pw = getStoredPassword(); if (!pw) return;
    if (!form.label.trim()) { toast.error('Label is required'); return; }
    setSaving(true);
    try {
      if (editing) {
        await updateTable(pw, editing.id, { label: form.label, zone: form.zone, capacity: parseInt(form.capacity) || 2, qr_code: form.qr_code });
        toast.success('Table updated');
      } else {
        await createTable(pw, { label: form.label, zone: form.zone, capacity: parseInt(form.capacity) || 2, qr_code: form.qr_code || undefined });
        toast.success('Table added');
      }
      setOpen(false);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function toggleActive(t: FloorTable) {
    const pw = getStoredPassword(); if (!pw) return;
    try { await updateTable(pw, t.id, { is_active: !t.is_active }); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  }

  async function remove(t: FloorTable) {
    const pw = getStoredPassword(); if (!pw) return;
    if (!window.confirm(`Remove table ${t.label}?`)) return;
    try { await deleteTable(pw, t.id); toast.success('Table removed'); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to remove'); }
  }

  if (loading && tables.length === 0) return <div className="flex items-center justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;

  const occupied = tables.filter(t => t.occupied_by).length;
  const activeSeats = tables.filter(t => t.is_active).reduce((s, t) => s + t.capacity, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2 text-[#1b2350]"><LayoutGrid className="size-5" /> Floor</h2>
          <p className="text-xs text-muted-foreground">{tables.length} tables · {activeSeats} seats · {occupied} occupied now</p>
        </div>
        <div className="flex gap-2">
          {canEdit && <Button size="sm" className="bg-[#12207e] hover:bg-[#0e1533] text-white" onClick={openAdd}><Plus className="size-3 mr-1" /> Add table</Button>}
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="size-3 mr-1" /> Refresh</Button>
        </div>
      </div>

      <div className="space-y-6">
        {ZONES.map(zone => {
          const zoneTables = tables.filter(t => t.zone === zone.key);
          if (zoneTables.length === 0) return null;
          return (
            <div key={zone.key}>
              <h3 className="text-sm font-semibold text-[#1b2350] flex items-center gap-1.5 mb-2">{zone.icon} {zone.label} <span className="text-muted-foreground font-normal">({zoneTables.length})</span></h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {zoneTables.map(t => {
                  const busy = !!t.occupied_by;
                  return (
                    <div key={t.id} className={`rounded-xl border p-3 relative ${!t.is_active ? 'opacity-50 bg-muted/40' : busy ? 'border-amber-300 bg-amber-50' : 'bg-white'}`}>
                      <div className="flex items-start justify-between">
                        <div className="font-bold text-[#1b2350]">{t.label}</div>
                        <span className={`size-2.5 rounded-full mt-1 ${!t.is_active ? 'bg-gray-300' : busy ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><Users className="size-3" /> {t.capacity}</div>
                      {busy && (
                        <div className="mt-1.5 text-[11px] text-amber-800">
                          <div className="font-medium">{t.occupied_by!.order_ref}</div>
                          <div>{EGP(Number(t.occupied_by!.total) || 0)}</div>
                        </div>
                      )}
                      {!t.is_active && <Badge variant="outline" className="mt-1.5 text-[10px]">inactive</Badge>}
                      {canEdit && (
                        <div className="flex gap-1 mt-2 pt-2 border-t">
                          <button className="text-xs text-muted-foreground hover:text-[#12207e]" onClick={() => openEdit(t)} title="Edit"><Pencil className="size-3.5" /></button>
                          <button className="text-xs text-muted-foreground hover:text-[#12207e]" onClick={() => toggleActive(t)} title={t.is_active ? 'Disable' : 'Enable'}>{t.is_active ? 'Off' : 'On'}</button>
                          <button className="text-xs text-muted-foreground hover:text-red-600 ml-auto" onClick={() => remove(t)} title="Remove"><Trash2 className="size-3.5" /></button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {tables.length === 0 && <div className="rounded-xl border bg-white p-8 text-center text-sm text-muted-foreground">No tables yet.{canEdit ? ' Add your first table to build the floor plan.' : ''}</div>}
      </div>

      <Dialog open={open} onOpenChange={(o) => { if (!saving) setOpen(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing ? `Edit ${editing.label}` : 'Add table'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><label className="text-xs font-medium text-gray-600">Label</label><Input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="D1, B3, Daybed-2…" /></div>
            <div>
              <label className="text-xs font-medium text-gray-600">Zone</label>
              <div className="flex gap-2 mt-1">
                {ZONES.map(z => (
                  <button key={z.key} type="button" onClick={() => setForm({ ...form, zone: z.key })}
                    className={`flex-1 px-3 py-2 rounded-lg border text-xs flex items-center justify-center gap-1 transition-colors ${form.zone === z.key ? 'border-transparent bg-[#12207e] text-white' : 'border-gray-200 text-gray-600'}`}>
                    {z.icon} {z.label}
                  </button>
                ))}
              </div>
            </div>
            <div><label className="text-xs font-medium text-gray-600">Capacity</label><Input type="number" min="1" value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} /></div>
            <div><label className="text-xs font-medium text-gray-600">QR payload (optional)</label><Input value={form.qr_code} onChange={e => setForm({ ...form, qr_code: e.target.value })} placeholder="dine-in link or code" /></div>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button className="bg-[#12207e] hover:bg-[#0e1533] text-white" onClick={save} disabled={saving}>{saving ? <><Loader2 className="size-4 mr-2 animate-spin" /> Saving…</> : (editing ? 'Save changes' : 'Add table')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
