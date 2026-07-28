import React from 'react'
import { useCart } from '../context/CartContext';
import { Button } from './ui/button';
import { Minus, Plus, Trash2, ShoppingBag, MapPin } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { getAvailability, slotLabel, placeOrderOnSite, Availability, SlotInfo } from '../../services/orderService';
import { MapPickerModal, loadAddressBook, saveAddressBook, SavedAddress } from './MapPickerModal';
import { useAuth } from '../auth/AuthProvider';

const MIN_DELIVERY = 2000;
const VAT_RATE = 0.14;
const SERVICE_RATE = 0.12;

const PAYMENT_OPTIONS = [
  { value: 'cod', icon: '💵', label: 'Cash on Delivery', desc: 'Pay with cash when your order arrives' },
  { value: 'card_on_delivery', icon: '💳', label: 'Card on Delivery', desc: 'Our driver brings a card machine' },
  { value: 'instapay', icon: '🏦', label: 'InstaPay', desc: 'Bank transfer — we email you the details' },
] as const;

// Local fallback when the availability service is unreachable: same slot
// generation the site used before capacity control (fail open).
function fallbackSlots(): SlotInfo[] {
  const now = new Date();
  const minTime = new Date(now.getTime() + 30 * 60000);
  const slots: SlotInfo[] = [];
  for (let h = 14; h <= 20; h++) {
    for (let m = 0; m < 60; m += 30) {
      if (h === 20 && m > 0) continue;
      const slot = new Date();
      slot.setHours(h, m, 0, 0);
      if (slot > minTime) {
        slots.push({ time: `${h}:${m === 0 ? '00' : '30'}`, status: 'open' });
      }
    }
  }
  return slots;
}

export function CartDrawer() {
  const { items, removeItem, updateQuantity, clearCart, totalPrice, isCartOpen, toggleCart } = useCart();
  const { session, user, profile, profileLoaded } = useAuth();
  const [paymentMethod, setPaymentMethod] = React.useState('cod');
  const [orderNotes, setOrderNotes] = React.useState('')
  const [address, setAddress] = React.useState(() => localStorage.getItem('bc_address') || '');
  const [location, setLocation] = React.useState(() => localStorage.getItem('bc_location') || '');
  const [customerName, setCustomerName] = React.useState(() => localStorage.getItem('bc_name') || '');
  const [customerPhone, setCustomerPhone] = React.useState(() => localStorage.getItem('bc_phone') || '');
  const [customerEmail, setCustomerEmail] = React.useState(() => localStorage.getItem('bc_email') || '');
  const [prefilled, setPrefilled] = React.useState(false);
  // Tracks which signed-in user we've already seeded the form from, so the
  // prefill runs once per session and never clobbers in-progress edits when
  // AuthProvider hands us a fresh `profile` object (e.g. on TOKEN_REFRESHED).
  const seededFor = React.useRef<string | null>(null);

  const [availability, setAvailability] = React.useState<Availability | null>(null);
  const [availLoading, setAvailLoading] = React.useState(false);
  // 'asap' or a 'HH:mm' slot time
  const [selectedSlot, setSelectedSlot] = React.useState<string>('asap');

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [orderResult, setOrderResult] = React.useState<import('../../services/orderService').OnSiteOrderResult | null>(null);
  const [checkoutError, setCheckoutError] = React.useState<string | null>(null);
  const [mapPickerOpen, setMapPickerOpen] = React.useState(false);
  const [savedAddresses, setSavedAddresses] = React.useState<SavedAddress[]>([]);

  const applyAvailability = React.useCallback((a: Availability | null) => {
    setAvailability(a);
    if (!a) { setSelectedSlot('asap'); return; }
    if (a.paused) return;
    setSelectedSlot(prev => {
      if (prev === 'asap') return a.asap ? 'asap' : (a.slots[0]?.time ?? 'asap');
      return a.slots.some(s => s.time === prev) ? prev : (a.asap ?? a.slots[0]?.time ?? 'asap');
    });
  }, []);

  React.useEffect(() => {
    if (!isCartOpen) return;
    setOrderResult(null);
    setCheckoutError(null);
    setPrefilled(!!(localStorage.getItem('bc_name') && localStorage.getItem('bc_phone')));
    setSavedAddresses(loadAddressBook());
    let cancelled = false;
    setAvailLoading(true);
    getAvailability()
      .then(a => { if (!cancelled) applyAvailability(a); })
      .finally(() => { if (!cancelled) setAvailLoading(false); });
    return () => { cancelled = true; };
  }, [isCartOpen, applyAvailability]);

  // Account-aware prefill: when signed in, the account's details take precedence
  // over stale localStorage. Empty profile fields fall back to whatever's already
  // in state (which was seeded from localStorage), so we never blank a saved value.
  // Seeded ONCE per signed-in user (guarded by seededFor) so a refreshed `profile`
  // identity from AuthProvider doesn't reset a form the user is mid-edit on.
  React.useEffect(() => {
    if (!session) {
      // On sign-out (an SPA navigate — this component never unmounts), restore the
      // guest form to the GUEST's own saved details. Without this the fields keep
      // the account we seeded from, and since checkout only writes localStorage when
      // `!session`, the next signed-out visitor on a shared device would both see AND
      // persist the previous account holder's PII.
      if (seededFor.current !== null) {
        setCustomerName(localStorage.getItem('bc_name') || '');
        setCustomerPhone(localStorage.getItem('bc_phone') || '');
        setCustomerEmail(localStorage.getItem('bc_email') || '');
        setAddress(localStorage.getItem('bc_address') || '');
        setLocation(localStorage.getItem('bc_location') || '');
      }
      seededFor.current = null; // re-seed on next sign-in
      return;
    }
    const uid = session.user?.id;
    // AuthProvider sets `session` synchronously but resolves `profile` a tick
    // later, so seeding (and latching) before the fetch settles would miss
    // name/phone forever. Wait for profileLoaded — it flips true once the
    // initial fetch resolves, whether or not a profile row exists.
    if (!uid || !profileLoaded) return;
    if (seededFor.current === uid) return; // already seeded this user
    if (profile?.full_name) setCustomerName(profile.full_name);
    if (user?.email) setCustomerEmail(user.email);
    if (profile?.phone) setCustomerPhone(profile.phone);
    seededFor.current = uid;
  }, [session, user, profile, profileLoaded]);

  const slots = availability && !availability.paused ? availability.slots : null;
  const selectedSlotInfo = slots?.find(s => s.time === selectedSlot) ?? null;
  const noSlotsLeft = !!availability && !availability.paused && availability.slots.length === 0;
  const orderingPaused = !!availability?.paused;

  // ── Totals breakdown (matches api/order.js) ──────────────────────────────
  const subtotal = totalPrice;
  const vatAmount = Math.round(subtotal * VAT_RATE);
  const serviceAmount = Math.round(subtotal * SERVICE_RATE);
  const grandTotal = subtotal + vatAmount + serviceAmount;
  const belowMin = subtotal < MIN_DELIVERY;
  const checkoutBlocked = orderingPaused || noSlotsLeft || belowMin;

  const handleCheckout = async () => {
    if (isSubmitting || checkoutBlocked) return;
    setIsSubmitting(true);
    setCheckoutError(null);
    try {
      // When signed in, the account's name/email win over any local state so the
      // submitted order matches the account (and links to it via the auth token).
      const name = (session && profile?.full_name ? profile.full_name : customerName).trim();
      const email = (session && user?.email ? user.email : customerEmail).trim();
      // Phone: always trust the field the user sees/edits. It's prefilled from
      // the profile via the effect above, so this preserves both the prefill and
      // any edit — account-wins precedence applies only to name/email (read-only).
      const phone = customerPhone.trim();
      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (name.length < 2 || !phone) {
        alert('Please enter your name and phone number.');
        return;
      }
      if (!EMAIL_RE.test(email)) {
        alert('Please enter a valid email — we use it to send your order and delivery updates.');
        return;
      }
      if (!address.trim() || address.trim().length < 5) {
        alert('Please enter a full delivery address (building, street, area).');
        return;
      }
      // Only persist identity fields a GUEST actually typed. When signed in,
      // name/email (and the profile-prefilled phone) are account-derived — and
      // the guest form reads these keys back on load, so writing them here would
      // hand the next signed-out visitor on a shared device the previous account
      // holder's name, email and phone. The account itself is the store of
      // record for a signed-in user; localStorage is the guest's.
      if (!session) {
        localStorage.setItem('bc_name', name);
        localStorage.setItem('bc_phone', phone);
        localStorage.setItem('bc_email', email);
        localStorage.setItem('bc_address', address.trim());
        localStorage.setItem('bc_location', location.trim());
      }

      // Resolve the chosen slot (ASAP → earliest open) and its expected state.
      const slotTime = selectedSlot === 'asap' ? availability?.asap : selectedSlot;
      if (!slotTime) {
        alert('Please pick a delivery time.');
        return;
      }
      const expectedStatus: 'open' | 'busy' =
        selectedSlot === 'asap' ? 'open' : (selectedSlotInfo?.status ?? 'open');

      const result = await placeOrderOnSite({
        items: items.map((it) => ({
          // Per-kg lines carry their weight + cooking style through the name so the
          // kitchen receives the full spec (API/orderService signatures unchanged).
          name: it.cookingStyle ? `${it.name} (${it.weightKg}kg · ${it.cookingStyle})` : it.name,
          quantity: it.quantity,
          price: it.price,
        })),
        name,
        phone,
        email,
        address: address.trim(),
        location: location.trim(),
        note: orderNotes,
        deliverySlot: slotTime,
        expectedStatus,
        paymentMethod: paymentMethod as 'cod' | 'card_on_delivery' | 'instapay',
      });

      if (result.ok) {
        setOrderResult(result);
        clearCart();
      } else if (result.code === 'slot_full' || result.code === 'slot_unavailable') {
        await getAvailability().then(applyAvailability);
        toast.error('That delivery time just filled up — please pick another.');
      } else if (result.code === 'busy_retry') {
        toast.error("We're receiving a lot of orders right now — please try again in a few seconds.");
      } else if (result.code === 'daily_limit') {
        toast.error("We've reached today's order limit — please WhatsApp us directly.");
        setCheckoutError("We've reached today's order limit.");
      } else {
        toast.error(result.error || "Couldn't place your order. Please try again.");
        setCheckoutError(result.error || "We couldn't place your order.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isCartOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            onClick={toggleCart}
            className="fixed inset-0 bg-black z-50 backdrop-blur-sm"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 h-full w-full sm:max-w-md bg-white z-50 shadow-2xl flex flex-col"
          >
            <div className="p-6 border-b flex items-center justify-between bg-[#f6f2e8]">
              <h2 className="font-montserrat font-bold text-xl flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-[#12207e]" />
                Your Order
              </h2>
              <button onClick={toggleCart} className="p-2 hover:bg-black/5 rounded-full">
                <span className="sr-only">Close</span>
                ✕
              </button>
            </div>

            {orderResult && orderResult.ok ? (
              <div className="flex-1 overflow-y-auto p-6">
                <div className="text-center py-6">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center text-green-600 text-3xl">✓</div>
                  <h3 className="font-montserrat font-bold text-xl text-gray-800 mb-1">
                    {orderResult.status === 'pending_approval' ? 'Order received!' : 'Order confirmed!'}
                  </h3>
                  <p className="text-gray-500 text-sm">
                    {orderResult.status === 'pending_approval'
                      ? "That time is busy — we'll confirm your delivery time shortly."
                      : `Scheduled for ${slotLabel(orderResult.deliverySlot)} today.`}
                  </p>
                </div>
                <div className="bg-[#f6f2e8] rounded-xl p-4 mb-4 text-sm text-gray-700">
                  {orderResult.paymentMethod === 'cod' && <p>💵 <strong>Pay cash on delivery.</strong></p>}
                  {orderResult.paymentMethod === 'card_on_delivery' && <p>💳 <strong>Pay by card on delivery</strong> — our driver brings a card machine.</p>}
                  {orderResult.paymentMethod === 'instapay' && (
                    <div>
                      <p className="mb-1">🏦 <strong>Instapay / bank transfer:</strong></p>
                      <p>We've emailed you our bank transfer details. Complete the transfer and we'll confirm your order.</p>
                    </div>
                  )}
                </div>
                <a
                  href={`/track?token=${orderResult.trackingToken}`}
                  className="block text-center bg-[#12207e] text-white font-bold rounded-xl py-3 mb-3"
                >
                  Track your order
                </a>
                <button onClick={() => { setOrderResult(null); toggleCart(); }} className="block w-full text-center text-gray-500 text-sm py-2">
                  Done
                </button>
              </div>
            ) : (
              <>
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {items.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                  <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center text-gray-400">
                    <ShoppingBag className="w-10 h-10" />
                  </div>
                  <p className="text-gray-500 font-medium">Your cart is empty</p>
                  <Button onClick={toggleCart} variant="outline">Browse Menu</Button>
                </div>
              ) : (
                items.map(item => (
                  <motion.div
                    layout
                    key={item.id}
                    className="flex gap-4 bg-white p-4 rounded-xl border border-gray-100 shadow-sm"
                  >
                    {item.image ? (
                      <img src={item.image} alt={item.name} className="w-20 h-20 object-cover rounded-lg bg-gray-100" />
                    ) : (
                      // Tasteful brand-teal placeholder when no photo is available yet.
                      <div className="w-20 h-20 shrink-0 rounded-lg flex items-center justify-center bg-gradient-to-br from-[#12207e] to-[#3c6e8f]">
                        <span className="font-serif text-2xl font-bold text-[#f0e6d2]">
                          {item.name.charAt(0)}
                        </span>
                      </div>
                    )}
                    <div className="flex-1 flex flex-col justify-between">
                      <div>
                        <h3 className="font-bold text-gray-800 text-sm">{item.name}</h3>
                        {item.cookingStyle && (
                          <p className="text-xs text-gray-500 mt-0.5">
                            {item.weightKg} kg · {item.cookingStyle}
                          </p>
                        )}
                        <p className="text-[#12207e] font-bold text-sm">
                          EGP {item.price}
                          {item.unit === 'kg' && (
                            <span className="font-normal text-gray-400"> (est.)</span>
                          )}
                        </p>
                      </div>

                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-3 bg-gray-50 rounded-lg p-1">
                          <button
                            onClick={() => updateQuantity(item.id, -1)}
                            disabled={item.quantity <= 1}
                            className="w-6 h-6 flex items-center justify-center bg-white rounded shadow-sm disabled:opacity-50 text-gray-600 hover:text-[#12207e]"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="font-semibold text-sm w-4 text-center">{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(item.id, 1)}
                            className="w-6 h-6 flex items-center justify-center bg-white rounded shadow-sm text-gray-600 hover:text-[#12207e]"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        <button
                          onClick={() => removeItem(item.id)}
                          className="text-gray-400 hover:text-red-500 transition-colors p-2"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>

            {items.length > 0 && (
              <div className="p-6 border-t bg-[#f6f2e8] overflow-y-auto max-h-[60vh]">
                {/* Friendly note for returning guests — never hides any field.
                    Signed-in users get the account summary below instead. */}
                {!session && prefilled && (
                  <div className="mb-3 p-3 bg-white rounded-lg border border-gray-100">
                    <p className="text-xs text-gray-600">
                      👋 Welcome back — we've filled in your saved details. Edit anything that changed.
                    </p>
                  </div>
                )}

                {session ? (
                  /* Signed in — don't re-ask for name/email; use the account's.
                     Phone stays editable (may need confirming per delivery).
                     If the account has no name (profile not filled in, or the
                     profile select failed transiently) we MUST still render an
                     editable name field — submit validates `name.length >= 2`,
                     so hiding it would dead-end the user with an error about a
                     field that isn't on screen. */
                  <div className="mb-6">
                    <div className="mb-3 p-3 bg-white rounded-lg border border-gray-100">
                      <p className="text-sm text-gray-700">
                        Ordering as{' '}
                        {profile?.full_name && (
                          <>
                            <strong>{profile.full_name}</strong>
                            {' · '}
                          </>
                        )}
                        <span className="text-gray-500">{user?.email || customerEmail}</span>
                      </p>
                    </div>

                    {!profile?.full_name && (
                      <div className="mb-4">
                        <h3 className="font-bold text-gray-800 mb-3 text-sm">Your Name <span className="text-[#12207e]">*</span></h3>
                        <input
                          type="text"
                          value={customerName}
                          onChange={(e) => setCustomerName(e.target.value)}
                          placeholder="Your Name"
                          autoComplete="name"
                          required
                          aria-required="true"
                          className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e]"
                        />
                      </div>
                    )}

                    <h3 className="font-bold text-gray-800 mb-3 text-sm">Phone Number</h3>
                    <input
                      type="tel"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="Phone Number (e.g. +20 122 128 8804)"
                      autoComplete="tel"
                      className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e]"
                    />
                  </div>
                ) : (
                  <>
                    {/* Customer Info — always show all fields, pre-filled from state */}
                    <div className="mb-6">
                      <h3 className="font-bold text-gray-800 mb-3 text-sm">Your Details</h3>
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={customerName}
                          onChange={(e) => setCustomerName(e.target.value)}
                          placeholder="Your Name"
                          className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e]"
                        />
                        <input
                          type="tel"
                          value={customerPhone}
                          onChange={(e) => setCustomerPhone(e.target.value)}
                          placeholder="Phone Number (e.g. +20 122 128 8804)"
                          className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e]"
                        />
                      </div>
                    </div>

                    <div className="mb-6">
                      <h3 className="font-bold text-gray-800 mb-3 text-sm">Email <span className="text-[#12207e]">*</span> <span className="font-normal text-gray-500">(for order & delivery updates)</span></h3>
                      <input
                        type="email"
                        value={customerEmail}
                        onChange={(e) => setCustomerEmail(e.target.value)}
                        placeholder="you@example.com"
                        required
                        aria-required="true"
                        className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e]"
                      />
                    </div>
                  </>
                )}

                <div className="mb-6">
                  <h3 className="font-bold text-gray-800 mb-3 text-sm">Delivery Address <span className="text-[#12207e]">*</span></h3>

                  {/* Saved addresses quick-pick */}
                  {savedAddresses.length > 0 && (
                    <div className="mb-2">
                      <label className="text-xs text-gray-500 mb-1 block">Saved addresses</label>
                      <select
                        onChange={(e) => {
                          const addr = savedAddresses.find(a => a.id === e.target.value);
                          if (addr) {
                            setAddress(addr.address);
                            setLocation(addr.mapsLink || addr.location);
                          }
                        }}
                        defaultValue=""
                        className="w-full p-2.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e] appearance-none mb-2"
                      >
                        <option value="" disabled>Select a saved address…</option>
                        {savedAddresses.map(a => (
                          <option key={a.id} value={a.id}>{a.name} — {a.address.slice(0, 40)}{a.address.length > 40 ? '…' : ''}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <textarea
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Building, street, area in Ras El Hekma…"
                    rows={2}
                    required
                    aria-required="true"
                    className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e] resize-none"
                  />
                </div>

                <div className="mb-6">
                  <h3 className="font-bold text-gray-800 mb-3 text-sm">📍 Location on Map <span className="font-normal text-gray-500">(recommended)</span></h3>

                  {/* Location display + pick button */}
                  <div className="space-y-2">
                    {location && (
                      <div className="flex items-start gap-2 bg-[#f6f2e8] rounded-lg p-2.5">
                        <MapPin className="w-4 h-4 text-[#12207e] shrink-0 mt-0.5" />
                        <a
                          href={location.startsWith('http') ? location : `https://www.google.com/maps?q=${location}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-[#12207e] underline break-all flex-1"
                        >
                          {location.length > 60 ? location.slice(0, 60) + '…' : location}
                        </a>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setMapPickerOpen(true)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-[#12207e]/30 rounded-xl text-sm font-semibold text-[#12207e] hover:bg-[#12207e]/5 transition-colors"
                    >
                      <MapPin className="w-4 h-4" />
                      {location ? 'Change location on map' : 'Pick location on map'}
                    </button>
                    <input
                      type="text"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="Or paste a Google Maps link manually"
                      className="w-full p-2.5 rounded-lg border border-gray-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e]"
                    />
                  </div>
                </div>

                {/* Map picker modal */}
                <MapPickerModal
                  open={mapPickerOpen}
                  onClose={() => setMapPickerOpen(false)}
                  initialLocation={location}
                  initialAddress={address}
                  onConfirm={(data) => {
                    setLocation(data.location);
                    if (data.address && (!address || address.length < 10)) {
                      setAddress(data.address);
                    }
                    setSavedAddresses(loadAddressBook());
                  }}
                />

                <div className="mb-6">
                  <h3 className="font-bold text-gray-800 mb-3 text-sm">Payment Method</h3>
                  <div className="space-y-2">
                    {PAYMENT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setPaymentMethod(opt.value)}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${
                          paymentMethod === opt.value
                            ? 'border-[#12207e] bg-[#12207e]/5'
                            : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                      >
                        <span className="text-2xl">{opt.icon}</span>
                        <div className="flex-1">
                          <p className="font-semibold text-sm text-gray-800">{opt.label}</p>
                          <p className="text-xs text-gray-500">{opt.desc}</p>
                        </div>
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          paymentMethod === opt.value ? 'border-[#12207e] bg-[#12207e]' : 'border-gray-300'
                        }`}>
                          {paymentMethod === opt.value && <div className="w-2 h-2 bg-white rounded-full" />}
                        </div>
                      </button>
                    ))}
                  </div>
                  {paymentMethod === 'instapay' && (
                    <p className="text-xs text-[#12207e] mt-2 ml-1">
                      We'll email you our bank transfer details after you place your order.
                    </p>
                  )}
                </div>

                <div className="mb-6">
                  <h3 className="font-bold text-gray-800 mb-3 text-sm">
                    Delivery Time (2:00 PM - 8:00 PM)
                    {availLoading && <span className="font-normal text-gray-400"> — checking availability…</span>}
                  </h3>
                  {orderingPaused ? (
                    <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                      Ordering is paused right now — please check back soon or{' '}
                      <a href="https://wa.me/201221288804" className="underline font-medium">WhatsApp us</a>.
                    </p>
                  ) : noSlotsLeft ? (
                    <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                      Ordering for today has closed —{' '}
                      <a href="https://wa.me/201221288804" className="underline font-medium">WhatsApp us</a>{' '}
                      to arrange for tomorrow.
                    </p>
                  ) : (
                    <>
                      <select
                        value={selectedSlot}
                        onChange={(e) => setSelectedSlot(e.target.value)}
                        className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e] appearance-none"
                        style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath fill=\'%23666\' d=\'M6 8L1 3h10z\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
                      >
                        {(availability ? availability.asap !== null : true) && (
                          <option value="asap">
                            {availability?.asap ? `As soon as possible — ${slotLabel(availability.asap)}` : 'As soon as possible'}
                          </option>
                        )}
                        {(slots ?? fallbackSlots()).map((s) => (
                          <option key={s.time} value={s.time}>
                            {slotLabel(s.time)}{s.status === 'busy' ? ' — Busy (needs confirmation)' : ''}
                          </option>
                        ))}
                      </select>
                      {selectedSlot === 'asap' && availability?.asap && (
                        <p className="text-xs text-gray-500 mt-2">
                          Your order will be scheduled for <span className="font-semibold">{slotLabel(availability.asap)}</span> — the earliest available time.
                        </p>
                      )}
                      {selectedSlotInfo?.status === 'busy' && (
                        <p className="text-xs text-amber-600 mt-2">
                          This time is busy — we'll review your order and confirm the time shortly after you place it.
                        </p>
                      )}
                    </>
                  )}
                </div>
                <div className="mb-6">
                  <h3 className="font-bold text-gray-800 mb-3 text-sm">Notes <span className="font-normal text-gray-500">(optional — allergies, gate code, etc.)</span></h3>
                  <textarea
                    value={orderNotes}
                    onChange={(e) => setOrderNotes(e.target.value)}
                    placeholder="Allergies, gate code, special requests…"
                    rows={2}
                    className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e] resize-none"
                  />
                </div>
                {/* ── Totals breakdown ─────────────────────────────────────── */}
                <div className="mb-6 bg-white rounded-xl p-4 border border-gray-100 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Subtotal</span>
                    <span className="font-semibold text-gray-800">EGP {subtotal}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">VAT (14%)</span>
                    <span className="font-semibold text-gray-800">EGP {vatAmount}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Service (12%)</span>
                    <span className="font-semibold text-gray-800">EGP {serviceAmount}</span>
                  </div>
                  <div className="border-t border-gray-200 pt-2 flex justify-between items-center">
                    <span className="font-bold text-gray-800">Total</span>
                    <span className="font-montserrat font-bold text-2xl text-[#12207e]">EGP {grandTotal}</span>
                  </div>
                  {items.some((it) => it.unit === 'kg') && (
                    <p className="text-xs italic text-[#12207e]/70 leading-relaxed pt-1">
                      Whole fish &amp; seafood are sold by weight — per-kilo prices are estimates for
                      your chosen size; the final price is set by the actual weighed catch.
                    </p>
                  )}
                </div>
                {belowMin && (
                  <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
                    <p className="font-semibold mb-1">
                      Add EGP {MIN_DELIVERY - subtotal} more to checkout
                    </p>
                    <p className="text-amber-600">
                      Minimum delivery order is EGP {MIN_DELIVERY}.
                    </p>
                    <div className="mt-2 h-2 bg-amber-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#12207e] rounded-full transition-all"
                        style={{ width: `${Math.min(100, (subtotal / MIN_DELIVERY) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
                {checkoutError && (
                  <div className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                    {checkoutError}{' '}
                    <a href="https://wa.me/201221288804" target="_blank" rel="noopener noreferrer" className="underline font-semibold">
                      Order via WhatsApp instead
                    </a>
                  </div>
                )}
                <Button
                  onClick={handleCheckout}
                  disabled={isSubmitting || checkoutBlocked}
                  className="w-full h-14 text-lg font-bold rounded-xl shadow-lg shadow-[#12207e]/20 disabled:opacity-70"
                >
                  {isSubmitting ? 'Placing order...' : belowMin ? `EGP ${MIN_DELIVERY - subtotal} to go` : 'Place Order'}
                </Button>
                <p className="text-center text-xs text-gray-500 mt-4">
                  Beachside delivery across Ras El Hekma
                </p>
              </div>
            )}
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
