import { describe, it, expect } from 'vitest';
import { sanitizeRedirect } from '../src/app/auth/sanitizeRedirect';

describe('sanitizeRedirect', () => {
  it('allows internal absolute paths', () => {
    expect(sanitizeRedirect('/reserve')).toBe('/reserve');
    expect(sanitizeRedirect('/account')).toBe('/account');
  });

  it('rejects protocol-relative URLs', () => {
    expect(sanitizeRedirect('//evil.com')).toBe('/account');
  });

  it('rejects absolute URLs', () => {
    expect(sanitizeRedirect('https://evil.com')).toBe('/account');
  });

  it('rejects backslash path tricks', () => {
    expect(sanitizeRedirect('/\\evil')).toBe('/account');
  });

  it('falls back for null and empty input', () => {
    expect(sanitizeRedirect(null)).toBe('/account');
    expect(sanitizeRedirect('')).toBe('/account');
  });
});
