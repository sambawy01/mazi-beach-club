import React, { useState } from 'react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { verifyPassword, staffLogin, setStoredPassword, setStoredRole, Role } from '@/services/adminService';
import { AdminLang } from './useAdminLang';

interface AdminLoginProps {
  onLogin: (role: Role) => void;
  l: AdminLang;
}

export function AdminLogin({ onLogin, l }: AdminLoginProps) {
  const { tr } = l;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    setError('');
    try {
      if (email.trim()) {
        // Named staff sign-in → signed session token.
        const { token, role } = await staffLogin(email.trim(), password);
        setStoredPassword(token);
        setStoredRole(role);
        onLogin(role);
      } else {
        // Owner break-glass — the password is used directly as the bearer token.
        const result = await verifyPassword(password.trim());
        if (result.valid && result.role) {
          setStoredPassword(password.trim());
          setStoredRole(result.role);
          onLogin(result.role);
        } else {
          setError('Invalid email or password.');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f6f2e8]">
      <div className="w-full max-w-sm mx-auto p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[#1b2350]" style={{ fontFamily: 'Georgia, serif' }}>Mazi Admin</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in to the operations panel</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Email <span className="text-gray-400 font-normal">— staff sign-in</span></label>
            <Input
              type="email"
              placeholder="you@mazibeach.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              disabled={loading}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Password</label>
            <Input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>

          {error && <p className="text-sm text-destructive text-center">{error}</p>}

          <Button type="submit" className="w-full bg-[#12207e] hover:bg-[#0e1533] text-white" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
          <p className="text-[11px] text-gray-400 text-center leading-relaxed">
            Staff sign in with their email &amp; password. Owner access: leave email blank and enter the owner password.
          </p>
        </form>
      </div>
    </div>
  );
}
