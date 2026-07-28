import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/app/components/ui/table';
import {
  Recipe, StockItem, getRecipes, addRecipe, editRecipe, deleteRecipe, getInventory,
} from '@/services/inventoryService';
import { AdminLang } from './useAdminLang';
import { toast } from 'sonner';
import { Plus, Trash2, Loader2, Save, X } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  l: AdminLang;
}

export function RecipeManagerDialog({ open, onOpenChange, l }: Props) {
  const { tr } = l;
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuItemFilter, setMenuItemFilter] = useState('');

  // Inline add form state
  const [adding, setAdding] = useState(false);
  const [newMenuItem, setNewMenuItem] = useState('');
  const [newIngredient, setNewIngredient] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newUnit, setNewUnit] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([getRecipes(), getInventory()]);
      setRecipes(r);
      setStockItems(s);
    } catch (err) {
      toast.error(tr('inv_failed_load_recipes'));
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => {
    if (open) fetchData();
  }, [open, fetchData]);

  const menuItems = [...new Set(recipes.map(r => r.menu_item))].sort();

  const filtered = menuItemFilter
    ? recipes.filter(r => r.menu_item === menuItemFilter)
    : recipes;

  async function handleAdd() {
    if (!newMenuItem.trim() || !newIngredient.trim() || !newQty) return;
    setSaving(true);
    try {
      await addRecipe({
        menu_item: newMenuItem.trim(),
        ingredient: newIngredient.trim(),
        qty_needed: newQty,
        unit: newUnit || 'g',
      });
      toast.success(tr('inv_recipe_added'));
      setAdding(false);
      setNewMenuItem(''); setNewIngredient(''); setNewQty(''); setNewUnit('');
      await fetchData();
    } catch (err) {
      console.error(err);
      toast.error(tr('inv_failed_save_recipe'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(recipe: Recipe) {
    if (!confirm(`${tr('confirm_delete')} "${recipe.ingredient}" from "${recipe.menu_item}"?`)) return;
    try {
      await deleteRecipe(recipe.id);
      toast.success(tr('inv_recipe_deleted'));
      await fetchData();
    } catch { toast.error(tr('failed_delete')); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tr('inv_manage_recipes')}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 mb-4">
          <select
            value={menuItemFilter}
            onChange={e => setMenuItemFilter(e.target.value)}
            className="flex h-9 flex-1 items-center rounded-md border border-input bg-input-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          >
            <option value="">{tr('inv_all_menu_items')}</option>
            {menuItems.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <Button size="sm" onClick={() => setAdding(true)} disabled={adding}>
            <Plus className="size-4 mr-1" /> {tr('inv_add_recipe_line')}
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr('inv_menu_item')}</TableHead>
                <TableHead>{tr('inv_ingredient')}</TableHead>
                <TableHead>{tr('inv_qty_needed')}</TableHead>
                <TableHead>{tr('inv_unit')}</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adding && (
                <TableRow>
                  <TableCell>
                    <Input value={newMenuItem} onChange={e => setNewMenuItem(e.target.value)} placeholder={tr('inv_menu_item')} className="h-8" />
                  </TableCell>
                  <TableCell>
                    <select
                      value={newIngredient}
                      onChange={e => {
                        setNewIngredient(e.target.value);
                        const si = stockItems.find(s => s.name === e.target.value);
                        if (si) setNewUnit(si.unit);
                      }}
                      className="flex h-8 w-full items-center rounded-md border border-input bg-input-background px-2 py-1 text-sm outline-none"
                    >
                      <option value="">{tr('inv_select_ingredient')}</option>
                      {stockItems.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                    </select>
                  </TableCell>
                  <TableCell>
                    <Input type="number" value={newQty} onChange={e => setNewQty(e.target.value)} min="0" step="0.01" className="h-8 w-20" />
                  </TableCell>
                  <TableCell>
                    <Input value={newUnit} onChange={e => setNewUnit(e.target.value)} className="h-8 w-16" placeholder="g" />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={handleAdd} disabled={saving}>
                        <Save className="size-4 text-green-600" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                        <X className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {filtered.map(recipe => (
                <TableRow key={recipe.id}>
                  <TableCell className="font-medium">{recipe.menu_item}</TableCell>
                  <TableCell>{recipe.ingredient}</TableCell>
                  <TableCell>{recipe.qty_needed}</TableCell>
                  <TableCell>{recipe.unit}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(recipe)}>
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && !adding && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">{tr('inv_no_recipes')}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
