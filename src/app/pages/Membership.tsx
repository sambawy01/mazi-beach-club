import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { API_BASE } from '../../lib/apiConfig';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { SignInGate } from '../components/SignInGate';
import { toast } from 'sonner';
import { Loader2, Check, IdCard } from 'lucide-react';

type MType = 'individual' | 'couple' | 'family';
const TYPES: { key: MType; label: string; blurb: string }[] = [
  { key: 'individual', label: 'Individual', blurb: 'A place by the sea, just for you' },
  { key: 'couple', label: 'Couple', blurb: 'For you and your plus-one' },
  { key: 'family', label: 'Family', blurb: 'Sun, sand and seats for everyone' },
];

export function MembershipPage() {
  const { session } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [membershipType, setMembershipType] = useState<MType>('individual');
  const [social, setSocial] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim() || !email.trim() || !phone.trim()) {
      toast.error('Please fill in your name, email and phone.');
      return;
    }
    setSubmitting(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      // Attach the session so an applied-while-signed-in account can be linked.
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) headers['Authorization'] = 'Bearer ' + session.access_token;
      } catch { /* ignore */ }

      const res = await fetch(`${API_BASE}/api/membership`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ fullName, email, phone, membershipType, social, notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not submit your application.');
      setDone(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f6f2e8]">
      {/* Hero */}
      <section className="relative bg-[#12207e] text-white py-20 px-4 text-center overflow-hidden">
        <div className="max-w-2xl mx-auto relative z-10">
          <p className="text-[#e3c878] tracking-[0.3em] text-xs uppercase font-semibold mb-4">The Members Circle</p>
          <h1 className="font-serif text-4xl md:text-5xl font-semibold mb-4" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
            Become a Member
          </h1>
          <p className="text-white/80 text-base leading-relaxed">
            Join the Mazi circle for priority reservations, members' evenings, and the first word on
            every sunset session. Apply below — our team personally reviews each request.
          </p>
        </div>
      </section>

      <div className="max-w-xl mx-auto px-4 py-12">
        {!session ? (
          <SignInGate
            title="Sign in to apply"
            message="Membership applications are handled through your Mazi account. Sign in or create your account, then apply — it only takes a moment."
          />
        ) : done ? (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl border shadow-sm p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-green-50 border border-green-200 flex items-center justify-center mx-auto mb-4">
              <Check className="w-7 h-7 text-green-600" />
            </div>
            <h2 className="text-2xl font-serif font-semibold text-[#1b2350] mb-2" style={{ fontFamily: "Georgia, serif" }}>Application received</h2>
            <p className="text-gray-600 text-sm leading-relaxed">
              Thank you, {fullName.split(' ')[0] || 'friend'}. Our team will review your application and email you at{' '}
              <span className="font-medium text-[#12207e]">{email}</span> with a decision. We can't wait to welcome you by the sea.
            </p>
          </motion.div>
        ) : (
          <motion.form initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            onSubmit={handleSubmit} className="bg-white rounded-2xl border shadow-sm p-6 md:p-8 space-y-5">
            <div className="flex items-center gap-2 text-[#12207e] mb-1">
              <IdCard className="w-5 h-5" />
              <h2 className="font-semibold text-lg">Membership application</h2>
            </div>

            <div>
              <Label className="mb-1.5 block">Membership</Label>
              <div className="grid grid-cols-3 gap-2">
                {TYPES.map(t => (
                  <button key={t.key} type="button" onClick={() => setMembershipType(t.key)}
                    className={`rounded-xl border p-3 text-center transition-colors ${membershipType === t.key ? 'border-transparent bg-[#12207e] text-white' : 'border-gray-200 text-gray-700 hover:border-[#12207e]/40'}`}>
                    <div className="text-sm font-semibold">{t.label}</div>
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">{TYPES.find(t => t.key === membershipType)?.blurb}</p>
            </div>

            <div><Label>Full name *</Label><Input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your name" /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><Label>Email *</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com" /></div>
              <div><Label>Phone *</Label><Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+20 1XX XXX XXXX" /></div>
            </div>
            <div><Label>Instagram / social <span className="text-muted-foreground font-normal">(optional)</span></Label><Input value={social} onChange={e => setSocial(e.target.value)} placeholder="@yourhandle" /></div>
            <div><Label>Anything you'd like us to know <span className="text-muted-foreground font-normal">(optional)</span></Label><Textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Tell us a little about yourself…" /></div>

            <Button type="submit" disabled={submitting} className="w-full h-12 bg-gradient-to-r from-[#c9a24a] to-[#e3c878] hover:from-[#e3c878] hover:to-[#c9a24a] text-[#1b2350] font-semibold text-sm uppercase tracking-[0.12em] rounded-xl">
              {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting…</> : 'Apply for membership'}
            </Button>
            <p className="text-center text-xs text-muted-foreground">Every application is reviewed personally — you'll hear from us by email.</p>
          </motion.form>
        )}
      </div>
    </div>
  );
}

export default MembershipPage;
