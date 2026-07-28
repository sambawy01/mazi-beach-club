import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import {
  fetchOrdersFromSupabase,
  updateOrderStatusInSupabase,
  getStoredPassword,
  SupabaseOrder,
} from '@/services/adminService';
import { AdminLang } from './useAdminLang';
import { toast } from 'sonner';
import {
  Loader2, Check, X, ChefHat, Bike, PackageCheck, Ban, RefreshCw, UtensilsCrossed,
  MapPin, CreditCard, Mail, StickyNote, Phone,
} from 'lucide-react';

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending_approval: { label: 'Pending', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  confirmed: { label: 'Confirmed', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  preparing: { label: 'Preparing', className: 'bg-purple-100 text-purple-800 border-purple-200' },
  out_for_delivery: { label: 'Out for delivery', className: 'bg-cyan-100 text-cyan-800 border-cyan-200' },
  delivered: { label: 'Delivered', className: 'bg-green-100 text-green-800 border-green-200' },
  served: { label: 'Served', className: 'bg-green-100 text-green-800 border-green-200' },
  declined: { label: 'Declined', className: 'bg-red-100 text-red-800 border-red-200' },
  cancelled: { label: 'Cancelled', className: 'bg-gray-100 text-gray-600 border-gray-200' },
};

const STATUS_ORDER: Record<string, number> = {
  pending_approval: 0, confirmed: 1, preparing: 1, out_for_delivery: 1,
  delivered: 3, served: 3, declined: 4, cancelled: 4,
};

const PAYMENT_LABEL: Record<string, string> = {
  cod: 'Cash on delivery',
  card_on_delivery: 'Card on delivery',
  instapay: 'InstaPay',
};

function paymentLabel(pm: string): string {
  if (!pm) return '—';
  return PAYMENT_LABEL[pm] ?? pm;
}

const TERMINAL_STATUSES = new Set(['delivered', 'served', 'declined', 'cancelled']);

function slotLabel12h(slot: string | null): string {
  if (!slot || !/^\d{1,2}:\d{2}$/.test(slot)) return slot || '—';
  const [hStr, mStr] = slot.split(':');
  const h = Number(hStr);
  const ampm = h >= 12 ? 'PM' : 'AM';
  let hr = h % 12;
  if (hr === 0) hr = 12;
  return `${hr}:${mStr} ${ampm}`;
}

function timeAgo(iso: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function OrdersTab({ l }: { l: AdminLang }) {
  const { tr } = l;
  const [orders, setOrders] = useState<SupabaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    const pw = getStoredPassword();
    if (!pw) { setLoading(false); return; }
    try {
      const data = await fetchOrdersFromSupabase(pw);
      data.sort((a, b) => {
        const oa = STATUS_ORDER[a.status] ?? 2;
        const ob = STATUS_ORDER[b.status] ?? 2;
        if (oa !== ob) return oa - ob;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      setOrders(data);
    } catch (err) {
      toast.error('Failed to load orders from database');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  async function changeStatus(order: SupabaseOrder, status: string, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    const pw = getStoredPassword();
    if (!pw) return;
    setBusyId(order.id);
    try {
      await updateOrderStatusInSupabase(pw, order.id, status);
      toast.success(`Order → ${STATUS_BADGE[status]?.label ?? status}`);
      await fetchOrders();
    } catch {
      toast.error('Failed to update order');
    } finally {
      setBusyId(null);
    }
  }

  function rowActions(order: SupabaseOrder) {
    const busy = busyId === order.id;
    if (busy) {
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" /> Updating…
        </div>
      );
    }

    const isDineIn = order.mode === 'dine_in';

    switch (order.status) {
      case 'pending_approval':
        return (
          <div className="flex flex-wrap gap-2">
            <Button
              size="lg"
              className="flex-1 min-w-[8rem] bg-green-600 hover:bg-green-700 text-white"
              onClick={() => changeStatus(order, 'confirmed')}
            >
              <Check className="size-4 mr-1.5" />Approve
            </Button>
            <Button
              size="lg"
              variant="destructive"
              className="flex-1 min-w-[8rem]"
              onClick={() => changeStatus(order, 'declined', 'Decline this order? The customer will be notified.')}
            >
              <X className="size-4 mr-1.5" />Decline
            </Button>
          </div>
        );
      case 'confirmed':
        return (
          <div className="flex flex-wrap gap-2">
            <Button
              size="lg"
              className="flex-1 min-w-[8rem] bg-[#12207e] hover:bg-[#12207e]/90 text-white"
              onClick={() => changeStatus(order, 'preparing')}
            >
              <ChefHat className="size-4 mr-1.5" />Preparing
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="text-muted-foreground"
              onClick={() => changeStatus(order, 'cancelled', 'Cancel this order?')}
            >
              <Ban className="size-4 mr-1.5" />Cancel
            </Button>
          </div>
        );
      case 'preparing':
        return (
          <div className="flex flex-wrap gap-2">
            {isDineIn ? (
              <Button
                size="lg"
                className="flex-1 min-w-[8rem] bg-[#12207e] hover:bg-[#12207e]/90 text-white"
                onClick={() => changeStatus(order, 'served')}
              >
                <PackageCheck className="size-4 mr-1.5" />Served
              </Button>
            ) : (
              <Button
                size="lg"
                className="flex-1 min-w-[8rem] bg-[#12207e] hover:bg-[#12207e]/90 text-white"
                onClick={() => changeStatus(order, 'out_for_delivery')}
              >
                <Bike className="size-4 mr-1.5" />Out for delivery
              </Button>
            )}
            <Button
              size="lg"
              variant="outline"
              className="text-muted-foreground"
              onClick={() => changeStatus(order, 'cancelled', 'Cancel this order?')}
            >
              <Ban className="size-4 mr-1.5" />Cancel
            </Button>
          </div>
        );
      case 'out_for_delivery':
        return (
          <Button
            size="lg"
            className="flex-1 min-w-[8rem] bg-green-600 hover:bg-green-700 text-white"
            onClick={() => changeStatus(order, 'delivered')}
          >
            <PackageCheck className="size-4 mr-1.5" />Delivered
          </Button>
        );
      default:
        return null;
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {[0, 1, 2].map(i => (
          <div key={i} className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="h-6 w-32 animate-pulse rounded bg-muted" />
              <div className="h-6 w-20 animate-pulse rounded bg-muted" />
            </div>
            <div className="mt-4 space-y-3">
              <div className="h-10 w-full animate-pulse rounded bg-muted" />
              <div className="h-10 w-full animate-pulse rounded bg-muted" />
              <div className="h-10 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const pendingCount = orders.filter(o => o.status === 'pending_approval').length;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-semibold">
          Orders ({orders.length})
          {pendingCount > 0 && (
            <Badge className="ml-2 bg-amber-100 text-amber-800 border-amber-200">{pendingCount} pending</Badge>
          )}
        </h2>
        <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetchOrders(); }}>
          <RefreshCw className="size-3 mr-1" /> Refresh
        </Button>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-2xl border bg-white py-16 text-center text-muted-foreground shadow-sm">
          No orders yet.
        </div>
      ) : (
        <div className="space-y-5">
          {orders.map((order, idx) => {
            const badge = STATUS_BADGE[order.status];
            const isDineIn = order.mode === 'dine_in';
            const isPending = order.status === 'pending_approval';
            const isTerminal = TERMINAL_STATUSES.has(order.status);
            const items = order.items || [];
            const actions = rowActions(order);

            return (
              <motion.article
                key={order.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: Math.min(idx * 0.03, 0.2) }}
                className={[
                  'rounded-2xl border bg-white shadow-sm overflow-hidden',
                  isPending ? 'border-l-4 border-l-amber-400' : '',
                  isTerminal ? 'opacity-70' : '',
                ].join(' ')}
              >
                {/* Header */}
                <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-lg font-bold tracking-tight text-[#12207e]">
                        {order.order_ref}
                      </span>
                      {isDineIn ? (
                        <Badge className="bg-[#12207e]/10 text-[#12207e] border-[#12207e]/20">
                          <UtensilsCrossed className="size-3 mr-1" /> Dine-in
                        </Badge>
                      ) : (
                        <Badge variant="outline">Delivery</Badge>
                      )}
                      {badge
                        ? <Badge className={badge.className}>{badge.label}</Badge>
                        : <Badge variant="outline">{order.status}</Badge>}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {isDineIn ? timeAgo(order.created_at) : `Delivery ${slotLabel12h(order.delivery_slot)}`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold leading-none">EGP {order.total}</div>
                  </div>
                </div>

                {/* Customer */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pb-4 text-sm">
                  <span className="font-semibold">{order.customer_name || '—'}</span>
                  {order.customer_phone && (
                    <a
                      href={`tel:${order.customer_phone}`}
                      className="inline-flex items-center gap-1 text-[#12207e] hover:underline"
                    >
                      <Phone className="size-3.5" />{order.customer_phone}
                    </a>
                  )}
                </div>

                {/* Items */}
                <div className="border-t bg-[#f6f2e8]/60 px-5 py-4">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Items
                  </div>
                  <ul className="divide-y divide-black/5">
                    {items.map((item, i) => (
                      <li key={i} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                        <span className="inline-flex min-w-[2.75rem] shrink-0 items-center justify-center rounded-lg bg-[#12207e] px-2 py-1 text-base font-bold leading-none text-white">
                          {item.quantity}×
                        </span>
                        <span className="flex-1 break-words text-base font-medium leading-snug">
                          {item.name}
                        </span>
                        <span className="shrink-0 whitespace-nowrap pt-0.5 text-sm text-muted-foreground">
                          EGP {Math.round(item.price * item.quantity)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Note callout */}
                {order.note && (
                  <div className="mx-5 mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
                    <div className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
                      <StickyNote className="size-3.5" /> Note
                    </div>
                    <p className="text-sm leading-snug break-words">{order.note}</p>
                  </div>
                )}

                {/* Fulfilment details */}
                <div className="space-y-1.5 px-5 pt-4 text-sm text-muted-foreground">
                  {isDineIn ? (
                    <div className="flex items-start gap-2">
                      <UtensilsCrossed className="mt-0.5 size-4 shrink-0" />
                      <span>{order.table_label ? `Table ${order.table_label}` : 'Dine-in'}</span>
                    </div>
                  ) : (
                    <>
                      {order.delivery_address && (
                        <div className="flex items-start gap-2">
                          <MapPin className="mt-0.5 size-4 shrink-0" />
                          <span className="break-words">{order.delivery_address}</span>
                        </div>
                      )}
                      <div className="flex items-start gap-2">
                        <CreditCard className="mt-0.5 size-4 shrink-0" />
                        <span>{paymentLabel(order.payment_method)}</span>
                      </div>
                      {order.customer_email && (
                        <div className="flex items-start gap-2">
                          <Mail className="mt-0.5 size-4 shrink-0" />
                          <span className="break-words">{order.customer_email}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Totals breakdown */}
                <div className="mt-4 border-t px-5 py-4">
                  <dl className="ml-auto max-w-[16rem] space-y-1 text-sm">
                    <div className="flex justify-between text-muted-foreground">
                      <dt>Subtotal</dt>
                      <dd>EGP {order.subtotal}</dd>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <dt>VAT (14%)</dt>
                      <dd>EGP {order.vat_amount}</dd>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <dt>Service (12%)</dt>
                      <dd>EGP {order.service_amount}</dd>
                    </div>
                    <div className="flex justify-between border-t pt-1.5 text-base font-bold text-foreground">
                      <dt>Total</dt>
                      <dd>EGP {order.total}</dd>
                    </div>
                  </dl>
                </div>

                {/* Action footer */}
                {actions && (
                  <div className="border-t bg-white px-5 py-4">
                    {actions}
                  </div>
                )}
              </motion.article>
            );
          })}
        </div>
      )}
    </div>
  );
}
