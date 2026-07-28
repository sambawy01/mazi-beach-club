// tests/checkinToken.test.ts
import { describe, it, expect } from 'vitest';
import { generateCheckinToken } from '../api/_lib/checkinToken.js';

describe('generateCheckinToken', () => {
  it('starts with r_ and is URL-safe', () => {
    const t = generateCheckinToken();
    expect(t).toMatch(/^r_[A-Za-z0-9_-]{16,}$/);
  });
  it('is unique across many calls', () => {
    const set = new Set(Array.from({ length: 1000 }, () => generateCheckinToken()));
    expect(set.size).toBe(1000);
  });
});
