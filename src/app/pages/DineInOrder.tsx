import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { Plus, Minus, ShoppingBag, ArrowLeft, Check, Loader2, Search, Phone, ChevronRight, CreditCard, Wallet, Banknote, X, User as UserIcon } from 'lucide-react';
import { Button } from '../components/ui/button';
import { useMenuData } from '../data/useMenuData';
import { placeDineInOrder, DineInOrderResult } from '../../services/orderService';
import { supabase } from '../../lib/supabase';
import { toast } from 'sonner';
import { API_BASE } from '../../lib/apiConfig';
import { useAuth } from '../auth/AuthProvider';
import { normalizePhone, PHONE_FORMAT_HINT } from '../../lib/phone';
import { KiloOrderModal, kiloCartId } from '../components/KiloOrderModal';

// ── Types ──────────────────────────────────────────────────────────────────
interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image: string;
  // Per-kg lines (whole fish / seafood). All optional so flat lines are unchanged;
  // the composite `id` (kiloCartId) stacks identical weight+style combos.
  unit?: 'kg';
  weightKg?: number;
  cookingStyle?: string;
  pricePerKg?: number;
}

type FlowStep = 'table_loading' | 'table_error' | 'otp' | 'menu' | 'success';
type PaymentMethod = 'cash_on_site' | 'card' | 'instapay' | 'apple_pay';

const VAT_RATE = 0.14;
const SERVICE_RATE = 0.12;

// ── Order status timeline ──────────────────────────────────────────────────
const STATUS_STEPS = [
  { key: 'pending_approval', label: 'Order Placed', icon: '📋' },
  { key: 'confirmed', label: 'Confirmed', icon: '✅' },
  { key: 'preparing', label: 'Preparing', icon: '👨‍🍳' },
  { key: 'served', label: 'Served', icon: '🍽️' },
];

// ===========================================================================
// MAIN COMPONENT
// ===========================================================================
export function DineInOrderPage() {
  const [searchParams] = useSearchParams();
  const tableParam = searchParams.get('table') || '';
  const { menuItems, loading } = useMenuData();
  const { session, profile, profileLoaded } = useAuth();

  const [step, setStep] = useState<FlowStep>('table_loading');
  const [tableId, setTableId] = useState(tableParam);
  const [tableLabel, setTableLabel] = useState('');
  const [tableZone, setTableZone] = useState('');

  // Guest info (set during OTP, used for order)
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');

  // Cart
  const [cart, setCart] = useState<CartItem[]>([]);
  // Which per-kg item (if any) is being configured in the weight/style picker.
  const [kiloItem, setKiloItem] = useState<typeof menuItems[0] | null>(null);
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [note, setNote] = useState('');

  // Payment
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash_on_site');
  const [paymobIframeUrl, setPaymobIframeUrl] = useState<string | null>(null);

  // Order
  const [submitting, setSubmitting] = useState(false);
  const [orderResult, setOrderResult] = useState<DineInOrderResult | null>(null);

  // Set when the server rejects a submit with `phone_not_verified` — i.e. the
  // 30-minute TTL on the OTP lapsed while the diner browsed the menu (entirely
  // normal in a restaurant). It records the payment method that the rejected
  // order had ALREADY resolved to, so the retry after re-verification re-places
  // that exact order without re-running the payment intent: a diner whose
  // Paymob charge already went through must never be charged a second time.
  const [retryAfterVerify, setRetryAfterVerify] = useState<PaymentMethod | null>(null);

  // Payment succeeded but placing the order failed terminally. Renders a recovery
  // screen whose actions re-send the PLACEMENT only — never a new payment intent —
  // so a diner whose card already cleared can never be charged twice.
  const [paidUnsent, setPaidUnsent] = useState<PaymentMethod | null>(null);
  // Bounds the phone_not_verified → re-verify loop. A genuine 30-min expiry clears
  // in one re-verify; if it keeps returning, the cause is structural, not an expiry,
  // and re-opening the gate forever would trap the diner.
  const verifyAttempts = useRef(0);
  const MAX_VERIFY_RETRIES = 2;

  // ── Fetch table info from Supabase ──────────────────────────────────────
  useEffect(() => {
    if (!tableParam) {
      setStep('table_error');
      return;
    }
    supabase
      .from('tables')
      .select('id, label, zone, capacity')
      .eq('id', tableParam)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          supabase
            .from('tables')
            .select('id, label, zone, capacity')
            .eq('label', tableParam)
            .single()
            .then(({ data: data2, error: err2 }) => {
              if (err2 || !data2) {
                setStep('table_error');
                return;
              }
              setTableId(data2.id);
              setTableLabel(data2.label);
              setTableZone(data2.zone);
              setStep('otp');
            });
          return;
        }
        setTableId(data.id);
        setTableLabel(data.label);
        setTableZone(data.zone);
        setStep('otp');
      });
  }, [tableParam]);

  // ── Cart helpers ────────────────────────────────────────────────────────
  const categories = useMemo(() => {
    const cats = Array.from(new Set(menuItems.map(i => i.category)));
    return ['All', ...cats];
  }, [menuItems]);

  const filteredItems = useMemo(() => {
    return menuItems.filter(item => {
      const matchesCat = activeCategory === 'All' || item.category === activeCategory;
      const matchesSearch = !searchQuery ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCat && matchesSearch;
    });
  }, [menuItems, activeCategory, searchQuery]);

  const subtotal = cart.reduce((sum, it) => sum + it.price * it.quantity, 0);
  const vatAmount = Math.round(subtotal * VAT_RATE);
  const serviceAmount = Math.round(subtotal * SERVICE_RATE);
  const grandTotal = subtotal + vatAmount + serviceAmount;

  function addToCart(item: typeof menuItems[0]) {
    // Per-kg items (e.g. whole fish) are sold by weight — open the picker so the
    // guest chooses a weight + cooking style before an estimated line is added.
    if (item.unit === 'kg') {
      setKiloItem(item);
      return;
    }
    setCart(prev => {
      const existing = prev.find(c => c.id === item.id);
      if (existing) {
        return prev.map(c => c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c);
      }
      return [...prev, { id: item.id, name: item.name, price: item.price, quantity: 1, image: item.image }];
    });
    toast.success(`${item.name} added`);
  }

  // Adds (or stacks) a per-kg line. The composite id makes identical weight+style
  // combos increment quantity while different combos become separate lines — so
  // updateQty / removeFromCart (keyed by id) work on these lines unchanged.
  function addKiloToCart(
    item: typeof menuItems[0],
    { weightKg, cookingStyle, price }: { weightKg: number; cookingStyle: string; price: number },
  ) {
    const id = kiloCartId(item.id, weightKg, cookingStyle);
    setCart(prev => {
      const existing = prev.find(c => c.id === id);
      if (existing) {
        return prev.map(c => c.id === id ? { ...c, quantity: c.quantity + 1 } : c);
      }
      return [...prev, {
        id,
        name: item.name,
        price,
        quantity: 1,
        image: item.image,
        unit: 'kg' as const,
        weightKg,
        cookingStyle,
        pricePerKg: item.price,
      }];
    });
    toast.success(`${item.name} added`);
  }

  function updateQty(id: string, delta: number) {
    setCart(prev => prev.map(c => {
      if (c.id === id) {
        const newQty = c.quantity + delta;
        if (newQty <= 0) return c;
        return { ...c, quantity: newQty };
      }
      return c;
    }));
  }

  function removeFromCart(id: string) {
    setCart(prev => prev.filter(c => c.id !== id));
  }

  // ── Place the order ─────────────────────────────────────────────────────
  /**
   * Sends the order to /api/order-dinein. Payment, if any, is already settled
   * by the caller — this NEVER creates a payment intent, which is precisely
   * what makes it safe to call a second time after a re-verification.
   *
   * `name`/`phone` are passed in rather than read from state because the retry
   * fires straight out of OtpGate's onVerified, before its setState has landed.
   */
  async function submitOrder(
    orderPaymentMethod: PaymentMethod,
    name: string,
    phone: string,
    alreadyPaid: boolean,
  ) {
    setSubmitting(true);
    const result = await placeDineInOrder({
      tableId,
      items: cart.map(c => ({
        // Per-kg lines carry weight + cooking style through the name so the kitchen
        // receives the full spec (placeDineInOrder signature unchanged).
        name: c.cookingStyle ? `${c.name} (${c.weightKg}kg · ${c.cookingStyle})` : c.name,
        quantity: c.quantity,
        price: c.price,
      })),
      note: note.trim() || undefined,
      guestName: name.trim() || undefined,
      guestPhone: phone.trim() || undefined,
      paymentMethod: orderPaymentMethod,
    });
    setSubmitting(false);

    if (result.ok) {
      verifyAttempts.current = 0;
      setRetryAfterVerify(null);
      setPaidUnsent(null);
      setOrderResult(result);
      setCart([]);
      setStep('success');
      return;
    }

    // Infra: the server couldn't RUN the verification check. A fresh OTP can't fix
    // this, so never loop the gate. If the charge already cleared, land on the
    // paid-but-unsent recovery screen; otherwise surface an actionable error.
    if (result.code === 'verification_unavailable') {
      if (alreadyPaid) { setPaidUnsent(orderPaymentMethod); return; }
      toast.error("We couldn't confirm your phone right now. Please ask a staff member for help.");
      return;
    }

    // Genuine 30-minute TTL expiry — recoverable by re-confirming the number, but
    // BOUNDED. If re-verifying still yields this, the cause is structural and
    // re-opening the gate forever would trap the diner.
    if (result.code === 'phone_not_verified') {
      if (verifyAttempts.current >= MAX_VERIFY_RETRIES) {
        if (alreadyPaid) setPaidUnsent(orderPaymentMethod);
        else toast.error("We couldn't confirm your phone. Please ask a staff member to place your order.");
        return;
      }
      verifyAttempts.current += 1;
      setRetryAfterVerify(orderPaymentMethod);
      setStep('otp');
      toast.error('Your phone confirmation expired. Re-confirm your number — your order is saved.');
      return;
    }

    // Any other failure.
    if (alreadyPaid) {
      // The charge already succeeded. Do NOT return the diner to the menu with a live
      // "Order & Pay" button — one tap would create a SECOND Paymob intent and charge
      // them again. Lock into the recovery screen (re-sends placement only).
      setPaidUnsent(orderPaymentMethod);
      return;
    }
    toast.error(result.error || 'Failed to place order');
  }

  // ── Handle order submission ─────────────────────────────────────────────
  async function handleOrder() {
    if (cart.length === 0 || !tableId) return;
    setSubmitting(true);

    let orderPaymentMethod = paymentMethod;

    // If Paymob payment selected, create payment intent first
    if (paymentMethod !== 'cash_on_site') {
      try {
        const tempOrderRef = `D${Date.now().toString(36).toUpperCase()}`;
        const intentRes = await fetch(`${API_BASE}/api/paymob-intent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: tempOrderRef,
            amount: grandTotal,
            method: paymentMethod,
            billing: {
              first_name: guestName,
              phone_number: guestPhone,
            },
            phone: guestPhone,
          }),
        }).then(r => r.json());

        if (intentRes.ok && intentRes.iframe_url) {
          if (intentRes.dev_mode) {
            toast.info('Dev mode: Payment skipped. Order will be placed as cash on site.');
            orderPaymentMethod = 'cash_on_site';
          } else {
            setPaymobIframeUrl(intentRes.iframe_url);
            setSubmitting(false);
            return;
          }
        } else {
          toast.error(intentRes.error || 'Payment initialization failed');
          setSubmitting(false);
          return;
        }
      } catch {
        toast.error('Payment setup failed. Try cash on site.');
        setSubmitting(false);
        return;
      }
    }

    // Place the order. Any online payment has already settled by this point.
    await submitOrder(orderPaymentMethod, guestName, guestPhone, false);
  }

  // ── Handle Paymob iframe callback ───────────────────────────────────────
  async function handlePaymentComplete(success: boolean) {
    setPaymobIframeUrl(null);
    if (success) {
      toast.success('Payment successful! Placing your order...');
      // The charge has gone through — flagged as alreadyPaid so a failure reads
      // correctly, and so a `phone_not_verified` bounce retries the PLACEMENT
      // only, never the payment.
      await submitOrder(paymentMethod, guestName, guestPhone, true);
    } else {
      setSubmitting(false);
      toast.error('Payment failed. Please try again or choose cash on site.');
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const zoneEmoji = tableZone === 'bar' ? '🍸' : tableZone === 'daybed' ? '🏖️' : '🍽️';
  const zoneLabel = tableZone === 'bar' ? 'Bar' : tableZone === 'daybed' ? 'Daybed' : 'Dining';

  // ── Table loading ───────────────────────────────────────────────────────
  if (step === 'table_loading') {
    return (
      <div className="min-h-screen bg-[#f6f2e8] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#12207e]" />
      </div>
    );
  }

  // ── Table error ─────────────────────────────────────────────────────────
  if (step === 'table_error') {
    return (
      <div className="min-h-screen bg-[#f6f2e8] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
            <span className="text-3xl">⚠️</span>
          </div>
          <h1 className="font-montserrat font-bold text-2xl text-gray-800 mb-2">Table Not Found</h1>
          <p className="text-gray-500 mb-6">No table specified in QR code. Please scan the QR code again or call a waiter.</p>
          <a href="https://mazibeach.com" className="inline-flex items-center gap-2 text-[#12207e] font-semibold">
            <ArrowLeft className="w-4 h-4" /> Back to Home
          </a>
        </div>
      </div>
    );
  }

  // ── OTP gate ────────────────────────────────────────────────────────────
  if (step === 'otp') {
    return (
      <OtpGate
        tableLabel={tableLabel}
        zoneEmoji={zoneEmoji}
        zoneLabel={zoneLabel}
        signedIn={!!session}
        accountUid={session?.user?.id ?? null}
        profileLoaded={profileLoaded}
        accountName={profile?.full_name || ''}
        accountPhone={profile?.phone || ''}
        // On a re-verification, carry over the details the diner actually used —
        // which may be a phone they EDITED away from their profile value. Empty
        // on first entry, where account seeding applies as before.
        initialName={guestName}
        initialPhone={guestPhone}
        expired={retryAfterVerify !== null}
        onVerified={(name, phone) => {
          setGuestName(name);
          setGuestPhone(phone);
          setStep('menu');
          if (retryAfterVerify) {
            const method = retryAfterVerify;
            setRetryAfterVerify(null);
            // Re-place the order that the expired TTL rejected. `method` is the
            // already-resolved payment method, so no intent is re-created and a
            // completed charge is never repeated. Name/phone are passed through
            // explicitly — the setState calls above have not landed yet.
            void submitOrder(method, name, phone, method !== 'cash_on_site');
          }
        }}
      />
    );
  }

  // ── Order success ───────────────────────────────────────────────────────
  if (step === 'success' && orderResult && orderResult.ok) {
    return (
      <OrderStatusTracker
        orderRef={orderResult.orderId || ''}
        tableLabel={orderResult.tableLabel || tableLabel}
        total={orderResult.total || grandTotal}
        trackingToken={orderResult.trackingToken || ''}
        onPlaceAnother={() => {
          setOrderResult(null);
          setStep('menu');
        }}
      />
    );
  }

  // ── Paymob iframe overlay ───────────────────────────────────────────────
  if (paymobIframeUrl) {
    return (
      <div className="fixed inset-0 z-50 bg-white flex flex-col">
        <div className="bg-[#1b2350] px-4 py-3 flex items-center justify-between">
          <h2 className="text-white font-semibold">Payment</h2>
          <button
            onClick={() => handlePaymentComplete(false)}
            className="text-white/60 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <iframe
          src={paymobIframeUrl}
          className="flex-1 w-full border-0"
          title="Paymob Payment"
          onLoad={(e) => {
            try {
              const url = (e.target as HTMLIFrameElement).contentWindow?.location?.href || '';
              if (url.includes('success')) {
                handlePaymentComplete(true);
              } else if (url.includes('error') || url.includes('cancel')) {
                handlePaymentComplete(false);
              }
            } catch {
              // Cross-origin — can't read URL, payment page is still loading
            }
          }}
        />
      </div>
    );
  }

  // Payment cleared but the order didn't persist. Terminal recovery screen — the
  // ONLY actions re-send placement; there is no path back to handleOrder, so no
  // second payment intent can ever be created here.
  if (paidUnsent) {
    return (
      <div className="min-h-screen bg-[#f6f2e8] flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-2xl p-6 shadow-sm border border-gray-100 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-100 flex items-center justify-center">
            <span className="text-3xl">💳</span>
          </div>
          <h1 className="font-montserrat font-bold text-xl text-gray-800 mb-2">Payment received</h1>
          <p className="text-gray-500 text-sm mb-6">
            Your payment went through, but we couldn't send your order to the kitchen yet.
            Please show this screen to a staff member — or try sending it again.
          </p>
          <Button
            onClick={() => { void submitOrder(paidUnsent, guestName, guestPhone, true); }}
            disabled={submitting}
            className="w-full h-12 font-semibold rounded-xl"
          >
            {submitting ? (<><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Sending…</>) : 'Try sending my order again'}
          </Button>
          <p className="text-center text-xs text-gray-400 mt-4">Table {tableLabel} · Paid online</p>
        </div>
      </div>
    );
  }

  // ── Menu + Cart + Checkout ──────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#f6f2e8]">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="bg-[#1b2350] sticky top-0 z-40 shadow-lg">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{zoneEmoji}</span>
            <div>
              <h1 className="font-montserrat font-bold text-lg text-white leading-tight">
                Table {tableLabel}
              </h1>
              <p className="text-white/50 text-xs">{zoneLabel} · Mazi</p>
            </div>
          </div>
          <button
            onClick={() => {
              const el = document.getElementById('dinein-cart');
              el?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="relative bg-[#12207e] text-white rounded-full px-4 py-2 flex items-center gap-2 text-sm font-semibold"
          >
            <ShoppingBag className="w-4 h-4" />
            {cart.reduce((s, c) => s + c.quantity, 0)} items
            {subtotal > 0 && (
              <span className="ml-1 bg-white/20 rounded-full px-2 py-0.5 text-xs">
                EGP {subtotal}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* ── Search + Category filter ──────────────────────────────────────── */}
      <div className="sticky top-[60px] z-30 bg-[#f6f2e8]/95 backdrop-blur-md border-b border-[#12207e]/10">
        <div className="container mx-auto px-4 py-3">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search the menu..."
              className="w-full pl-10 pr-4 py-2.5 rounded-full border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e]"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  activeCategory === cat
                    ? 'bg-[#12207e] text-white'
                    : 'bg-white text-gray-600 border border-gray-200 hover:border-[#12207e]/30'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Menu items grid ──────────────────────────────────────────────── */}
      <div className="container mx-auto px-4 py-6 max-w-3xl">
        {loading ? (
          <div className="text-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-[#12207e] mx-auto" />
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            {filteredItems.map(item => {
              const inCart = cart.find(c => c.id === item.id);
              return (
                <motion.div
                  key={item.id}
                  layout
                  className="bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm flex"
                >
                  {item.image ? (
                    <img src={item.image} alt={item.name} className="w-24 h-24 object-cover bg-gray-100 shrink-0" />
                  ) : (
                    // Tasteful brand-teal placeholder when no photo is available yet.
                    <div className="w-24 h-24 shrink-0 flex items-center justify-center bg-gradient-to-br from-[#12207e] to-[#3c6e8f]">
                      <span className="font-serif text-2xl font-bold text-[#f0e6d2]">
                        {item.name.charAt(0)}
                      </span>
                    </div>
                  )}
                  <div className="flex-1 p-4 flex flex-col justify-between min-w-0">
                    <div>
                      <h3 className="font-bold text-gray-800 text-sm leading-tight mb-1">{item.name}</h3>
                      <p className="text-gray-400 text-xs line-clamp-2 mb-1">{item.description}</p>
                      <p className="text-[#12207e] font-bold text-sm">
                        EGP {item.price}
                        {item.unit === 'kg' && <span className="font-normal text-gray-400"> / kg</span>}
                      </p>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      {item.unit === 'kg' ? (
                        // Per-kg items (whole fish) are sold by weight — opening the
                        // picker collects a weight + cooking style before adding.
                        <Button
                          size="sm"
                          onClick={() => addToCart(item)}
                          className="bg-[#12207e] hover:bg-[#22319a] text-white rounded-lg"
                        >
                          <Plus className="w-3 h-3 mr-1" /> Add
                        </Button>
                      ) : inCart ? (
                        <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-1">
                          <button
                            onClick={() => updateQty(item.id, -1)}
                            disabled={inCart.quantity <= 1}
                            className="w-6 h-6 flex items-center justify-center bg-white rounded shadow-sm disabled:opacity-50 text-gray-600"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="font-semibold text-sm w-4 text-center">{inCart.quantity}</span>
                          <button
                            onClick={() => updateQty(item.id, 1)}
                            className="w-6 h-6 flex items-center justify-center bg-white rounded shadow-sm text-gray-600"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => addToCart(item)}
                          className="bg-[#12207e] hover:bg-[#22319a] text-white rounded-lg"
                        >
                          <Plus className="w-3 h-3 mr-1" /> Add
                        </Button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* ── Cart + checkout section ────────────────────────────────────── */}
        <div id="dinein-cart" className="mt-8 bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h2 className="font-montserrat font-bold text-xl text-gray-800 mb-4 flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-[#12207e]" />
            Your Order
          </h2>

          {cart.length === 0 ? (
            <p className="text-gray-400 text-sm py-4 text-center">Browse the menu above and add items to your order.</p>
          ) : (
            <>
              <div className="space-y-2 mb-4">
                {cart.map(item => (
                  <div key={item.id} className="flex items-center justify-between text-sm">
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold text-gray-800">{item.quantity}x {item.name}</span>
                      {item.cookingStyle && (
                        <p className="text-xs text-gray-500">
                          {item.weightKg} kg · {item.cookingStyle}
                        </p>
                      )}
                    </div>
                    <span className="font-semibold text-gray-600 ml-2 whitespace-nowrap">
                      EGP {item.price * item.quantity}
                      {item.unit === 'kg' && <span className="font-normal text-gray-400"> (est.)</span>}
                    </span>
                    <button
                      onClick={() => removeFromCart(item.id)}
                      className="ml-2 text-gray-300 hover:text-red-500 text-xs"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div className="border-t border-gray-100 pt-3 space-y-1.5 text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal</span><span>EGP {subtotal}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>VAT (14%)</span><span>EGP {vatAmount}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Service (12%)</span><span>EGP {serviceAmount}</span>
                </div>
                <div className="flex justify-between font-bold text-gray-800 pt-1">
                  <span>Total</span><span className="text-[#12207e]">EGP {grandTotal}</span>
                </div>
                {cart.some(c => c.unit === 'kg') && (
                  <p className="text-xs italic text-[#12207e]/70 leading-relaxed pt-1">
                    Whole fish &amp; seafood are sold by weight — per-kilo prices are estimates for
                    your chosen size; the final price is set by the actual weighed catch.
                  </p>
                )}
              </div>

              {/* Guest info display */}
              <div className="mt-4 bg-[#12207e]/5 rounded-lg p-3 flex items-center gap-2 text-sm">
                <Phone className="w-4 h-4 text-[#12207e]" />
                <span className="text-gray-600">{guestName}</span>
                <span className="text-gray-400">·</span>
                <span className="text-gray-600">{guestPhone}</span>
              </div>

              {/* Notes */}
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Notes for the kitchen (allergies, special requests...)"
                rows={2}
                className="w-full mt-3 p-2.5 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e] resize-none"
              />

              {/* ── Payment method selector ─────────────────────────────── */}
              <div className="mt-4">
                <p className="text-sm font-semibold text-gray-700 mb-2">Payment Method</p>
                <div className="grid grid-cols-2 gap-2">
                  <PaymentOption
                    selected={paymentMethod === 'cash_on_site'}
                    onClick={() => setPaymentMethod('cash_on_site')}
                    icon={<Banknote className="w-5 h-5" />}
                    label="Cash on Site"
                  />
                  <PaymentOption
                    selected={paymentMethod === 'card'}
                    onClick={() => setPaymentMethod('card')}
                    icon={<CreditCard className="w-5 h-5" />}
                    label="Card"
                  />
                  <PaymentOption
                    selected={paymentMethod === 'instapay'}
                    onClick={() => setPaymentMethod('instapay')}
                    icon={<Wallet className="w-5 h-5" />}
                    label="InstaPay"
                  />
                  <PaymentOption
                    selected={paymentMethod === 'apple_pay'}
                    onClick={() => setPaymentMethod('apple_pay')}
                    icon={<CreditCard className="w-5 h-5" />}
                    label="Apple Pay"
                  />
                </div>
              </div>

              {/* Submit */}
              <Button
                onClick={handleOrder}
                disabled={submitting || cart.length === 0}
                className="w-full h-14 mt-4 text-lg font-bold rounded-xl shadow-lg shadow-[#12207e]/20 disabled:opacity-50"
              >
                {submitting ? (
                  <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Processing...</>
                ) : (
                  `Order & Pay · EGP ${grandTotal}`
                )}
              </Button>
              <p className="text-center text-xs text-gray-400 mt-2">
                Table {tableLabel} · {paymentMethod === 'cash_on_site' ? 'Pay on site' : 'Pay online'}
              </p>
            </>
          )}
        </div>
      </div>

      {/* Per-kg weight + cooking-style picker (whole fish / seafood) */}
      <KiloOrderModal
        open={kiloItem !== null}
        item={kiloItem}
        onClose={() => setKiloItem(null)}
        onConfirm={(data) => {
          if (kiloItem) addKiloToCart(kiloItem, data);
        }}
      />
    </div>
  );
}

// ===========================================================================
// OTP GATE COMPONENT
// ===========================================================================
function OtpGate({ tableLabel, zoneEmoji, zoneLabel, signedIn, accountUid, profileLoaded, accountName, accountPhone, initialName, initialPhone, expired, onVerified }: {
  tableLabel: string;
  zoneEmoji: string;
  zoneLabel: string;
  signedIn: boolean;
  accountUid: string | null;
  profileLoaded: boolean;
  accountName: string;
  accountPhone: string;
  /** Details the diner already used this session. Empty strings on first entry. */
  initialName: string;
  initialPhone: string;
  /** Re-opened because the server rejected the order with `phone_not_verified`. */
  expired: boolean;
  onVerified: (name: string, phone: string) => void;
}) {
  const [name, setName] = useState(initialName || accountName || '');
  // A stored profile phone can be in local Egyptian format (01XXXXXXXXX);
  // /api/otp-send only accepts E.164, so normalize before it ever reaches the
  // field. Unparseable values are left visible (rather than silently dropped)
  // so the user can correct them — sendCode() validates again before posting.
  // `initialPhone` (the number the diner actually used) outranks the profile.
  const [phone, setPhone] = useState(() => {
    const source = initialPhone || accountPhone;
    return source ? normalizePhone(source) ?? source : '+20';
  });

  // On a re-verification the diner already has a number in hand — possibly one
  // they EDITED away from their profile value. Treat the profile seed as
  // already consumed so the effect below cannot clobber that edit. On first
  // entry `initialPhone` is '' and seeding behaves exactly as it did before.
  const [skipProfileSeed] = useState(() => !!initialPhone);

  // Seed ONCE per signed-in user, and only after the profile fetch has settled.
  // Without the profileLoaded gate + seededFor latch, a late-resolving profile
  // overwrites a phone the user is already typing (and swaps the name input for
  // the read-only badge, discarding what they typed). Mirrors the prefill guard
  // in CartDrawer / Reservation.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!signedIn) {
      seededFor.current = null; // re-seed on next sign-in
      return;
    }
    if (skipProfileSeed) return;
    if (!accountUid || !profileLoaded) return;
    if (seededFor.current === accountUid) return;
    if (accountName) setName(accountName);
    if (accountPhone) setPhone(normalizePhone(accountPhone) ?? accountPhone);
    seededFor.current = accountUid;
  }, [signedIn, accountUid, profileLoaded, accountName, accountPhone, skipProfileSeed]);

  const [disclaimer, setDisclaimer] = useState(false);
  const [otpStep, setOtpStep] = useState<'phone' | 'code'>('phone');
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [devMode, setDevMode] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  async function sendCode() {
    setError('');
    if (!name.trim()) { setError('Please enter your name'); return; }
    if (!disclaimer) { setError('Please accept the terms to continue'); return; }

    // /api/otp-send hard-rejects anything that isn't E.164 with a 400. Normalize
    // here (idempotent — a resend re-normalizes the already-canonical value) and
    // fail with an actionable inline message instead of a server error the user
    // can't act on. Also write the canonical form back to state so the "code
    // sent to …" line, verifyCode() and onVerified() all use the same number.
    const normalized = normalizePhone(phone);
    if (!normalized) { setError(PHONE_FORMAT_HINT); return; }
    if (normalized !== phone) setPhone(normalized);

    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/api/otp-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalized }),
      }).then(r => r.json());

      if (res.ok) {
        setOtpStep('code');
        setResendCooldown(30);
        if (res.dev_mode) {
          setDevMode(true);
          toast.info('Dev mode: Enter any 4-6 digit code');
        }
      } else {
        setError(res.error || 'Failed to send code');
      }
    } catch {
      setError('Network error. Please try again.');
    }
    setSending(false);
  }

  async function verifyCode() {
    setError('');
    if (!code.trim() || !/^\d{4,6}$/.test(code)) {
      setError('Enter a 4-6 digit code');
      return;
    }

    setVerifying(true);
    try {
      const res = await fetch(`${API_BASE}/api/otp-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      }).then(r => r.json());

      if (res.ok && res.verified) {
        toast.success('Phone verified!');
        onVerified(name.trim(), phone.trim());
      } else {
        setError(res.error || 'Invalid code. Try again.');
      }
    } catch {
      setError('Network error. Please try again.');
    }
    setVerifying(false);
  }

  return (
    <div className="min-h-screen bg-[#f6f2e8] flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">{zoneEmoji}</div>
          <h1 className="font-montserrat font-bold text-2xl text-gray-800">Table {tableLabel}</h1>
          <p className="text-gray-500 text-sm">{zoneLabel} · Mazi</p>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          {otpStep === 'phone' ? (
            <>
              {expired && (
                <div
                  role="status"
                  className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800"
                >
                  <p className="text-sm font-semibold mb-0.5">Phone confirmation expired</p>
                  <p className="text-xs leading-relaxed text-amber-700">
                    For your security, we re-confirm your number if more than 30 minutes pass before
                    you order. <span className="font-semibold">Your cart and order details are saved</span> — confirm
                    your number and we'll send the order straight to the kitchen.
                  </p>
                </div>
              )}

              <h2 className="font-montserrat font-bold text-xl text-gray-800 mb-1">
                {expired ? 'Re-confirm your phone' : 'Welcome to Mazi'}
              </h2>
              <p className="text-gray-500 text-sm mb-6">
                {expired
                  ? 'One quick code and your order goes through.'
                  : 'Enter your details to start ordering.'}
              </p>

              {signedIn && accountName ? (
                <div className="mb-4 bg-[#12207e]/5 rounded-lg p-3 flex items-center gap-2 text-sm">
                  <UserIcon className="w-4 h-4 text-[#12207e] shrink-0" />
                  <span className="text-gray-600">Ordering as <span className="font-semibold text-gray-800">{name}</span></span>
                </div>
              ) : (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Your Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="John Doe"
                    className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e]"
                  />
                </div>
              )}

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="+201XXXXXXXXX"
                  className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e]"
                />
                <p className="text-xs text-gray-400 mt-1">We'll send a verification code via SMS</p>
              </div>

              <div className="mb-6">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={disclaimer}
                    onChange={e => setDisclaimer(e.target.checked)}
                    className="mt-1 w-4 h-4 rounded border-gray-300 text-[#12207e] focus:ring-[#12207e]/20"
                  />
                  <span className="text-xs text-gray-600">
                    I agree to Mazi's ordering terms and confirm that the information provided is accurate.
                  </span>
                </label>
              </div>

              {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

              <Button
                onClick={sendCode}
                disabled={sending}
                className="w-full h-12 font-semibold rounded-xl"
              >
                {sending ? (
                  <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Sending code...</>
                ) : (
                  <>Send Verification Code <ChevronRight className="w-4 h-4 ml-1" /></>
                )}
              </Button>
            </>
          ) : (
            <>
              <h2 className="font-montserrat font-bold text-xl text-gray-800 mb-1">Enter Verification Code</h2>
              <p className="text-gray-500 text-sm mb-6">
                We sent a code to <span className="font-semibold">{phone}</span>
              </p>

              {devMode && (
                <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
                  Dev mode active — enter any 4-6 digit code to continue.
                </div>
              )}

              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="••••"
                className="w-full p-4 text-center text-2xl font-bold tracking-[0.5em] rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e]"
                autoFocus
              />

              {error && <p className="text-red-500 text-sm mt-4 text-center">{error}</p>}

              <Button
                onClick={verifyCode}
                disabled={verifying || code.length < 4}
                className="w-full h-12 mt-4 font-semibold rounded-xl"
              >
                {verifying ? (
                  <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Verifying...</>
                ) : (
                  'Verify & Continue'
                )}
              </Button>

              <div className="flex items-center justify-between mt-4 text-sm">
                <button
                  onClick={() => { setOtpStep('phone'); setCode(''); setError(''); }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  Change number
                </button>
                <button
                  onClick={sendCode}
                  disabled={resendCooldown > 0 || sending}
                  className="text-[#12207e] font-semibold disabled:opacity-50"
                >
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                </button>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          By ordering, you agree to our terms of service.
        </p>
      </div>
    </div>
  );
}

// ===========================================================================
// PAYMENT OPTION BUTTON
// ===========================================================================
function PaymentOption({ selected, onClick, icon, label }: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 p-3 rounded-xl border-2 transition-all ${
        selected
          ? 'border-[#12207e] bg-[#12207e]/5'
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <span className={selected ? 'text-[#12207e]' : 'text-gray-400'}>{icon}</span>
      <span className={`text-sm font-medium ${selected ? 'text-[#12207e]' : 'text-gray-600'}`}>{label}</span>
      {selected && <Check className="w-4 h-4 text-[#12207e] ml-auto" />}
    </button>
  );
}

// ===========================================================================
// ORDER STATUS TRACKER (Real-time via polling + Supabase Realtime)
// ===========================================================================
function OrderStatusTracker({ orderRef, tableLabel, total, trackingToken, onPlaceAnother }: {
  orderRef: string;
  tableLabel: string;
  total: number;
  trackingToken: string;
  onPlaceAnother: () => void;
}) {
  const [currentStatus, setCurrentStatus] = useState<string>('pending_approval');
  const [paymobPaid, setPaymobPaid] = useState(false);

  useEffect(() => {
    if (!trackingToken) return;

    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/track?token=${encodeURIComponent(trackingToken)}`);
        if (res.ok) {
          const data = await res.json();
          if (data?.status) setCurrentStatus(data.status);
          if (data?.paymobPaid) setPaymobPaid(true);
        }
      } catch { /* ignore */ }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [trackingToken]);

  const currentStepIndex = STATUS_STEPS.findIndex(s => s.key === currentStatus);

  return (
    <div className="min-h-screen bg-[#f6f2e8] flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-green-100 flex items-center justify-center">
            <Check className="w-10 h-10 text-green-600" />
          </div>
          <h1 className="font-montserrat font-bold text-3xl text-gray-800 mb-2">Order Sent!</h1>
          <p className="text-gray-500 mb-1">Your order has been sent to the kitchen.</p>
          <p className="text-[#12207e] font-semibold">Table {tableLabel}</p>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-6">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-500">Order Ref</span>
            <span className="font-mono font-semibold">{orderRef}</span>
          </div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-500">Total (incl. VAT + service)</span>
            <span className="font-bold text-[#12207e]">EGP {total}</span>
          </div>
          {paymobPaid && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Payment</span>
              <span className="font-semibold text-green-600">Paid online</span>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-6">
          <h3 className="font-montserrat font-bold text-lg text-gray-800 mb-4">Order Status</h3>
          <div className="space-y-1">
            {STATUS_STEPS.map((step, index) => {
              const isDone = index <= currentStepIndex;
              const isCurrent = index === currentStepIndex;
              return (
                <div key={step.key} className="flex items-center gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm transition-all ${
                      isDone ? 'bg-[#12207e] text-white' : 'bg-gray-100 text-gray-400'
                    } ${isCurrent ? 'ring-4 ring-[#12207e]/20' : ''}`}>
                      {isDone ? <Check className="w-4 h-4" /> : step.icon}
                    </div>
                    {index < STATUS_STEPS.length - 1 && (
                      <div className={`w-0.5 h-8 ${index < currentStepIndex ? 'bg-[#12207e]' : 'bg-gray-200'}`} />
                    )}
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${isDone ? 'text-gray-800' : 'text-gray-400'}`}>
                      {step.label}
                    </p>
                    {isCurrent && (
                      <p className="text-xs text-[#12207e] animate-pulse">In progress...</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <Button
          onClick={onPlaceAnother}
          className="w-full h-14 text-lg font-bold rounded-xl"
        >
          Place Another Order
        </Button>
      </div>
    </div>
  );
}