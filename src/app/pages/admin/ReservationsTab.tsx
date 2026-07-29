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
  confirmReservation,
  markPaidReservation,
  createReservationAdmin,
  getStoredPassword,
  SupabaseReservation,
} from '@/services/adminService';
import { toast } from 'sonner';
import { Loader2, Check, X, RefreshCw, UtensilsCrossed, Umbrella, CreditCard, BadgeCheck, Plus } from 'lucide-react';

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

  // Admin-created (phone) reservation
  const emptyForm = { type: 'restaurant' as 'restaurant' | 'beach', name: '', phone: '', email: '', date: '', time: '', partySize: '2', sunbeds: '0', notes: '', notify: true };
  const [newOpen, setNewOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [nf, setNf] = useState(emptyForm);

  async function submitNewReservation() {
    const pw = getStoredPassword();
    if (!pw) { toast.error('Not authenticated'); return; }
    if (!nf.name.trim() || !nf.date || !nf.time) { toast.error('Name, date and time are required'); return; }
    if (nf.notify && !/@/.test(nf.email)) { toast.error('Add an email to send a confirmation, or turn off "email the guest"'); return; }
    setCreating(true);
    try {
      await createReservationAdmin(pw, { ...nf });
      toast.success('Reservation created' + (nf.notify && nf.email ? ' — guest emailed' : ''));
      setNewOpen(false);
      setNf(emptyForm);
      setLoading(true);
      await fetchReservations();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create reservation');
    } finally { setCreating(false); }
  }

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

  async function submitConfirmNoPayment() {
    if (!approveTarget) return;
    setSubmitting(true);
    try {
      await confirmReservation(approveTarget.id);
      toast.success('Reservation confirmed — QR ticket released');
      setApproveTarget(null);
      await fetchReservations();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to confirm reservation');
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
        <div className="flex gap-2">
          <Button size="sm" className="bg-[#12207e] hover:bg-[#0e1533] text-white" onClick={() => setNewOpen(true)}>
            <Plus className="size-3 mr-1" /> New reservation
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetchReservations(); }}>
            <RefreshCw className="size-3 mr-1" /> Refresh
          </Button>
        </div>
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
              <Check className="size-5" /> Confirm reservation
            </DialogTitle>
          </DialogHeader>

          {approveTarget && (
            <p className="text-sm text-muted-foreground -mt-1">
              {approveTarget.customer_name} · {formatDate(approveTarget.res_date)} · {approveTarget.res_time}
              {' · '}
              {approveTarget.type === 'beach'
                ? `${approveTarget.party_size} guests · ${approveTarget.sunbeds} sunbeds`
                : `${approveTarget.party_size} guests`}
            </p>
          )}

          <p className="text-sm text-muted-foreground">
            Request a payment (e.g. a minimum charge per person) before releasing the
            QR ticket, or confirm directly without payment.
          </p>

          <div className="space-y-4 rounded-lg border p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CreditCard className="size-4" /> Request payment
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Payment link</label>
              <Input
                type="url"
                inputMode="url"
                value={linkInput}
                onChange={e => setLinkInput(e.target.value)}
                placeholder="https://pay.link/abc"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Amount (EGP)</label>
              <Input
                type="number"
                min="1"
                step="any"
                value={amountInput}
                onChange={e => setAmountInput(e.target.value)}
                placeholder="500"
              />
              {approveTarget && parsedAmount > 0 && (approveTarget.party_size ?? 0) > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  ≈ EGP {(parsedAmount / approveTarget.party_size).toLocaleString('en-US', { maximumFractionDigits: 2 })} per guest
                  {' '}({approveTarget.party_size} guests)
                </p>
              )}
            </div>
            <Button
              className="w-full bg-green-600 hover:bg-green-700 text-white"
              onClick={submitApprove}
              disabled={submitting || !canApprove}
            >
              {submitting ? <Loader2 className="size-4 mr-1 animate-spin" /> : <CreditCard className="size-4 mr-1" />}
              Approve &amp; send payment request
            </Button>
          </div>

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button variant="outline" onClick={() => setApproveTarget(null)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={submitConfirmNoPayment}
              disabled={submitting}
            >
              {submitting ? <Loader2 className="size-4 mr-1 animate-spin" /> : <BadgeCheck className="size-4 mr-1" />}
              Confirm without payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New reservation — admin / phone booking (created confirmed) */}
      <Dialog open={newOpen} onOpenChange={(o) => { if (!creating) setNewOpen(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Plus className="size-5" /> New reservation</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setNf({ ...nf, type: 'restaurant' })} className={`p-2 rounded-lg border text-sm flex items-center justify-center gap-1.5 transition-colors ${nf.type === 'restaurant' ? 'border-transparent bg-[#12207e] text-white' : 'border-gray-200 text-gray-600'}`}><UtensilsCrossed className="size-4" /> Restaurant</button>
              <button type="button" onClick={() => setNf({ ...nf, type: 'beach' })} className={`p-2 rounded-lg border text-sm flex items-center justify-center gap-1.5 transition-colors ${nf.type === 'beach' ? 'border-transparent bg-[#12207e] text-white' : 'border-gray-200 text-gray-600'}`}><Umbrella className="size-4" /> Beach</button>
            </div>
            <div><label className="text-xs font-medium text-gray-600">Guest name *</label><Input value={nf.name} onChange={e => setNf({ ...nf, name: e.target.value })} placeholder="Full name" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs font-medium text-gray-600">Phone</label><Input value={nf.phone} onChange={e => setNf({ ...nf, phone: e.target.value })} placeholder="+20…" /></div>
              <div><label className="text-xs font-medium text-gray-600">Email</label><Input type="email" value={nf.email} onChange={e => setNf({ ...nf, email: e.target.value })} placeholder="optional" /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs font-medium text-gray-600">Date *</label><Input type="date" value={nf.date} onChange={e => setNf({ ...nf, date: e.target.value })} /></div>
              <div><label className="text-xs font-medium text-gray-600">Time *</label><Input value={nf.time} onChange={e => setNf({ ...nf, time: e.target.value })} placeholder="e.g. 8:30 PM" /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs font-medium text-gray-600">{nf.type === 'beach' ? 'People' : 'Party size'}</label><Input type="number" min="1" value={nf.partySize} onChange={e => setNf({ ...nf, partySize: e.target.value })} /></div>
              {nf.type === 'beach' && <div><label className="text-xs font-medium text-gray-600">Sunbeds</label><Input type="number" min="0" value={nf.sunbeds} onChange={e => setNf({ ...nf, sunbeds: e.target.value })} /></div>}
            </div>
            <div><label className="text-xs font-medium text-gray-600">Notes</label><Input value={nf.notes} onChange={e => setNf({ ...nf, notes: e.target.value })} placeholder="optional" /></div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={nf.notify} onChange={e => setNf({ ...nf, notify: e.target.checked })} />
              Email the guest a confirmation (needs an email)
            </label>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => setNewOpen(false)} disabled={creating}>Cancel</Button>
            <Button className="bg-[#12207e] hover:bg-[#0e1533] text-white" onClick={submitNewReservation} disabled={creating}>
              {creating ? <><Loader2 className="size-4 mr-2 animate-spin" /> Creating…</> : 'Create reservation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}