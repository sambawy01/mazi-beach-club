import React, { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { StockItem } from '@/services/inventoryService';
import { AdminLang } from './useAdminLang';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: StockItem | null;
  onRestock: (id: string, quantity: number, performedBy: string) => Promise<void>;
  l: AdminLang;
}

export function RestockDialog({ open, onOpenChange, item, onRestock, l }: Props) {
  const { tr } = l;
  const [quantity, setQuantity] = useState('');
  const [performedBy, setPerformedBy] = useState('');
  const [saving, setSaving] = useState(false);

  if (!item) return null;

  const canSave = Number(quantity) > 0;

  async function handleRestock() {
    if (!canSave || !item) return;
    setSaving(true);
    try {
      await onRestock(item.id, Number(quantity), performedBy.trim() || 'Admin');
      onOpenChange(false);
      setQuantity('');
      setPerformedBy('');
    } catch (err) {
      console.error('Restock failed:', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{tr('inv_restock')}: {item.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            {tr('inv_current_stock')}: <span className="font-medium text-foreground">{item.qty_on_hand} {item.unit}</span>
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">{tr('inv_quantity')} ({item.unit}) *</label>
            <Input
              type="number"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              min="1"
              placeholder="0"
              autoFocus
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">{tr('inv_performed_by')}</label>
            <Input
              value={performedBy}
              onChange={e => setPerformedBy(e.target.value)}
              placeholder="Admin"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {tr('cancel')}
          </Button>
          <Button onClick={handleRestock} disabled={saving || !canSave}>
            {saving ? tr('saving') : tr('inv_restock')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
