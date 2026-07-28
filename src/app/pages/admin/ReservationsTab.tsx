import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/app/components/ui/table';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Input } from '@/app/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/app/components/ui/dialog';
import {
  fetchReservationsFromSupabase,
  updateReservationStatusInSupabase,
  approveReservation,
  markPaidReservation,
  getStoredPassword,
  SupabaseReservation,
} from '@/services/adminService';
import { toast } from 'sonner';
import { Loader2, Check, X, RefreshCw, UtensilsCrossed, Umbrella, CreditCard, BadgeCheck } from 'lucide-react';

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  awaiting_payment: { label: 'Awaiting payment', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  confirmed: { label: 'Confirmed', className: 'bg-green-100 text-green-800 border-green-200' },
  declined: { label: 'Declined', className: 'bg-red-100 text-red-800 border-red-200' },
  cancelled: { label: 'Cancelled', className: 'bg-gray-100 text-gray-600 border-gray-200' },
  completed: { label: 'Completed', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  no_show: { label: 'No show', className: 'bg-gray-100 text-gray-600 border-gray-200' },
};

function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch { return dateStr; }
}

export function ReservationsTab() {
  const [reservations, setReservations] = useState<SupabaseReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Approve dialog (pending → awaiting_payment: collect payment link + amount)
  const [approveTarget, setApproveTarget] = useState<SupabaseReservation | null>(null);
  const [linkInput, setLinkInput] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchReservations = useCallback(async () => {
    const pw = getStoredPassword();
    if (!pw) { setLoading(false); return; }
    try {
      const data = await fetchReservationsFromSupabase(pw);
      setReservations(data);
    } catch (err) {
      toast.error('Failed to load reservations');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchReservations(); }, [fetchReservations]);

  async function changeStatus(res: SupabaseReservation, status: string) {
    const pw = getStoredPassword();
    if (!pw) return;
    setBusyId(res.id);
    try {
      await updateReservationStatusInSupabase(pw, res.id, status);
      toast.success(`Reservation → ${STATUS_BADGE[status]?.label ?? status}`);
      await fetchReservations();
    } catch {
      toast.error('Failed to update reservation');
    } finally {
      setBusyId(null);
    }
  }

  function openApprove(res: SupabaseReservation) {
    setApproveTarget(res);
    setLinkInput('');
    setAmountInput('');
  }

  const trimmedLink = linkInput.trim();
  const parsedAmount = parseFloat(amountInput);
  const canApprove =
    /^https?:\/\//i.test(trimmedLink) && Number.isFinite(parsedAmount) && parsedAmount > 0;

  async function submitApprove() {
    if (!approveTarget || !canApprove) return;
    setSubmitting(true);
    try {
      await approveReservation(approveTarget.id, trimmedLink, parsedAmount);
      toast.success('Reservation approved — payment request sent');
      setApproveTarget(null);
      await fetchReservations();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve reservation');
    } finally {
      setSubmitting(false);
    }
  }

  async function markPaid(res: SupabaseReservation) {
    setBusyId(res.id);
    try {
      await markPaidReservation(res.id);
      toast.success('Marked paid — QR ticket released');
      await fetchReservations();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to mark reservation paid');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  const pendingCount = reservations.filter(r => r.status === 'pending').length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">
          Reservations ({reservations.length})
          {pendingCount > 0 && (
            <Badge className="ml-2 bg-amber-100 text-amber-800 border-amber-200">{pendingCount} pending</Badge>
          )}
        </h2>
        <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetchReservations(); }}>
          <RefreshCw className="size-3 mr-1" /> Refresh
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reservations.map(res => {
            const badge = STATUS_BADGE[res.status];
            return (
              <TableRow key={res.id} className={res.status === 'pending' ? 'bg-amber-50/50' : undefined}>
                <TableCell>
                  {res.type === 'beach' ? (
                    <Badge className="bg-cyan-50 text-cyan-700 border-cyan-200">
                      <Umbrella className="size-3 mr-1" /> Beach
                    </Badge>
                  ) : (
                    <Badge variant="outline">
                      <UtensilsCrossed className="size-3 mr-1" /> Restaurant
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm font-medium">{formatDate(res.res_date)}</TableCell>
                <TableCell className="text-sm">{res.res_time}</TableCell>
                <TableCell className="font-medium text-sm">
                  {res.customer_name}
                  <div className="text-xs text-muted-foreground">{res.customer_phone}</div>
                  {(() => {
                    const links = (res.social_link ?? '')
                      .split('\n')
                      .map(s => s.trim())
                      .filter(Boolean);
                    if (links.length === 0) return null;
                    return (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Social:
                        {links.map((link, i) => (
                          <div key={i}>
                            Guest {i + 1}:{' '}
                            {/^https?:\/\//i.test(link) ? (
                              <a
                                href={link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-cyan-700 underline break-all"
                              >
                                {link}
                              </a>
                            ) : (
                              <span className="break-all">{link}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </TableCell>
                <TableCell className="text-sm">
                  {res.type === 'beach'
                    ? `${res.party_size} guests · ${res.sunbeds} sunbeds`
                    : `${res.party_size} guests`}
                </TableCell>
                <TableCell>
                  {badge
                    ? <Badge className={badge.className}>{badge.label}</Badge>
                    : <Badge variant="outline">{res.status}</Badge>}
                  {res.status === 'awaiting_payment' && res.payment_amount != null && (
                    <div className="text-xs text-muted-foreground mt-1">EGP {Number.isFinite(Number(res.payment_amount)) ? Number(res.payment_amount).toLocaleString('en-US') : res.payment_amount}</div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {busyId === res.id ? (
                    <Loader2 className="size-4 animate-spin inline-block" />
                  ) : res.status === 'pending' ? (
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => openApprove(res)}>
                        <Check className="size-4 mr-1" />Approve
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => changeStatus(res, 'declined')}>
                        <X className="size-4 mr-1" />Decline
                      </Button>
                    </div>
                  ) : res.status === 'awaiting_payment' ? (
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => markPaid(res)}>
                        <BadgeCheck className="size-4 mr-1" />Mark Paid &amp; Release
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => changeStatus(res, 'cancelled')}>
                        <X className="size-4 mr-1" />Cancel
                      </Button>
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
          {reservations.length === 0 && (
            <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No reservations yet.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>

      {/* Approve dialog: collect payment link + amount (pending → awaiting_payment) */}
      <Dialog open={!!approveTarget} onOpenChange={(o) => { if (!o && !submitting) setApproveTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="size-5" /> Approve &amp; request payment
            </DialogTitle>
          </DialogHeader>

          {approveTarget && (
            <p className="text-sm text-muted-foreground -mt-1">
              {approveTarget.customer_name} · {formatDate(approveTarget.res_date)} · {approveTarget.res_time}
            </p>
          )}

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Payment link *</label>
              <Input
                type="url"
                inputMode="url"
                value={linkInput}
                onChange={e => setLinkInput(e.target.value)}
                placeholder="https://pay.link/abc"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Amount (EGP) *</label>
              <Input
                type="number"
                min="1"
                step="any"
                value={amountInput}
                onChange={e => setAmountInput(e.target.value)}
                placeholder="500"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={submitApprove}
              disabled={submitting || !canApprove}
            >
              {submitting ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Check className="size-4 mr-1" />}
              Approve &amp; send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}