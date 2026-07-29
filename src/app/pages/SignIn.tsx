import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Mail, KeyRound, User as UserIcon, Phone, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { useAuth } from '../auth/AuthProvider';
import { sanitizeRedirect } from '../auth/sanitizeRedirect';
import { supabase } from '../../lib/supabase';

type Step = 'email' | 'code' | 'profile';

const inputClass =
  'w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e]';

/** Map a Supabase auth error into a friendly, actionable message. */
function friendlyAuthError(err: unknown, fallback: string): string {
  const raw =
    (err as { message?: string })?.message?.toLowerCase() ?? '';
  if (raw.includes('rate') || raw.includes('too many') || raw.includes('429')) {
    return 'Too many attempts. Please wait a minute and try again.';
  }
  if (raw.includes('expired')) {
    return 'That code has expired. Request a new one.';
  }
  if (raw.includes('invalid') || raw.includes('token')) {
    return 'That code is invalid. Double-check it and try again.';
  }
  if (raw.includes('email')) {
    return 'Please enter a valid email address.';
  }
  return (err as { message?: string })?.message || fallback;
}

export function SignIn() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = sanitizeRedirect(searchParams.get('redirect'));

  const { session, user, profile, loading, profileLoaded, signInWithOtp, verifyOtp, refreshProfile } =
    useAuth();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // True only after the user actively verifies a code this session, so the
  // "Signed in" toast fires when we proceed to the redirect — not on a passive
  // visit by an already-signed-in user, and not before profile completion.
  const justVerified = useRef(false);

  // Tick down the resend cooldown once per second.
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  // Once auth is resolved: if signed in WITH a profile, leave the sign-in screen.
  // If signed in but the profile fetch has resolved with no profile, drop the
  // user into the profile-completion step. Gating on `profileLoaded` prevents a
  // returning user from flashing that step while their profile is still loading.
  useEffect(() => {
    if (loading) return;
    if (session && profile) {
      if (justVerified.current) {
        justVerified.current = false;
        toast.success('Signed in.');
      }
      navigate(redirectTo, { replace: true });
    } else if (session && profileLoaded && !profile) {
      // Genuinely profile-less: proceed to completion, not the redirect. Clear
      // the flag so finishing the profile doesn't retrigger the sign-in toast.
      justVerified.current = false;
      setStep('profile');
      setFullName((prev) => prev || user?.user_metadata?.full_name || '');
    }
  }, [loading, session, profile, profileLoaded, user, navigate, redirectTo]);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error('Please enter your email address.');
      return;
    }
    setSubmitting(true);
    try {
      await signInWithOtp(trimmed);
      setEmail(trimmed);
      setStep('code');
      setResendCooldown(30);
      toast.success('Code sent — check your inbox for a 6-digit code.');
    } catch (err) {
      toast.error(friendlyAuthError(err, 'Could not send the code. Try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (trimmed.length < 6) {
      toast.error('Enter the 6-digit code from your email.');
      return;
    }
    setSubmitting(true);
    try {
      justVerified.current = true;
      await verifyOtp(email, trimmed);
      // On success, AuthProvider updates session + profile; the effect above
      // routes to profile completion or the redirect target. The success toast
      // is fired there (only when actually proceeding to the redirect), not
      // here — a profile-less user shouldn't be told "Signed in" right before
      // being asked to complete their profile.
    } catch (err) {
      toast.error(friendlyAuthError(err, 'Could not verify the code. Try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setSubmitting(true);
    try {
      await signInWithOtp(email);
      setResendCooldown(30);
      toast.success('New code sent.');
    } catch (err) {
      toast.error(friendlyAuthError(err, 'Could not resend the code.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      toast.error('Session expired. Please sign in again.');
      setStep('email');
      return;
    }
    if (!fullName.trim()) {
      toast.error('Please enter your name.');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from('profiles').upsert(
        {
          user_id: user.id,
          full_name: fullName.trim(),
          phone: phone.trim() || null,
        },
        { onConflict: 'user_id' }
      );
      if (error) throw error;
      await refreshProfile();
      toast.success('Profile saved.');
      navigate(redirectTo, { replace: true });
    } catch (err) {
      toast.error(
        (err as { message?: string })?.message || 'Could not save your profile. Try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Avoid a flash of the email form while we resolve an existing session.
  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#12207e]" />
      </div>
    );
  }

  return (
    <div className="min-h-[70vh] bg-[#f6f2e8] flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="inline-block mb-6">
            <img
              src="/mazi-logo-full.png"
              alt="Mazi"
              className="h-14 w-auto object-contain mx-auto"
            />
          </Link>
          <h1 className="display-xl text-4xl text-[#1b2350]">
            {step === 'profile' ? 'Complete your profile' : (<>Welcome to <span className="italic text-aegean-gradient">Mazi</span></>)}
          </h1>
          <p className="text-sm text-gray-500 mt-2">
            {step === 'email' &&
              'Enter your email and we’ll send you a one-time code.'}
            {step === 'code' && (
              <>
                We sent a 6-digit code to{' '}
                <span className="font-semibold text-gray-700">{email}</span>.
              </>
            )}
            {step === 'profile' &&
              'Just a couple of details so we can prefill your reservations and orders.'}
          </p>
        </div>

        <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100">
          {/* Step 1 — email */}
          {step === 'email' && (
            <form onSubmit={handleSendCode} className="space-y-5">
              <div>
                <label
                  htmlFor="signin-email"
                  className="block text-sm font-semibold text-gray-700 mb-2"
                >
                  Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="signin-email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className={`${inputClass} pl-9`}
                  />
                </div>
              </div>
              <Button
                type="submit"
                disabled={submitting}
                className="w-full h-12 text-base font-bold rounded-xl"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Send code'
                )}
              </Button>
            </form>
          )}

          {/* Step 2 — code */}
          {step === 'code' && (
            <form onSubmit={handleVerifyCode} className="space-y-5">
              <div>
                <label
                  htmlFor="signin-code"
                  className="block text-sm font-semibold text-gray-700 mb-2"
                >
                  6-digit code
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="signin-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={6}
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                    }
                    placeholder="123456"
                    className={`${inputClass} pl-9 tracking-[0.4em] font-semibold text-center`}
                  />
                </div>
              </div>
              <Button
                type="submit"
                disabled={submitting}
                className="w-full h-12 text-base font-bold rounded-xl"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Verify & sign in'
                )}
              </Button>
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={() => {
                    setStep('email');
                    setCode('');
                  }}
                  className="text-gray-500 hover:text-gray-700 flex items-center gap-1"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Change email
                </button>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={submitting || resendCooldown > 0}
                  className="font-medium text-[#12207e] hover:underline disabled:opacity-50 disabled:no-underline"
                >
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                </button>
              </div>
            </form>
          )}

          {/* Step 3 — profile completion */}
          {step === 'profile' && (
            <form onSubmit={handleCompleteProfile} className="space-y-5">
              <div>
                <label
                  htmlFor="profile-name"
                  className="block text-sm font-semibold text-gray-700 mb-2"
                >
                  Full name
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="profile-name"
                    type="text"
                    autoComplete="name"
                    autoFocus
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your name"
                    className={`${inputClass} pl-9`}
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="profile-phone"
                  className="block text-sm font-semibold text-gray-700 mb-2"
                >
                  Phone <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="profile-phone"
                    type="tel"
                    autoComplete="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+20 100 000 0000"
                    className={`${inputClass} pl-9`}
                  />
                </div>
              </div>
              <Button
                type="submit"
                disabled={submitting}
                className="w-full h-12 text-base font-bold rounded-xl"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Save & continue'
                )}
              </Button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          By continuing you agree to receive a one-time sign-in code by email.
        </p>
      </div>
    </div>
  );
}

export default SignIn;
