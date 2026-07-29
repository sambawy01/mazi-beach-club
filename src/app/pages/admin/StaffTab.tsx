import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Badge } from '@/app/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/app/components/ui/dialog';
import { getStaff, createStaff, updateStaff, deleteStaff, getStoredPassword, StaffMember, Role } from '@/services/adminService';
import { toast } from 'sonner';
import { Loader2, Plus, RefreshCw, UserCog, Trash2, KeyRound } from 'lucide-react';

const ROLES: Role[] = ['owner', 'manager', 'host', 'chef', 'accounting'];
const ROLE_TONE: Record<Role, string> = {
  owner: 'bg-[#12207e] text-white border-transparent',
  manager: 'bg-[#e6eef4] text-[#12207e] border-[#12207e]/15',
  host: 'bg-amber-50 text-amber-800 border-amber-200',
  chef: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  accounting: 'bg-violet-50 text-violet-800 border-violet-200',
};

export function StaffTab() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{ name: string; email: string; role: Role; password: string }>({ name: '', email: '', role: 'host', password: '' });

  const load = useCallback(async () => {
    const pw = getStoredPassword();
    if (!pw) return;
    setLoading(true);
    try { setStaff(await getStaff(pw)); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to load staff'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function openAdd() { setEditing(null); setForm({ name: '', email: '', role: 'host', password: '' }); setOpen(true); }
  function openEdit(s: StaffMember) { setEditing(s); setForm({ name: s.name, email: s.email, role: s.role, password: '' }); setOpen(true); }

  async function save() {
    const pw = getStoredPassword();
    if (!pw) return;
    if (!form.name.trim() || (!editing && !form.email.trim())) { toast.error('Name and email are required'); return; }
    if (!editing && form.password.length < 6) { toast.error('Set a password of at least 6 characters'); return; }
    setSaving(true);
    try {
      if (editing) {
        await updateStaff(pw, editing.id, { name: form.name, role: form.role, ...(form.password ? { password: form.password } : {}) });
        toast.success('Staff updated');
      } else {
        await createStaff(pw, { name: form.name, email: form.email, role: form.role, password: form.password });
        toast.success('Staff added');
      }
      setOpen(false);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function toggleActive(s: StaffMember) {
    const pw = getStoredPassword(); if (!pw) return;
    try { await updateStaff(pw, s.id, { is_active: !s.is_active }); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  }

  async function remove(s: StaffMember) {
    const pw = getStoredPassword(); if (!pw) return;
    if (!window.confirm(`Remove ${s.name}? They will no longer be able to sign in.`)) return;
    try { await deleteStaff(pw, s.id); toast.success('Staff removed'); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to remove'); }
  }

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2"><UserCog className="size-5" /> Team ({staff.length})</h2>
        <div className="flex gap-2">
          <Button size="sm" className="bg-[#12207e] hover:bg-[#0e1533] text-white" onClick={openAdd}><Plus className="size-3 mr-1" /> Add staff</Button>
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="size-3 mr-1" /> Refresh</Button>
        </div>
      </div>

      <div className="rounded-xl border divide-y">
        {staff.map(s => (
          <div key={s.id} className="flex items-center gap-3 p-3 flex-wrap">
            <div className="flex-1 min-w-[180px]">
              <div className="font-medium text-[#1b2350]">{s.name} {!s.is_active && <span className="text-xs text-gray-400">(disabled)</span>}</div>
              <div className="text-xs text-muted-foreground">{s.email} · last in {s.last_login_at ? new Date(s.last_login_at).toLocaleDateString() : 'never'}</div>
            </div>
            <Badge className={`border ${ROLE_TONE[s.role]}`}>{s.role}</Badge>
            <Button variant="ghost" size="sm" onClick={() => toggleActive(s)}>{s.is_active ? 'Disable' : 'Enable'}</Button>
            <Button variant="ghost" size="sm" onClick={() => openEdit(s)}><KeyRound className="size-3.5" /></Button>
            <Button variant="ghost" size="sm" className="text-red-600" onClick={() => remove(s)}><Trash2 className="size-3.5" /></Button>
          </div>
        ))}
        {staff.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No staff yet. Add your first team member.</div>}
      </div>

      <Dialog open={open} onOpenChange={(o) => { if (!saving) setOpen(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing ? 'Edit staff' : 'Add staff'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><label className="text-xs font-medium text-gray-600">Name</label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className="text-xs font-medium text-gray-600">Email</label><Input type="email" value={form.email} disabled={!!editing} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
            <div>
              <label className="text-xs font-medium text-gray-600">Role</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {ROLES.map(r => (
                  <button key={r} type="button" onClick={() => setForm({ ...form, role: r })}
                    className={`px-3 py-1.5 rounded-full border text-xs capitalize transition-colors ${form.role === r ? 'border-transparent bg-[#12207e] text-white' : 'border-gray-200 text-gray-600'}`}>{r}</button>
                ))}
              </div>
            </div>
            <div><label className="text-xs font-medium text-gray-600">{editing ? 'Reset password (leave blank to keep)' : 'Password'}</label><Input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder={editing ? '••••••••' : 'At least 6 characters'} /></div>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button className="bg-[#12207e] hover:bg-[#0e1533] text-white" onClick={save} disabled={saving}>{saving ? <><Loader2 className="size-4 mr-2 animate-spin" /> Saving…</> : (editing ? 'Save changes' : 'Add staff')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
