// tests/parsePaymentReply.test.js
import { describe, it, expect } from 'vitest';
import { parsePaymentReply } from '../api/_lib/parsePaymentReply.js';

describe('parsePaymentReply', () => {
  it('parses a simple link + amount', () => {
    expect(parsePaymentReply('https://pay.link/abc 500')).toEqual({
      link: 'https://pay.link/abc',
      amount: 500,
    });
  });

  it('parses amount before link (either order)', () => {
    expect(parsePaymentReply('500 https://pay.link/abc')).toEqual({
      link: 'https://pay.link/abc',
      amount: 500,
    });
  });

  it('parses decimal amounts', () => {
    expect(parsePaymentReply('https://pay.link/abc 500.00')).toEqual({
      link: 'https://pay.link/abc',
      amount: 500,
    });
  });

  it('parses comma-separated thousands', () => {
    expect(parsePaymentReply('https://pay.link/abc 1,000')).toEqual({
      link: 'https://pay.link/abc',
      amount: 1000,
    });
  });

  it('parses comma thousands with decimals', () => {
    expect(parsePaymentReply('Pay 1,000.50 here https://pay.link/abc')).toEqual({
      link: 'https://pay.link/abc',
      amount: 1000.5,
    });
  });

  it('handles http:// links too', () => {
    expect(parsePaymentReply('http://pay.link/x 250')).toEqual({
      link: 'http://pay.link/x',
      amount: 250,
    });
  });

  it('ignores digits inside the URL and uses the standalone amount', () => {
    expect(parsePaymentReply('https://pay.link/order/12345 750')).toEqual({
      link: 'https://pay.link/order/12345',
      amount: 750,
    });
  });

  it('strips a SECOND url so its path digits are not read as the amount', () => {
    // Both URLs' path digits (1 and 2) must be ignored; the standalone 500 wins,
    // and the link is the FIRST url.
    expect(parsePaymentReply('https://a.co/1 https://b.co/2 500')).toEqual({
      link: 'https://a.co/1',
      amount: 500,
    });
  });

  it('handles amount before two links (link is still the first url)', () => {
    expect(parsePaymentReply('500 https://a.co/1 https://b.co/2')).toEqual({
      link: 'https://a.co/1',
      amount: 500,
    });
  });

  it('tolerates extra whitespace and newlines', () => {
    expect(parsePaymentReply('   https://pay.link/abc   \n  500   ')).toEqual({
      link: 'https://pay.link/abc',
      amount: 500,
    });
  });

  it('errors when the URL is missing', () => {
    const r = parsePaymentReply('just pay 500');
    expect(r.link).toBeUndefined();
    expect(r.amount).toBeUndefined();
    expect(r.error).toBeTruthy();
  });

  it('errors when the amount is missing', () => {
    const r = parsePaymentReply('https://pay.link/abc');
    expect(r.error).toBeTruthy();
  });

  it('errors on a zero amount', () => {
    const r = parsePaymentReply('https://pay.link/abc 0');
    expect(r.error).toBeTruthy();
  });

  it('errors on a negative amount (no positive number present)', () => {
    const r = parsePaymentReply('https://pay.link/abc -50');
    expect(r.error).toBeTruthy();
  });

  it('errors on empty / non-string input', () => {
    expect(parsePaymentReply('').error).toBeTruthy();
    expect(parsePaymentReply(undefined).error).toBeTruthy();
    expect(parsePaymentReply(null).error).toBeTruthy();
  });
});
