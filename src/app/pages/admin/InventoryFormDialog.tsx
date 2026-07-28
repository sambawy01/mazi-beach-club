import React, { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { StockItem } from '@/services/inventoryService';
import { AdminLang } from './useAdminLang';

const CATEGORIES = ['Raw Ingredient', 'Packaging', 'Supplies', 'Finished Good'];
const UNITS = ['kg', 'g', 'L', 'mL', 'pcs', 'box', 'bag', 'bottle', 'can', 'pack'];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: StockItem | null;
  onSave: (data: Record<string, string>) => Promise<void>;
  l: AdminLang;
}

export function InventoryFormDialog({ open, onOpenChange, item, onSave, l }: Props) {
  const { tr } = l;
  const isEdit = !!item;

  const initName = item?.name || '';
  const initCategory = item?.category || CATEGORIES[0];
  const initUnit = item?.unit || UNITS[0];
  const initQty = item?.qty_on_hand?.toString() || '0';
  const initMinLevel = item?.min_level?.toString() || '0';
  const initCost = item?.cost_per_unit?.toString() || '';
  const initSupplier = item?.supplier || '';
  const initNotes = item?.notes || '';

  const [name, setName] = useState(initName);
  const [category, setCategory] = useState(initCategory);
  const [unit, setUnit] = useState(initUnit);
  const [qty, setQty] = useState(initQty);
  const [minLevel, setMinLevel] = useState(initMinLevel);
  const [cost, setCost] = useState(initCost);
  const [supplier, setSupplier] = useState(initSupplier);
  const [notes, setNotes] = useState(initNotes);
  const [saving, setSaving] = useState(false);

  const isDirty = isEdit ? (
    name !== initName ||
    category !== initCategory ||
    unit !== initUnit ||
    qty !== initQty ||
    minLevel !== initMinLevel ||
    cost !== initCost ||
    supplier !== initSupplier ||
    notes !== initNotes
  ) : true;

  const canSave = name.trim() !== '' && isDirty;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        category,
        unit,
        qty_on_hand: qty,
        min_level: minLevel,
        cost_per_unit: cost,
        supplier: supplier.trim(),
        notes: notes.trim(),
      });
      onOpenChange(false);
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? tr('inv_edit_item') : tr('inv_add_item')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">{tr('name')} *</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder={tr('inv_item_name_ph')} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">{tr('category')}</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="flex h-9 w-full items-center rounded-md border border-input bg-input-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{tr('inv_cat_' + c.toLowerCase().replace(/ /g, '_')) || c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">{tr('inv_unit')}</label>
              <select
                value={unit}
                onChange={e => setUnit(e.target.value)}
                className="flex h-9 w-full items-center rounded-md border border-input bg-input-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              >
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">{tr('inv_qty_on_hand')}</label>
              <Input type="number" value={qty} onChange={e => setQty(e.target.value)} min="0" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">{tr('inv_min_level')}</label>
              <Input type="number" value={minLevel} onChange={e => setMinLevel(e.target.value)} min="0" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">{tr('inv_cost_per_unit')}</label>
              <Input type="number" value={cost} onChange={e => setCost(e.target.value)} min="0" step="0.01" placeholder="0.00" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">{tr('inv_supplier')}</label>
              <Input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder={tr('inv_supplier_ph')} />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">{tr('inv_notes')}</label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={tr('inv_notes_ph')} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {tr('cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving || !canSave}>
            {saving ? tr('saving') : isEdit ? tr('update') : tr('add_item')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
