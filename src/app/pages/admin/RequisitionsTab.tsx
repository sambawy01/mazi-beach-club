import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/app/components/ui/table';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Input } from '@/app/components/ui/input';
import {
  StockItem, Requisition,
  getInventory, getRequisitions,
  restockItem,
  submitManualRequisition,
  approveRequisition, rejectRequisition, outOfStockRequisition,
} from '@/services/inventoryService';
import { Role } from '@/services/adminService';
import { SearchableSelect } from './SearchableSelect';
import { AdminLang } from './useAdminLang';
import { toast } from 'sonner';
import { Loader2, Minus, PackagePlus, ClipboardList, Check, X, Plus, Trash2, Send } from 'lucide-react';

const DEDUCTION_REASONS = ['Kitchen Use', 'Waste', 'Staff Meal', 'Other'];

interface CartItem {
  id: number;
  itemName: string;
  quantity: string;
  reason: string;
  unit: string;
}

let cartIdCounter = 0;

export function RequisitionsTab({ l, role }: { l: AdminLang; role: Role }) {
  const { tr } = l;
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [loading, setLoading] = useState(true);
  // Cart-based manual deduction
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartPerformedBy, setCartPerformedBy] = useState('');
  const [cartSubmitting, setCartSubmitting] = useState(false);

  // Quick-add row state
  const [addItem, setAddItem] = useState('');
  const [addQty, setAddQty] = useState('');
  const [addReason, setAddReason] = useState(DEDUCTION_REASONS[0]);

  // Restock state (accounting only)
  const [restockItemName, setRestockItemName] = useState('');
  const [restockQty, setRestockQty] = useState('');
  const [restockPerformedBy, setRestockPerformedBy] = useState('');
  const [restocking, setRestocking] = useState(false);

  // Approving state
  const [approvingRow, setApprovingRow] = useState<string | null>(null);

  const isChef = role === 'chef';
  const canApprove = role === 'admin' || role === 'accounting';
  const canRestock = role === 'admin' || role === 'accounting';
  const canSubmitReqs = role === 'admin' || role === 'chef';

  const fetchAll = useCallback(async () => {
    try {
      const [inv, reqs] = await Promise.all([
        getInventory(), getRequisitions(),
      ]);
      setStockItems(inv);
      setRequisitions(reqs);
    } catch (err) {
      toast.error(tr('inv_failed_load'));
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const pendingReqs = requisitions.filter(r => r.status === 'Pending');

  // ── Cart functions ──
  function handleAddToCart() {
    if (!addItem || !addQty || Number(addQty) < 1) return;
    const stock = stockItems.find(s => s.name === addItem);
    setCart(prev => [...prev, {
      id: ++cartIdCounter,
      itemName: addItem,
      quantity: addQty,
      reason: addReason,
      unit: stock?.unit || '',
    }]);
    setAddItem('');
    setAddQty('');
  }

  function handleRemoveFromCart(id: number) {
    setCart(prev => prev.filter(c => c.id !== id));
  }

  async function handleSubmitCart() {
    if (cart.length === 0) return;
    setCartSubmitting(true);
    try {
      const by = cartPerformedBy.trim() || 'Chef';
      for (const item of cart) {
        await submitManualRequisition(item.itemName, Number(item.quantity), item.reason, by);
      }
      toast.success(tr('inv_req_submitted') + ` (${cart.length} ${tr('inv_items_label')})`);
      setCart([]);
      setCartPerformedBy('');
      await fetchAll();
    } catch (err: any) {
      toast.error(err.message || tr('inv_failed_submit'));
    } finally {
      setCartSubmitting(false);
    }
  }

  // ── Restock ──
  async function handleRestock() {
    if (!restockItemName || Number(restockQty) < 1) return;
    const item = stockItems.find(s => s.name === restockItemName);
    if (!item) return;
    setRestocking(true);
    try {
      await restockItem(item.id, Number(restockQty), restockPerformedBy.trim() || 'Accounting');
      toast.success(tr('inv_restocked'));
      setRestockItemName(''); setRestockQty(''); setRestockPerformedBy('');
      await fetchAll();
    } catch (err: any) {
      toast.error(err.message || tr('inv_failed_restock'));
    } finally {
      setRestocking(false);
    }
  }

  // ── Approve / Reject ──
  async function handleApprove(req: Requisition) {
    setApprovingRow(req.id);
    try {
      await approveRequisition(req.id);
      toast.success(tr('inv_req_approved'));
      await fetchAll();
    } catch (err: any) {
      toast.error(err.message || tr('inv_failed_approve'));
    } finally {
      setApprovingRow(null);
    }
  }

  async function handleReject(req: Requisition) {
    if (!confirm(tr('inv_confirm_reject') + ` "${req.item_name}"?`)) return;
    setApprovingRow(req.id);
    try {
      await rejectRequisition(req.id);
      toast.success(tr('inv_req_rejected'));
      await fetchAll();
    } catch (err: any) {
      toast.error(err.message || tr('inv_failed_reject'));
    } finally {
      setApprovingRow(null);
    }
  }

  // ── Badge helpers ──
  function statusBadge(status: string) {
    if (status === 'Approved') return <Badge className="bg-green-100 text-green-800 hover:bg-green-200">{tr('inv_status_approved')}</Badge>;
    if (status === 'Rejected') return <Badge variant="destructive">{tr('inv_status_rejected')}</Badge>;
    if (status === 'Pending') return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-200">{tr('inv_status_pending')}</Badge>;
    return <Badge variant="secondary">{status || '—'}</Badge>;
  }

  function directionBadge(dir: string) {
    if (dir === 'IN') return <Badge className="bg-green-100 text-green-800 hover:bg-green-200">IN</Badge>;
    return <Badge variant="destructive">OUT</Badge>;
  }

  function typeBadge(type: string) {
    const colors: Record<string, string> = {
      'Recipe': 'bg-blue-100 text-blue-800',
      'Manual': 'bg-amber-100 text-amber-800',
      'Restock': 'bg-green-100 text-green-800',
    };
    return (
      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors[type] || 'bg-gray-100 text-gray-700'}`}>
        {type}
      </span>
    );
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Pending count banner */}
      {canApprove && pendingReqs.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <ClipboardList className="size-5 shrink-0" />
          <span className="font-medium">
            {pendingReqs.length} {tr('inv_pending_requests')}
          </span>
        </div>
      )}

      {/* Action cards row */}
      <div className={`grid gap-4`}>
        {/* Restock Card — accounting & admin only */}
        {canRestock && (
          <div className="rounded-lg border bg-white p-4 space-y-3">
            <div className="flex items-center gap-2 font-semibold text-sm">
              <PackagePlus className="size-4 text-green-600" /> {tr('inv_restock')}
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{tr('inv_stock_item')}</label>
              <SearchableSelect
                value={restockItemName}
                onChange={setRestockItemName}
                placeholder={tr('inv_select_item')}
                options={stockItems.map(s => ({ value: s.name, label: `${s.name} (${s.qty_on_hand} ${s.unit})` }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">{tr('inv_quantity')}</label>
                <Input type="number" value={restockQty} onChange={e => setRestockQty(e.target.value)} min="1" className="h-10 sm:h-8 text-base sm:text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">{tr('inv_performed_by')}</label>
                <Input value={restockPerformedBy} onChange={e => setRestockPerformedBy(e.target.value)} placeholder="Accounting" className="h-10 sm:h-8 text-base sm:text-sm" />
              </div>
            </div>
            <Button
              onClick={handleRestock}
              disabled={restocking || !restockItemName || Number(restockQty) < 1}
              className="w-full bg-green-600 hover:bg-green-700"
              size="sm"
            >
              {restocking ? <Loader2 className="size-4 animate-spin mr-1" /> : <PackagePlus className="size-4 mr-1" />}
              {tr('inv_add_stock')}
            </Button>
          </div>
        )}
      </div>

      {/* Manual Requisition Builder — chef & admin */}
      {canSubmitReqs && (
        <div className="rounded-lg border bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold text-sm">
              <Minus className="size-4 text-amber-600" /> {tr('inv_manual_deduction')}
            </div>
            {cart.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {cart.length} {tr('inv_items_label')}
              </span>
            )}
          </div>

          {/* Add item row — stacks on mobile */}
          <div className="space-y-2 sm:space-y-0 sm:flex sm:items-end sm:gap-2">
            <div className="flex-1 min-w-0">
              <label className="text-xs text-muted-foreground mb-1 block">{tr('inv_stock_item')}</label>
              <SearchableSelect
                value={addItem}
                onChange={setAddItem}
                placeholder={tr('inv_select_item')}
                options={stockItems.map(s => ({ value: s.name, label: `${s.name} (${s.qty_on_hand} ${s.unit})` }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:contents">
              <div className="sm:w-20">
                <label className="text-xs text-muted-foreground mb-1 block">{tr('inv_quantity')}</label>
                <Input type="number" value={addQty} onChange={e => setAddQty(e.target.value)} min="1" className="h-10 sm:h-9 text-base sm:text-sm" placeholder="0" />
              </div>
              <div className="sm:w-32">
                <label className="text-xs text-muted-foreground mb-1 block">{tr('inv_reason')}</label>
                <select
                  value={addReason}
                  onChange={e => setAddReason(e.target.value)}
                  className="flex h-10 sm:h-9 w-full items-center rounded-md border border-input bg-input-background px-3 py-2 text-base sm:text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                >
                  {DEDUCTION_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
            <Button
              size="sm"
              className="h-10 sm:h-9 w-full sm:w-auto"
              onClick={handleAddToCart}
              disabled={!addItem || !addQty || Number(addQty) < 1}
            >
              <Plus className="size-4 mr-1 sm:mr-0" />
              <span className="sm:hidden">{tr('inv_add_to_cart')}</span>
            </Button>
          </div>

          {/* Cart table */}
          {cart.length > 0 && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr('name')}</TableHead>
                    <TableHead>{tr('inv_quantity')}</TableHead>
                    <TableHead>{tr('inv_reason')}</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cart.map(item => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.itemName}</TableCell>
                      <TableCell>{item.quantity} {item.unit}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{item.reason}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => handleRemoveFromCart(item.id)}>
                          <Trash2 className="size-3.5 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex items-center gap-2 pt-1">
                <div className="flex-1">
                  <Input
                    value={cartPerformedBy}
                    onChange={e => setCartPerformedBy(e.target.value)}
                    placeholder={`${tr('inv_performed_by')}: ${isChef ? 'Chef' : 'Admin'}`}
                    className="h-8"
                  />
                </div>
                <Button
                  onClick={handleSubmitCart}
                  disabled={cartSubmitting}
                  size="sm"
                >
                  {cartSubmitting ? <Loader2 className="size-4 animate-spin mr-1" /> : <Send className="size-4 mr-1" />}
                  {isChef ? tr('inv_submit_all') : tr('inv_deduct_all')} ({cart.length})
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Log header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{tr('inv_requisition_log')} ({requisitions.length})</h2>
      </div>

      {/* Requisitions Log — Cards on mobile, Table on desktop */}

      {/* Mobile card view */}
      <div className="sm:hidden space-y-3">
        {requisitions.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">{tr('inv_no_requisitions')}</div>
        )}
        {requisitions.map((req, idx) => (
          <div
            key={req.id}
            className={`rounded-lg border bg-white p-4 space-y-2 ${req.status === 'Pending' ? 'border-amber-300 bg-amber-50/30' : ''}`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-base">{req.item_name}</span>
              <span className="text-xs text-muted-foreground">#{idx + 1}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {typeBadge(req.type)}
              {directionBadge(req.direction)}
              <span className="text-sm">{req.quantity} {tr('inv_units') || 'units'}</span>
            </div>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{req.date}</span>
              <span>{req.performed_by}</span>
            </div>
            {req.notes && (
              <div className="text-sm text-muted-foreground">{req.notes}</div>
            )}
            {/* Status control */}
            <div className="pt-1">
              {canApprove ? (
                <div className="flex items-center gap-2">
                  <select
                    value={req.status || 'Pending'}
                    onChange={async (e) => {
                      const newStatus = e.target.value;
                      const currentStatus = req.status || 'Pending';
                      if (newStatus === currentStatus) return;
                      setApprovingRow(req.id);
                      try {
                        if (newStatus === 'Approved') {
                          await approveRequisition(req.id);
                          toast.success(tr('inv_req_approved'));
                        } else if (newStatus === 'Rejected') {
                          await rejectRequisition(req.id);
                          toast.success(tr('inv_req_rejected'));
                        } else if (newStatus === 'Out of Stock') {
                          await outOfStockRequisition(req.id);
                          toast.success(tr('inv_req_out_of_stock'));
                        }
                        await fetchAll();
                      } catch (err: any) {
                        toast.error(err.message || tr('inv_failed_approve'));
                      } finally {
                        setApprovingRow(null);
                      }
                    }}
                    disabled={approvingRow === req.id}
                    className={`h-10 rounded-md border text-sm font-medium px-3 py-2 outline-none cursor-pointer flex-1 ${
                      req.status === 'Approved' ? 'bg-green-100 text-green-800 border-green-200' :
                      req.status === 'Rejected' ? 'bg-red-100 text-red-800 border-red-200' :
                      req.status === 'Out of Stock' ? 'bg-gray-100 text-gray-700 border-gray-200' :
                      'bg-amber-100 text-amber-800 border-amber-200'
                    }`}
                  >
                    <option value="Pending">{tr('inv_status_pending')}</option>
                    <option value="Approved">{tr('inv_status_approved')}</option>
                    <option value="Rejected">{tr('inv_status_rejected')}</option>
                    <option value="Out of Stock">{tr('inv_status_out_of_stock')}</option>
                  </select>
                  {approvingRow === req.id && <Loader2 className="size-4 animate-spin" />}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {statusBadge(req.status)}
                  {approvingRow === req.id && <Loader2 className="size-4 animate-spin" />}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table view */}
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>{tr('inv_date')}</TableHead>
              <TableHead>{tr('type')}</TableHead>
              <TableHead>{tr('name')}</TableHead>
              <TableHead>{tr('inv_quantity')}</TableHead>
              <TableHead>{tr('inv_direction')}</TableHead>
              <TableHead>{tr('status')}</TableHead>
              <TableHead>{tr('inv_performed_by')}</TableHead>
              <TableHead>{tr('inv_notes')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requisitions.map((req, idx) => (
              <TableRow key={req.id} className={req.status === 'Pending' ? 'bg-amber-50/50' : ''}>
                <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                <TableCell className="text-sm">{req.date}</TableCell>
                <TableCell>{typeBadge(req.type)}</TableCell>
                <TableCell className="font-medium">{req.item_name}</TableCell>
                <TableCell>{req.quantity}</TableCell>
                <TableCell>{directionBadge(req.direction)}</TableCell>
                <TableCell>
                  {canApprove ? (
                    <select
                      value={req.status || 'Pending'}
                      onChange={async (e) => {
                        const newStatus = e.target.value;
                        const currentStatus = req.status || 'Pending';
                        if (newStatus === currentStatus) return;
                        setApprovingRow(req.id);
                        try {
                          if (newStatus === 'Approved') {
                            await approveRequisition(req.id);
                            toast.success(tr('inv_req_approved'));
                          } else if (newStatus === 'Rejected') {
                            await rejectRequisition(req.id);
                            toast.success(tr('inv_req_rejected'));
                          } else if (newStatus === 'Out of Stock') {
                            await outOfStockRequisition(req.id);
                            toast.success(tr('inv_req_out_of_stock'));
                          }
                          await fetchAll();
                        } catch (err: any) {
                          toast.error(err.message || tr('inv_failed_approve'));
                        } finally {
                          setApprovingRow(null);
                        }
                      }}
                      disabled={approvingRow === req.id}
                      className={`h-7 rounded-md border text-xs font-medium px-2 py-0.5 outline-none cursor-pointer ${
                        req.status === 'Approved' ? 'bg-green-100 text-green-800 border-green-200' :
                        req.status === 'Rejected' ? 'bg-red-100 text-red-800 border-red-200' :
                        req.status === 'Out of Stock' ? 'bg-gray-100 text-gray-700 border-gray-200' :
                        'bg-amber-100 text-amber-800 border-amber-200'
                      }`}
                    >
                      <option value="Pending">{tr('inv_status_pending')}</option>
                      <option value="Approved">{tr('inv_status_approved')}</option>
                      <option value="Rejected">{tr('inv_status_rejected')}</option>
                      <option value="Out of Stock">{tr('inv_status_out_of_stock')}</option>
                    </select>
                  ) : (
                    statusBadge(req.status)
                  )}
                  {approvingRow === req.id && <Loader2 className="size-3 animate-spin inline ml-1" />}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{req.performed_by}</TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{req.notes}</TableCell>
              </TableRow>
            ))}
            {requisitions.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">{tr('inv_no_requisitions')}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

    </div>
  );
}
