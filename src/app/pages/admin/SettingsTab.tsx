import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { getSettings, updateSettings, getStoredPassword, SettingsMap } from '@/services/adminService';
import { toast } from 'sonner';
import { Loader2, Save, Power, Percent, Clock, CalendarX, RefreshCw } from 'lucide-react';

// Defaults mirror the seeded settings rows so the UI renders sensibly even
// before the first save (or if a key was never seeded).
const DEFAULTS = {
  ordering_paused: false,
  reservations_paused: false,
  vat_rate: 0.14,
  service_rate: 0.12,
  min_delivery_order: 2000,
  hours_open: '12:00',
  hours_close: '02:00',
  slot_capacity: 20,
  blackout_dates: [] as string[],
};

type Draft = typeof DEFAULTS;

function coerce(raw: SettingsMap): Draft {
  const d: Draft = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS) as (keyof Draft)[]) {
    if (raw[k] !== undefined && raw[k] !== null) {
      // @ts-expect-error — key/value store is loosely typed; shapes align with DEFAULTS
      d[k] = raw[k];
    }
  }
  if (!Array.isArray(d.blackout_dates)) d.blackout_dates = [];
  return d;
}

function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${on ? 'bg-red-500' : 'bg-emerald-500'} ${disabled ? 'opacity-50' : ''}`}>
      <span className={`inline-block size-5 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

export function SettingsTab() {
  const [draft, setDraft] = useState<Draft>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newBlackout, setNewBlackout] = useState('');

  const load = useCallback(async () => {
    const pw = getStoredPassword();
    if (!pw) return;
    setLoading(true);
    try { setDraft(coerce(await getSettings(pw))); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to load settings'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function set<K extends keyof Draft>(k: K, v: Draft[K]) { setDraft(d => ({ ...d, [k]: v })); }

  async function saveAll() {
    const pw = getStoredPassword();
    if (!pw) return;
    setSaving(true);
    try {
      await updateSettings(pw, { ...draft });
      toast.success('Settings saved');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  // Kill-switches save immediately — they're emergency controls, not a form.
  async function toggleSwitch(key: 'ordering_paused' | 'reservations_paused') {
    const pw = getStoredPassword();
    if (!pw) return;
    const next = !draft[key];
    set(key, next);
    try {
      await updateSettings(pw, { [key]: next });
      toast.success(next ? 'Paused' : 'Resumed');
    } catch (e) {
      set(key, !next); // revert on failure
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  }

  function addBlackout() {
    const v = newBlackout.trim();
    if (!v) return;
    if (draft.blackout_dates.includes(v)) { toast.error('Date already blocked'); return; }
    set('blackout_dates', [...draft.blackout_dates, v].sort());
    setNewBlackout('');
  }
  function removeBlackout(d: string) { set('blackout_dates', draft.blackout_dates.filter(x => x !== d)); }

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;

  const card = 'rounded-xl border bg-white p-5';
  const label = 'text-xs font-medium text-gray-600';

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[#1b2350]">Settings</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="size-3 mr-1" /> Refresh</Button>
          <Button size="sm" className="bg-[#12207e] hover:bg-[#0e1533] text-white" onClick={saveAll} disabled={saving}>
            {saving ? <><Loader2 className="size-4 mr-1.5 animate-spin" /> Saving…</> : <><Save className="size-3.5 mr-1.5" /> Save changes</>}
          </Button>
        </div>
      </div>

      {/* Kill switches — save on toggle */}
      <div className={card}>
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-3 text-[#1b2350]"><Power className="size-4" /> Service controls</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Online ordering</div>
              <div className="text-xs text-muted-foreground">{draft.ordering_paused ? 'Paused — guests cannot place delivery orders.' : 'Live — guests can order online.'}</div>
            </div>
            <Toggle on={draft.ordering_paused} onClick={() => toggleSwitch('ordering_paused')} />
          </div>
          <div className="flex items-center justify-between border-t pt-3">
            <div>
              <div className="text-sm font-medium">Reservations</div>
              <div className="text-xs text-muted-foreground">{draft.reservations_paused ? 'Paused — guests cannot book.' : 'Live — guests can reserve.'}</div>
            </div>
            <Toggle on={draft.reservations_paused} onClick={() => toggleSwitch('reservations_paused')} />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">Switches save instantly. Everything below saves with the button above.</p>
      </div>

      {/* Financial rates */}
      <div className={card}>
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-3 text-[#1b2350]"><Percent className="size-4" /> Charges</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={label}>VAT rate (%)</label>
            <Input type="number" step="0.01" value={Math.round(draft.vat_rate * 10000) / 100}
              onChange={e => set('vat_rate', (parseFloat(e.target.value) || 0) / 100)} />
          </div>
          <div>
            <label className={label}>Service (%)</label>
            <Input type="number" step="0.01" value={Math.round(draft.service_rate * 10000) / 100}
              onChange={e => set('service_rate', (parseFloat(e.target.value) || 0) / 100)} />
          </div>
          <div>
            <label className={label}>Min delivery order (EGP)</label>
            <Input type="number" value={draft.min_delivery_order}
              onChange={e => set('min_delivery_order', parseInt(e.target.value) || 0)} />
          </div>
        </div>
      </div>

      {/* Hours & capacity */}
      <div className={card}>
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-3 text-[#1b2350]"><Clock className="size-4" /> Hours & capacity</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={label}>Opens</label>
            <Input type="time" value={draft.hours_open} onChange={e => set('hours_open', e.target.value)} />
          </div>
          <div>
            <label className={label}>Closes</label>
            <Input type="time" value={draft.hours_close} onChange={e => set('hours_close', e.target.value)} />
          </div>
          <div>
            <label className={label}>Covers per slot</label>
            <Input type="number" value={draft.slot_capacity} onChange={e => set('slot_capacity', parseInt(e.target.value) || 0)} />
          </div>
        </div>
      </div>

      {/* Blackout dates */}
      <div className={card}>
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-3 text-[#1b2350]"><CalendarX className="size-4" /> Blackout dates</h3>
        <p className="text-xs text-muted-foreground mb-3">Dates the venue is closed to new bookings and orders.</p>
        <div className="flex gap-2 mb-3">
          <Input type="date" value={newBlackout} onChange={e => setNewBlackout(e.target.value)} className="max-w-[200px]" />
          <Button variant="outline" size="sm" onClick={addBlackout}>Add</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {draft.blackout_dates.length === 0 && <span className="text-xs text-muted-foreground">None set.</span>}
          {draft.blackout_dates.map(d => (
            <span key={d} className="inline-flex items-center gap-1.5 rounded-full border bg-gray-50 px-3 py-1 text-xs">
              {d}
              <button type="button" className="text-gray-400 hover:text-red-600" onClick={() => removeBlackout(d)}>✕</button>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
