import React from 'react';
import { Umbrella, UtensilsCrossed, Calendar, Clock, Users, Mail, Phone, User, AtSign, ClipboardList } from 'lucide-react';
import { Button } from '../components/ui/button';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { API_BASE } from '../../lib/apiConfig';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../../lib/supabase';

type ReservationType = 'beach' | 'restaurant';

interface FormData {
  type: ReservationType;
  name: string;
  phone: string;
  email: string;
  date: string;
  time: string;
  partySize: string;
  sunbeds: string;
  notes: string;
}

// Reservation rules — common rules always shown, plus the selected type's rules.
const COMMON_RULES: string[] = [
  "This is a reservation request. It is confirmed only after we approve it and, where applicable, payment is completed — we'll then email you a confirmation with your QR check-in code.",
  'Please arrive on time. Late arrivals may have their reservation released (see hold times below).',
  'Your booking is for the number of guests reserved. Significant changes to party size must be arranged in advance and are subject to availability.',
  'Cancellations or changes should be made at least 24 hours in advance.',
  'Mazi reserves the right of admission; guests are asked to follow venue and staff guidance.',
];

const BEACH_RULES: string[] = [
  'A minimum spend or entry fee may apply (per person or per sunbed) and will be confirmed with your booking.',
  'Sunbeds are held for 30 minutes past your reserved time, then released.',
  'Outside food and drinks are not permitted; sunbed and umbrella placement is assigned by management.',
  "No refunds for weather — we'll help you reschedule where possible.",
];

const RESTAURANT_RULES: string[] = [
  'Tables are held for 30 minutes past your reserved time, then released.',
  'Specific seating (indoor/outdoor or particular tables) is subject to availability and not guaranteed.',
];

export function ReservationPage() {
  const { session, user, profile, profileLoaded } = useAuth();
  const [resType, setResType] = React.useState<ReservationType>('beach');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [agreedToRules, setAgreedToRules] = React.useState(false);
  const [socials, setSocials] = React.useState<string[]>(['']);
  const [form, setForm] = React.useState<FormData>({
    type: 'beach',
    name: '',
    phone: '',
    email: '',
    date: '',
    time: '',
    partySize: '2',
    sunbeds: '2',
    notes: '',
  });

  const updateField = (field: keyof FormData, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  // Tracks which signed-in user we've already seeded the form from, so the
  // prefill runs once per session and never clobbers in-progress edits when
  // AuthProvider hands us a fresh `profile` object (e.g. on TOKEN_REFRESHED).
  const seededFor = React.useRef<string | null>(null);

  // Account-aware prefill: when signed in, seed name/email/phone from the
  // account so we don't re-ask. Name + email become read-only (shown as a
  // summary); phone stays editable/prefilled. Logged-out flow is untouched.
  // Seeded ONCE per signed-in user (guarded by seededFor) so a refreshed
  // `profile` identity doesn't reset a form the user is mid-edit on.
  React.useEffect(() => {
    if (!session) {
      // On sign-out (SPA navigate — component stays mounted), clear the fields we
      // seeded from the account so the next visitor on a shared device can't see or
      // submit under the previous account holder's identity. No guest localStorage
      // here, so reset to empty.
      if (seededFor.current !== null) {
        setForm(prev => ({ ...prev, name: '', email: '', phone: '' }));
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
    setForm(prev => ({
      ...prev,
      name: profile?.full_name || prev.name,
      email: user?.email || prev.email,
      phone: profile?.phone || prev.phone,
    }));
    seededFor.current = uid;
  }, [session, user, profile, profileLoaded]);

  const MAX_SOCIALS = 12;
  const updateSocial = (i: number, val: string) => {
    setSocials(prev => prev.map((v, idx) => (idx === i ? val : v)));
  };
  const addSocial = () => {
    setSocials(prev => (prev.length < MAX_SOCIALS ? [...prev, ''] : prev));
  };
  const removeSocial = (i: number) => {
    setSocials(prev => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  };

  const handleTypeChange = (type: ReservationType) => {
    setResType(type);
    updateField('type', type);
    // Rules are adaptive per type — force re-agreement after switching so the
    // guest reads the newly shown rules before submitting.
    setAgreedToRules(false);
  };

  // Generate next 30 days for date picker
  const today = new Date();
  const dateOptions = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const value = d.toISOString().split('T')[0];
    const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return { value, label };
  });

  // Time slots
  const timeSlots = [
    '12:00 PM', '12:30 PM', '1:00 PM', '1:30 PM', '2:00 PM', '2:30 PM',
    '3:00 PM', '3:30 PM', '4:00 PM', '4:30 PM', '5:00 PM', '5:30 PM',
    '6:00 PM', '6:30 PM', '7:00 PM', '7:30 PM', '8:00 PM', '8:30 PM',
    '9:00 PM', '9:30 PM', '10:00 PM',
  ];

  const handleSubmit = async () => {
    // When signed in, the account's name/email win so the reservation matches
    // the account (and links to it via the auth token below).
    const name = (session && profile?.full_name ? profile.full_name : form.name).trim();
    const email = (session && user?.email ? user.email : form.email).trim();
    // Phone: always trust the field the user sees/edits. It's prefilled from
    // the profile via the effect above, so this preserves both the prefill and
    // any edit — account-wins precedence applies only to name/email (read-only).
    const phone = form.phone.trim();

    if (name.length < 2) {
      toast.error('Please enter your name');
      return;
    }
    if (!phone) {
      toast.error('Please enter your phone number');
      return;
    }
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!EMAIL_RE.test(email)) {
      toast.error('Please enter a valid email — we need it to send your confirmation');
      return;
    }
    if (!form.date) {
      toast.error('Please pick a date');
      return;
    }
    if (!form.time) {
      toast.error('Please pick a time');
      return;
    }
    if (!agreedToRules) {
      toast.error('Please read and agree to the reservation rules');
      return;
    }

    setIsSubmitting(true);
    try {
      const social = socials.map(s => s.trim()).filter(Boolean).join('\n');
      // Attach the auth token when signed in so the created reservation links
      // to the account. Guests send only the JSON content-type header. Wrapped
      // so a getSession() failure (e.g. storage unavailable) can never break a
      // guest reservation — mirrors orderService.authedJsonHeaders() swallowing.
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      try {
        const { data: { session: authSession } } = await supabase.auth.getSession();
        if (authSession?.access_token) {
          headers['Authorization'] = 'Bearer ' + authSession.access_token;
        }
      } catch {
        // proceed as a guest — no auth header
      }
      const res = await fetch(`${API_BASE}/api/reservation`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...form, name, email, phone, social, rulesAccepted: agreedToRules }),
      });
      if (!res.ok) throw new Error('Failed to submit');
      await res.json().catch(() => ({}));
      setSubmitted(true);
    } catch {
      toast.error('Something went wrong. Please try again or call us.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="bg-[#f6f2e8] min-h-screen py-16">
        <div className="container mx-auto px-4 max-w-2xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-3xl p-10 shadow-sm border border-gray-100 text-center"
          >
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-amber-100 flex items-center justify-center">
              <Clock className="w-10 h-10 text-amber-600" />
            </div>
            <h1 className="font-montserrat font-bold text-3xl mb-4 text-[#1b2350]">
              Reservation Request Received
            </h1>
            <p className="text-gray-600 mb-2 text-lg">
              Thank you, {form.name.split(' ')[0]}.
            </p>
            <p className="text-gray-500 mb-8">
              This is a <strong>reservation request</strong> — it is not confirmed yet.
              We will review it and send you a confirmation email with a payment link.
              Once we confirm your reservation, your QR check-in ticket will be emailed to you;
              once payment is completed, your reservation is secured.
            </p>
            <div className="bg-[#f6f2e8] rounded-xl p-6 mb-8 text-left">
              <h3 className="font-bold text-gray-800 mb-4">Your Request</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-400">Type</p>
                  <p className="font-semibold text-gray-700">
                    {form.type === 'beach' ? '🏖️ Beach (Umbrella + Sunbeds)' : '🍽️ Restaurant'}
                  </p>
                </div>
                <div>
                  <p className="text-gray-400">Date</p>
                  <p className="font-semibold text-gray-700">
                    {dateOptions.find(d => d.value === form.date)?.label || form.date}
                  </p>
                </div>
                <div>
                  <p className="text-gray-400">Time</p>
                  <p className="font-semibold text-gray-700">{form.time}</p>
                </div>
                <div>
                  <p className="text-gray-400">{form.type === 'beach' ? 'People & Sunbeds' : 'Party Size'}</p>
                  <p className="font-semibold text-gray-700">
                    {form.type === 'beach'
                      ? `${form.partySize} guests · ${form.sunbeds} sunbeds`
                      : `${form.partySize} guests`}
                  </p>
                </div>
              </div>
            </div>
            <Button
              onClick={() => {
                setSubmitted(false);
                setForm({
                  type: 'beach', name: '', phone: '', email: '',
                  date: '', time: '', partySize: '2', sunbeds: '2', notes: '',
                });
                setSocials(['']);
                setResType('beach');
                setAgreedToRules(false);
              }}
              variant="outline"
              className="w-full"
            >
              Make Another Reservation
            </Button>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#f6f2e8] min-h-screen py-16">
      <div className="container mx-auto px-4 max-w-2xl">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="font-montserrat font-bold text-4xl mb-3 text-[#1b2350]">Reservations</h1>
          <p className="text-gray-600 max-w-lg mx-auto">
            Book your spot at Mazi — beach sunbeds or a restaurant table.
          </p>
        </div>

        {/* Pending notice */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-8 flex items-start gap-3">
          <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            <strong>Reservation Request —</strong> Your booking is not confirmed until you receive
            an email confirmation with a payment link from us. After payment, your reservation is secured.
          </p>
        </div>

        {/* Type Toggle */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <button
            onClick={() => handleTypeChange('beach')}
            className={`p-6 rounded-2xl border-2 transition-all text-center ${
              resType === 'beach'
                ? 'border-[#12207e] bg-[#12207e] text-white shadow-lg'
                : 'border-gray-200 bg-white text-gray-600 hover:border-[#12207e]/30'
            }`}
          >
            <Umbrella className="w-8 h-8 mx-auto mb-2" />
            <span className="font-semibold">Beach</span>
            <p className={`text-xs mt-1 ${resType === 'beach' ? 'text-white/70' : 'text-gray-400'}`}>
              Umbrella & Sunbeds
            </p>
          </button>
          <button
            onClick={() => handleTypeChange('restaurant')}
            className={`p-6 rounded-2xl border-2 transition-all text-center ${
              resType === 'restaurant'
                ? 'border-[#12207e] bg-[#12207e] text-white shadow-lg'
                : 'border-gray-200 bg-white text-gray-600 hover:border-[#12207e]/30'
            }`}
          >
            <UtensilsCrossed className="w-8 h-8 mx-auto mb-2" />
            <span className="font-semibold">Restaurant</span>
            <p className={`text-xs mt-1 ${resType === 'restaurant' ? 'text-white/70' : 'text-gray-400'}`}>
              Table for your group
            </p>
          </button>
        </div>

        {/* Form */}
        <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100 space-y-6">
          {session ? (
            /* Signed in — don't re-ask for name/email; use the account's.
               Phone stays editable (prefilled) since it may need confirming.
               If the account has no name (profile never filled in, or the
               profile select failed transiently) we MUST still render an
               editable name field — handleSubmit validates `name.length >= 2`,
               so hiding it would dead-end the user with an error pointing at a
               field that isn't on screen. */
            <>
              <div className="bg-[#12207e]/5 rounded-2xl p-4 border border-[#12207e]/10 flex items-start gap-3">
                <User className="w-4 h-4 text-[#12207e] shrink-0 mt-0.5" />
                <p className="text-sm text-gray-700">
                  Reserving as{' '}
                  {profile?.full_name && (
                    <>
                      <strong>{profile.full_name}</strong>
                      {' · '}
                    </>
                  )}
                  <span className="text-gray-500">{user?.email || form.email}</span>
                </p>
              </div>

              {/* Name — only when the account doesn't have one yet */}
              {!profile?.full_name && (
                <div>
                  <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                    <User className="w-4 h-4 text-[#12207e]" /> Full Name <span className="text-[#12207e]">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => updateField('name', e.target.value)}
                    placeholder="Your name"
                    autoComplete="name"
                    aria-required="true"
                    className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e]"
                  />
                </div>
              )}

              {/* Phone */}
              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                  <Phone className="w-4 h-4 text-[#12207e]" /> Phone Number
                </label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => updateField('phone', e.target.value)}
                  placeholder="+20 1XX XXX XXXX"
                  className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e]"
                />
              </div>
            </>
          ) : (
            <>
              {/* Name */}
              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                  <User className="w-4 h-4 text-[#12207e]" /> Full Name
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="Your name"
                  className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e]"
                />
              </div>

              {/* Phone */}
              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                  <Phone className="w-4 h-4 text-[#12207e]" /> Phone Number
                </label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => updateField('phone', e.target.value)}
                  placeholder="+20 1XX XXX XXXX"
                  className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e]"
                />
              </div>

              {/* Email */}
              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                  <Mail className="w-4 h-4 text-[#12207e]" /> Email <span className="text-[#12207e]">*</span>
                  <span className="font-normal text-gray-400">(for confirmation)</span>
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  placeholder="you@example.com"
                  className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e]"
                />
              </div>
            </>
          )}

          {/* Date */}
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
              <Calendar className="w-4 h-4 text-[#12207e]" /> Date
            </label>
            <select
              value={form.date}
              onChange={(e) => updateField('date', e.target.value)}
              className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e] appearance-none"
              style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath fill=\'%23666\' d=\'M6 8L1 3h10z\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
            >
              <option value="">Select a date</option>
              {dateOptions.map(d => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>

          {/* Time */}
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
              <Clock className="w-4 h-4 text-[#12207e]" /> Arrival Time
            </label>
            <select
              value={form.time}
              onChange={(e) => updateField('time', e.target.value)}
              className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e] appearance-none"
              style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath fill=\'%23666\' d=\'M6 8L1 3h10z\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
            >
              <option value="">Select a time</option>
              {timeSlots.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Beach: Sunbeds / Restaurant: Party Size */}
          <AnimatePresence mode="wait">
            <motion.div
              key={resType}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.2 }}
            >
              {resType === 'beach' ? (
                <div className="space-y-6">
                  <div>
                    <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                      <Users className="w-4 h-4 text-[#12207e]" /> Number of People
                    </label>
                    <div className="flex flex-wrap items-center gap-3">
                      {['1', '2', '3', '4', '5', '6', '7', '8+'].map(n => (
                        <button
                          key={n}
                          onClick={() => updateField('partySize', n)}
                          className={`w-12 h-12 rounded-xl border-2 font-bold transition-all ${
                            form.partySize === n
                              ? 'border-[#12207e] bg-[#12207e] text-white'
                              : 'border-gray-200 bg-white text-gray-600 hover:border-[#12207e]/30'
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                      <Umbrella className="w-4 h-4 text-[#12207e]" /> Number of Sunbeds
                    </label>
                    <div className="flex flex-wrap items-center gap-3">
                      {[1, 2, 3, 4, '5+'].map(n => (
                        <button
                          key={n}
                          onClick={() => updateField('sunbeds', String(n))}
                          className={`w-12 h-12 rounded-xl border-2 font-bold transition-all ${
                            form.sunbeds === String(n)
                              ? 'border-[#12207e] bg-[#12207e] text-white'
                              : 'border-gray-200 bg-white text-gray-600 hover:border-[#12207e]/30'
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                    <Users className="w-4 h-4 text-[#12207e]" /> Party Size
                  </label>
                  <div className="flex flex-wrap items-center gap-3">
                    {['1', '2', '3', '4', '5', '6', '7', '8+'].map(n => (
                      <button
                        key={n}
                        onClick={() => updateField('partySize', n)}
                        className={`w-12 h-12 rounded-xl border-2 font-bold transition-all ${
                          form.partySize === n
                            ? 'border-[#12207e] bg-[#12207e] text-white'
                            : 'border-gray-200 bg-white text-gray-600 hover:border-[#12207e]/30'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Social media — one row per guest */}
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
              <AtSign className="w-4 h-4 text-[#12207e]" /> Social media
            </label>
            <p className="text-xs text-gray-400 mb-3">
              Not including your social media profile link(s) may affect your booking eligibility or approval.
            </p>
            <div className="space-y-3">
              {socials.map((value, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-500">Guest {i + 1}</span>
                    {socials.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeSocial(i)}
                        aria-label={`Remove guest ${i + 1}`}
                        className="text-gray-400 hover:text-[#12207e] text-sm leading-none p-1 -m-1 transition-colors"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => updateSocial(i, e.target.value)}
                    aria-label={`Guest ${i + 1} social media`}
                    placeholder="Instagram, TikTok, etc. — handle or link"
                    className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e]"
                  />
                </div>
              ))}
            </div>
            {socials.length < MAX_SOCIALS && (
              <button
                type="button"
                onClick={addSocial}
                className="mt-3 text-sm font-medium text-[#12207e] border border-[#12207e]/30 rounded-lg px-3 py-1.5 hover:bg-[#12207e]/5 transition-colors"
              >
                + Add guest
              </button>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="text-sm font-semibold text-gray-700 mb-2 block">
              Notes <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => updateField('notes', e.target.value)}
              placeholder="Special requests, allergies, occasion…"
              rows={2}
              className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e] resize-none"
            />
          </div>

          {/* Reservation Rules */}
          <div className="bg-[#f6f2e8] rounded-2xl p-5 border border-gray-100">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
              <ClipboardList className="w-4 h-4 text-[#12207e]" /> Reservation Rules
            </h3>
            <ol className="list-decimal pl-5 space-y-2 text-xs text-gray-600 leading-relaxed">
              {[...COMMON_RULES, ...(resType === 'beach' ? BEACH_RULES : RESTAURANT_RULES)].map((rule, i) => (
                <li key={i}>{rule}</li>
              ))}
            </ol>
            <label className="flex items-start gap-3 mt-4 cursor-pointer">
              <input
                type="checkbox"
                checked={agreedToRules}
                onChange={(e) => setAgreedToRules(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-[#12207e] accent-[#12207e] focus:ring-2 focus:ring-[#12207e]/20"
              />
              <span className="text-sm font-medium text-gray-700">
                I have read and agree to the reservation rules.
              </span>
            </label>
          </div>

          {/* Submit */}
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !agreedToRules}
            className="w-full h-14 text-lg font-bold rounded-xl shadow-lg shadow-[#12207e]/20 disabled:opacity-70"
          >
            {isSubmitting ? 'Sending request...' : 'Send Reservation Request'}
          </Button>

          <p className="text-center text-xs text-gray-400">
            No payment required now — we'll send you a payment link after confirming your request.
          </p>
        </div>
      </div>
    </div>
  );
}