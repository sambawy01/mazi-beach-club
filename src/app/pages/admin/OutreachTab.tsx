import React, { useState, useEffect } from 'react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Label } from '@/app/components/ui/label';
import { getStoredPassword, getContacts, sendOutreach, Contact } from '@/services/adminService';
import { toast } from 'sonner';
import { Mail, Users, User, Send, Loader2 } from 'lucide-react';

type Template = { name: string; subject: string; title: string; body: string; ctaLabel?: string; ctaUrl?: string };

// Most-used outreach templates — the admin picks one and edits before sending.
const TEMPLATES: Template[] = [
  {
    name: 'New Menu',
    subject: 'Our new menu has landed 🍽️',
    title: 'A New Season at Mazi',
    body: "We've refreshed our menu with new Mediterranean plates, the freshest catch, and summer cocktails.\n\nCome taste what's new — we've saved you a seat by the sea.",
    ctaLabel: 'View the Menu', ctaUrl: 'https://mazibeach.com/menu',
  },
  {
    name: 'This Weekend',
    subject: 'This weekend at Mazi 🎶',
    title: 'Sunset Sessions This Weekend',
    body: "Join us this weekend for live music, golden-hour cocktails, and dining on the sand.\n\nReserve your table before they're gone.",
    ctaLabel: 'Reserve a Table', ctaUrl: 'https://mazibeach.com/reserve',
  },
  {
    name: 'Special Offer',
    subject: 'A little something for you ✨',
    title: 'An Offer, From Us to You',
    body: "As one of our guests, we'd love to welcome you back with a special treat on your next visit.\n\nSimply show this email to your server to enjoy it.",
    ctaLabel: 'Reserve Now', ctaUrl: 'https://mazibeach.com/reserve',
  },
  {
    name: 'We Miss You',
    subject: "We've saved your seat 🌊",
    title: "It's Been a While",
    body: "The sea just isn't the same without you. Come back and let us take care of the rest — good food, good company, together by the sea.",
    ctaLabel: 'Come Back', ctaUrl: 'https://mazibeach.com/reserve',
  },
  {
    name: 'Thank You',
    subject: 'Thank you for visiting Mazi',
    title: 'Thank You',
    body: 'It was a genuine pleasure to have you with us. Thank you for choosing Mazi — we hope to welcome you again very soon.',
    ctaLabel: 'Book Again', ctaUrl: 'https://mazibeach.com/reserve',
  },
  { name: 'Blank', subject: '', title: '', body: '', ctaLabel: '', ctaUrl: '' },
];

export function OutreachTab() {
  const [subject, setSubject] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [ctaLabel, setCtaLabel] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');
  const [mode, setMode] = useState<'all' | 'one'>('all');
  const [singleEmail, setSingleEmail] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const pw = getStoredPassword();
    if (!pw) { setLoadingContacts(false); return; }
    getContacts(pw).then(setContacts).catch(() => {}).finally(() => setLoadingContacts(false));
  }, []);

  function applyTemplate(t: Template) {
    setSubject(t.subject); setTitle(t.title); setBody(t.body);
    setCtaLabel(t.ctaLabel || ''); setCtaUrl(t.ctaUrl || '');
  }

  async function handleSend() {
    const pw = getStoredPassword();
    if (!pw) { toast.error('Not authenticated'); return; }
    if (!subject.trim() || !body.trim()) { toast.error('Add a subject and a message'); return; }
    if (mode === 'one' && !/@/.test(singleEmail)) { toast.error('Enter a valid email address'); return; }
    const recipients = mode === 'all' ? 'all' : singleEmail.trim();
    const who = mode === 'all' ? `all ${contacts.length} customers` : singleEmail.trim();
    if (!window.confirm(`Send this email to ${who}?`)) return;
    setSending(true);
    try {
      const r = await sendOutreach(pw, {
        subject, title, body,
        ctaLabel: ctaLabel || undefined, ctaUrl: ctaUrl || undefined,
        recipients,
      });
      toast.success(`Sent to ${r.sent} of ${r.total}${r.failed ? ` — ${r.failed} failed` : ''}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Send failed');
    } finally { setSending(false); }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-bold text-[#1b2350] flex items-center gap-2"><Mail className="size-5" /> Outreach</h2>
        <p className="text-sm text-muted-foreground">Send promotions and communications to your customers — branded like every Mazi email.</p>
      </div>

      <div>
        <Label className="mb-2 block">Start from a template</Label>
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map(t => (
            <button key={t.name} type="button" onClick={() => applyTemplate(t)}
              className="px-3 py-1.5 rounded-full border border-[#12207e]/20 text-sm text-[#12207e] hover:bg-[#12207e]/5 transition-colors">
              {t.name}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <div><Label>Subject *</Label><Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Email subject line" /></div>
        <div><Label>Headline</Label><Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Big title inside the email (optional)" /></div>
        <div><Label>Message *</Label><Textarea rows={7} value={body} onChange={e => setBody(e.target.value)} placeholder="Write your message… (leave a blank line between paragraphs)" /></div>
        <div className="grid grid-cols-2 gap-4">
          <div><Label>Button label</Label><Input value={ctaLabel} onChange={e => setCtaLabel(e.target.value)} placeholder="e.g. Reserve a Table" /></div>
          <div><Label>Button link</Label><Input value={ctaUrl} onChange={e => setCtaUrl(e.target.value)} placeholder="https://mazibeach.com/reserve" /></div>
        </div>
      </div>

      <div className="rounded-xl border p-4 space-y-3">
        <Label className="block">Send to</Label>
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <input type="radio" name="rcpt" checked={mode === 'all'} onChange={() => setMode('all')} />
          <Users className="size-4 text-[#12207e]" /> All customers {loadingContacts ? '…' : `(${contacts.length})`}
        </label>
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <input type="radio" name="rcpt" checked={mode === 'one'} onChange={() => setMode('one')} />
          <User className="size-4 text-[#12207e]" /> A single customer
        </label>
        {mode === 'one' && <Input value={singleEmail} onChange={e => setSingleEmail(e.target.value)} placeholder="customer@email.com" />}
      </div>

      <Button onClick={handleSend} disabled={sending} className="bg-[#12207e] hover:bg-[#0e1533] text-white">
        {sending ? <><Loader2 className="size-4 mr-2 animate-spin" /> Sending…</> : <><Send className="size-4 mr-2" /> Send email</>}
      </Button>
    </div>
  );
}
