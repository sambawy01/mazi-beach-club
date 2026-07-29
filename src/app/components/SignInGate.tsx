import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Button } from './ui/button';

/**
 * Membership gate. Reservations and ordering are members-only — browsing the
 * menu stays public, but the booking/checkout actions render this instead of
 * the form when there is no session. Passes the current path as `redirect` so
 * sign-in can return the guest to where they were.
 */
export function SignInGate({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  const location = useLocation();
  const to = `/signin?redirect=${encodeURIComponent(location.pathname + location.search)}`;
  return (
    <div className="card-luxe shadow-float text-center p-10 md:p-14 max-w-lg mx-auto">
      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#12207e] to-[#2f6f9e] flex items-center justify-center mx-auto mb-6 shadow-float">
        <Lock className="w-7 h-7 text-white" />
      </div>
      <h2 className="display-xl text-3xl text-[#1b2350] mb-3">{title}</h2>
      <p className="font-elegant italic text-lg text-[#12207e]/70 mb-8">{message}</p>
      <Link to={to}>
        <Button className="sheen bg-gradient-to-r from-[#c9a24a] to-[#e3c878] hover:from-[#e3c878] hover:to-[#c9a24a] text-[#1b2350] rounded-full px-9 h-12 text-sm font-semibold uppercase tracking-[0.14em] shadow-gold">
          Sign in to continue
        </Button>
      </Link>
      <p className="text-sm text-gray-400 mt-5">New here? Your account is created in the same step.</p>
    </div>
  );
}
