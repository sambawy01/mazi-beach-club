import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/app/components/ui/table';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Switch } from '@/app/components/ui/switch';
import { Input } from '@/app/components/ui/input';
import {
  AdminItem, getPantryItems, addPantryItem, editPantryItem, deletePantryItem,
  togglePantryVisibility, getStoredPassword,
} from '@/services/adminService';
import { ItemFormDialog } from './ItemFormDialog';
import { AdminLang } from './useAdminLang';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Loader2, ArrowUp, ArrowDown, Search } from 'lucide-react';

type SortKey = 'name' | 'category' | 'price' | 'status' | 'visible';
type SortDir = 'asc' | 'desc';

export function PantryTab({ l }: { l: AdminLang }) {
  const { tr } = l;
  const [items, setItems] = useState<AdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<AdminItem | null>(null);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [search, setSearch] = useState('');

  const fetchItems = useCallback(async () => {
    const pw = getStoredPassword();
    if (!pw) return;
    try {
      const data = await getPantryItems(pw);
      setItems(data);
    } catch (err) {
      toast.error(tr('failed_load_products'));
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  function openAdd() { setEditItem(null); setDialogOpen(true); }
  function openEdit(item: AdminItem) { setEditItem(item); setDialogOpen(true); }

  async function handleSave(data: Record<string, string>) {
    const pw = getStoredPassword();
    if (!pw) return;
    if (editItem) {
      await editPantryItem(pw, editItem.id, data);
      toast.success(tr('product_updated'));
    } else {
      await addPantryItem(pw, data);
      toast.success(tr('product_added'));
    }
    await fetchItems();
  }

  async function handleDelete(item: AdminItem) {
    if (!confirm(`${tr('confirm_delete')} "${item.name}"?`)) return;
    const pw = getStoredPassword();
    if (!pw) return;
    try {
      await deletePantryItem(pw, item.id);
      toast.success(tr('product_deleted'));
      await fetchItems();
    } catch { toast.error(tr('failed_delete')); }
  }

  async function handleToggleVisibility(item: AdminItem) {
    const pw = getStoredPassword();
    if (!pw) return;
    const newStatus = item.status === 'available' || item.status === 'limited' ? 'hidden' : 'available';
    try {
      await togglePantryVisibility(pw, item.id, newStatus);
      await fetchItems();
    } catch { toast.error(tr('failed_toggle')); }
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  function getSortedItems(): AdminItem[] {
    let filtered = items;
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = items.filter(item =>
        item.name.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.dietary.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
      );
    }
    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => {
      let aVal: string | number, bVal: string | number;
      switch (sortKey) {
        case 'name': aVal = a.name.toLowerCase(); bVal = b.name.toLowerCase(); break;
        case 'category': aVal = a.category.toLowerCase(); bVal = b.category.toLowerCase(); break;
        case 'price': aVal = Number(a.price) || 0; bVal = Number(b.price) || 0; break;
        case 'status': aVal = a.status; bVal = b.status; break;
        case 'visible': {
          aVal = a.status === 'available' || a.status === 'limited' ? 1 : 0;
          bVal = b.status === 'available' || b.status === 'limited' ? 1 : 0; break;
        }
        default: return 0;
      }
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) return null;
    return sortDir === 'asc' ? <ArrowUp className="size-3 inline ml-1" /> : <ArrowDown className="size-3 inline ml-1" />;
  }

  const statusVariant = (s: string) => {
    if (s === 'available') return 'default' as const;
    if (s === 'limited') return 'secondary' as const;
    return 'destructive' as const;
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3">
        <h2 className="text-lg font-semibold shrink-0">{tr('pantry_products')} ({items.length})</h2>
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder={tr('search_products')} value={search} onChange={e => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Button onClick={openAdd} size="sm" className="shrink-0"><Plus className="size-4 mr-1" /> {tr('add_product')}</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead className="w-14">{tr('image')}</TableHead>
            <TableHead className="cursor-pointer select-none" onClick={() => handleSort('name')}>{tr('name')}<SortIcon column="name" /></TableHead>
            <TableHead className="cursor-pointer select-none" onClick={() => handleSort('category')}>{tr('category')}<SortIcon column="category" /></TableHead>
            <TableHead className="cursor-pointer select-none" onClick={() => handleSort('price')}>{tr('price')}<SortIcon column="price" /></TableHead>
            <TableHead className="cursor-pointer select-none" onClick={() => handleSort('status')}>{tr('status')}<SortIcon column="status" /></TableHead>
            <TableHead className="cursor-pointer select-none" onClick={() => handleSort('visible')}>{tr('visible')}<SortIcon column="visible" /></TableHead>
            <TableHead className="text-right">{tr('actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {getSortedItems().map((item, idx) => {
            const isVisible = item.status === 'available' || item.status === 'limited';
            return (
              <TableRow key={item.id} className={!isVisible ? 'opacity-50' : ''}>
                <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                <TableCell>
                  {item.image ? <img src={item.image} alt="" className="size-10 rounded object-cover" /> : <div className="size-10 rounded bg-muted" />}
                </TableCell>
                <TableCell className="font-medium">{item.name}</TableCell>
                <TableCell>{item.category}</TableCell>
                <TableCell>{item.price} {tr('egp')}</TableCell>
                <TableCell><Badge variant={statusVariant(item.status)}>{tr(item.status || 'available')}</Badge></TableCell>
                <TableCell><Switch checked={isVisible} onCheckedChange={() => handleToggleVisibility(item)} className="data-[state=unchecked]:bg-gray-300 data-[state=unchecked]:border-gray-400" /></TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(item)}><Pencil className="size-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(item)}><Trash2 className="size-4 text-destructive" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
          {getSortedItems().length === 0 && (
            <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">{tr('no_products')}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>

      <ItemFormDialog key={editItem?.id ?? 'new'} open={dialogOpen} onOpenChange={setDialogOpen} item={editItem} sheetType="Products" onSave={handleSave} l={l} />
    </div>
  );
}
