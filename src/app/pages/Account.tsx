import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  User as UserIcon,
  Phone,
  Mail,
  LogOut,
  CalendarCheck,
  ShoppingBag,
  Loader2,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../../lib/supabase';
import { normalizePhone, PHONE_PLACEHOLDER, PHONE_FORMAT_HINT } from '../../lib/phone';

const inputClass =
  'w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e]';

// ── Account history types (subset of the *_select_own scoped rows) ──────────
interface ReservationRow {
  id: string;
  type: string | null;
  res_date: string | null;
  res_time: string | null;
  status: string | null;
  checkin_token: string | null;
  party_size: number | null;
  sunbeds: number | null;
}

interface OrderRow {
  order_ref: string | null;
  status: string | null;
  total: number | null;
  mode: string | null;
  created_at: string | null;
}

// Status → badge colours. Falls back to a neutral grey for unknown statuses.
function statusBadgeClass(status: string | null): string {
  switch (status) {
    case 'confirmed':
    case 'arrived':
    case 'delivered':
    case 'served':
    case 'completed':
      return 'bg-green-100 text-green-700';
    case 'pending':
    case 'pending_approval':
    case 'awaiting_payment':
    case 'preparing':
    case 'out_for_delivery':
      return 'bg-amber-100 text-amber-700';
    case 'declined':
    case 'cancelled':
    case 'no_show':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

function prettyStatus(status: string | null): string {
  if (!status) return 'Unknown';
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export function Account() {
  const navigate = useNavigate();
  const { session, user, profile, loading, signOut, refreshProfile } = useAuth();

  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Account history (RLS scopes selects to the signed-in user via *_select_own).
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  // Signed-in mounts fetch history immediately, so start in the loading state
  // to avoid a one-frame flash of the empty state before the effect runs.
  const [historyLoading, setHistoryLoading] = useState(!!session);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Set true immediately before signing out so the unauthenticated-redirect
  // effect below doesn't bounce the user to /signin during the interim render
  // (the session clears before we navigate to /).
  const signingOut = useRef(false);

  // Not signed in → send to the sign-in screen (once auth has resolved).
  useEffect(() => {
    if (!loading && !session && !signingOut.current) {
      navigate('/signin?redirect=/account', { replace: true });
    }
  }, [loading, session, navigate]);

  // Keep the edit form in sync with the loaded profile.
  useEffect(() => {
    setFullName(profile?.full_name ?? '');
    setPhone(profile?.phone ?? '');
    setPhoneError(null);
  }, [profile]);

  // Load the user's reservations + orders on mount (and whenever the session
  // changes). RLS returns only the signed-in user's rows, so a plain select
  // is sufficient — no explicit user_id filter needed.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    Promise.all([
      supabase
        .from('reservations')
        .select('id, type, res_date, res_time, status, checkin_token, party_size, sunbeds')
        .order('created_at', { ascending: false }),
      supabase
        .from('orders')
        .select('order_ref, status, total, mode, created_at')
        .order('created_at', { ascending: false }),
    ])
      .then(([resResult, orderResult]) => {
        if (cancelled) return;
        if (resResult.error || orderResult.error) {
          setHistoryError('Could not load your history. Please try again.');
          return;
        }
        setReservations((resResult.data as ReservationRow[]) ?? []);
        setOrders((orderResult.data as OrderRow[]) ?? []);
      })
      .catch(() => {
        if (!cancelled) setHistoryError('Could not load your history. Please try again.');
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const handleSave = async () => {
    if (!user) return;
    if (!fullName.trim()) {
      toast.error('Please enter your name.');
      return;
    }

    // The stored profile phone is prefilled straight into the dine-in OTP gate,
    // which posts it to /api/otp-send — and that endpoint only accepts E.164
    // (`+` + 8–15 digits). Saving an unnormalized local number here (e.g.
    // `01555550123`) would hand the user a hard 400 at the OTP step with no way
    // forward, so normalize on the way in and refuse anything unparseable.
    const rawPhone = phone.trim();
    let normalizedPhone: string | null = null;
    if (rawPhone) {
      normalizedPhone = normalizePhone(rawPhone);
      if (!normalizedPhone) {
        setPhoneError(PHONE_FORMAT_HINT);
        return;
      }
    }
    setPhoneError(null);

    setSaving(true);
    try {
      const { error } = await supabase.from('profiles').upsert(
        {
          user_id: user.id,
          full_name: fullName.trim(),
          phone: normalizedPhone,
        },
        { onConflict: 'user_id' }
      );
      if (error) throw error;
      // Show the canonical form we actually stored, not what was typed.
      setPhone(normalizedPhone ?? '');
      await refreshProfile();
      setEditing(false);
      toast.success('Profile updated.');
    } catch (err) {
      toast.error(
        (err as { message?: string })?.message || 'Could not save changes. Try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    signingOut.current = true;
    try {
      await signOut();
      toast.success('Signed out.');
      navigate('/', { replace: true });
    } catch {
      signingOut.current = false;
      toast.error('Could not sign out. Try again.');
    }
  };

  if (loading || !session) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#12207e]" />
      </div>
    );
  }

  const displayName = profile?.full_name || user?.email || 'there';

  return (
    <div className="min-h-[70vh] bg-[#f6f2e8] px-4 py-12">
      <div className="max-w-2xl mx-auto space-y-8">
        {/* Greeting */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
              Hello, {displayName}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Manage your profile, reservations, and orders.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={handleSignOut}
            className="shrink-0 rounded-xl"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign out
          </Button>
        </div>

        {/* Profile card */}
        <section className="bg-white rounded-3xl p-6 md:p-8 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-gray-900">Profile</h2>
            {!editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-sm font-medium text-[#12207e] hover:underline flex items-center gap-1"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            )}
          </div>

          {editing ? (
            <div className="space-y-5">
              <div>
                <label
                  htmlFor="account-name"
                  className="block text-sm font-semibold text-gray-700 mb-2"
                >
                  Full name
                </label>
                <input
                  id="account-name"
                  type="text"
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label
                  htmlFor="account-phone"
                  className="block text-sm font-semibold text-gray-700 mb-2"
                >
                  Phone
                </label>
                <input
                  id="account-phone"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  value={phone}
                  placeholder={PHONE_PLACEHOLDER}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    if (phoneError) setPhoneError(null);
                  }}
                  aria-invalid={phoneError ? true : undefined}
                  aria-describedby={phoneError ? 'account-phone-error' : 'account-phone-hint'}
                  className={`${inputClass} ${phoneError ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20' : ''}`}
                />
                {phoneError ? (
                  <p id="account-phone-error" role="alert" className="mt-2 text-sm text-red-600">
                    {phoneError}
                  </p>
                ) : (
                  <p id="account-phone-hint" className="mt-2 text-xs text-gray-400">
                    We save it as {PHONE_PLACEHOLDER.split(' or ')[0]} so it works for SMS verification at your table.
                  </p>
                )}
              </div>
              <div className="flex gap-3">
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-xl"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Check className="w-4 h-4 mr-2" /> Save
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditing(false);
                    setFullName(profile?.full_name ?? '');
                    setPhone(profile?.phone ?? '');
                    setPhoneError(null);
                  }}
                  disabled={saving}
                  className="rounded-xl"
                >
                  <X className="w-4 h-4 mr-2" /> Cancel
                </Button>
              </div>
            </div>
          ) : (
            <dl className="space-y-4">
              <div className="flex items-center gap-3">
                <UserIcon className="w-5 h-5 text-[#12207e] shrink-0" />
                <div>
                  <dt className="text-xs text-gray-400">Name</dt>
                  <dd className="text-sm font-medium text-gray-800">
                    {profile?.full_name || (
                      <span className="text-gray-400">Not set</span>
                    )}
                  </dd>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Mail className="w-5 h-5 text-[#12207e] shrink-0" />
                <div>
                  <dt className="text-xs text-gray-400">Email</dt>
                  <dd className="text-sm font-medium text-gray-800">
                    {user?.email}
                  </dd>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Phone className="w-5 h-5 text-[#12207e] shrink-0" />
                <div>
                  <dt className="text-xs text-gray-400">Phone</dt>
                  <dd className="text-sm font-medium text-gray-800">
                    {profile?.phone || (
                      <span className="text-gray-400">Not set</span>
                    )}
                  </dd>
                </div>
              </div>
            </dl>
          )}
        </section>

        {/* My Reservations */}
        <section className="bg-white rounded-3xl p-6 md:p-8 shadow-sm border border-gray-100">
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <CalendarCheck className="w-5 h-5 text-[#12207e]" />
            My Reservations
          </h2>

          {historyLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-[#12207e]" />
            </div>
          ) : historyError ? (
            <div className="text-center py-8 text-sm text-red-600">{historyError}</div>
          ) : reservations.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-400">
              Your reservations and QR tickets will appear here.
            </div>
          ) : (
            <ul className="space-y-3">
              {reservations.map((r) => {
                const canViewTicket =
                  (r.status === 'confirmed' || r.status === 'arrived') && !!r.checkin_token;
                return (
                  <li
                    key={r.id}
                    className="rounded-2xl border border-gray-100 bg-[#f6f2e8] p-4 flex items-start justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800">
                        {r.type === 'beach' ? '🏖️ Beach' : r.type === 'restaurant' ? '🍽️ Restaurant' : 'Reservation'}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {r.res_date}
                        {r.res_time ? ` · ${r.res_time}` : ''}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {r.type === 'beach'
                          ? `${r.party_size ?? '—'} guests · ${r.sunbeds ?? '—'} sunbeds`
                          : `${r.party_size ?? '—'} guests`}
                      </p>
                      {r.status === 'awaiting_payment' && (
                        <p className="text-xs text-amber-600 mt-1">Payment pending</p>
                      )}
                      {canViewTicket && (
                        <a
                          href={`/r/${r.checkin_token}`}
                          className="inline-block text-xs font-semibold text-[#12207e] hover:underline mt-1"
                        >
                          View QR ticket →
                        </a>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${statusBadgeClass(r.status)}`}
                    >
                      {prettyStatus(r.status)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* My Orders */}
        <section className="bg-white rounded-3xl p-6 md:p-8 shadow-sm border border-gray-100">
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-[#12207e]" />
            My Orders
          </h2>

          {historyLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-[#12207e]" />
            </div>
          ) : historyError ? (
            <div className="text-center py-8 text-sm text-red-600">{historyError}</div>
          ) : orders.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-400">
              Your order history will appear here.
            </div>
          ) : (
            <ul className="space-y-3">
              {orders.map((o, i) => (
                <li
                  key={o.order_ref || i}
                  className="rounded-2xl border border-gray-100 bg-[#f6f2e8] p-4 flex items-start justify-between gap-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800 font-mono">
                      {o.order_ref || '—'}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{formatDateTime(o.created_at)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {o.mode === 'dine_in' ? 'Dine-in' : o.mode === 'delivery' ? 'Delivery' : o.mode || '—'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span
                      className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${statusBadgeClass(o.status)}`}
                    >
                      {prettyStatus(o.status)}
                    </span>
                    <p className="text-sm font-bold text-[#12207e] mt-1">
                      EGP {o.total ?? 0}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

export default Account;
