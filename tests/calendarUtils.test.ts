// tests/calendarUtils.test.ts
import { describe, it, expect } from 'vitest';
import { localKey, prettyTime, timeToMinutes } from '../src/app/pages/admin/calendarUtils';

describe('localKey', () => {
  it('formats a single-digit month/day (local, not UTC)', () => {
    expect(localKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('zero-pads a double-digit month/day', () => {
    expect(localKey(new Date(2026, 11, 25))).toBe('2026-12-25');
  });
});

describe('prettyTime', () => {
  it('converts 24-hour to 12-hour with meridiem', () => {
    expect(prettyTime('16:00')).toBe('4:00 PM');
  });

  it('keeps 12:00 AM as midnight', () => {
    expect(prettyTime('12:00 AM')).toBe('12:00 AM');
  });

  it('keeps 12:00 PM as noon', () => {
    expect(prettyTime('12:00 PM')).toBe('12:00 PM');
  });

  it('normalises an already-12h value', () => {
    expect(prettyTime('4:00 PM')).toBe('4:00 PM');
  });

  it('returns empty string on unknown / empty input', () => {
    expect(prettyTime('')).toBe('');
  });
});

describe('timeToMinutes', () => {
  it('treats 12:00 AM as 0', () => {
    expect(timeToMinutes('12:00 AM')).toBe(0);
  });

  it('treats 12:00 PM as 720', () => {
    expect(timeToMinutes('12:00 PM')).toBe(720);
  });

  it('parses 24-hour values', () => {
    expect(timeToMinutes('16:00')).toBe(960);
  });

  it('sorts a later time after an earlier one', () => {
    expect(timeToMinutes('9:30 AM')).toBeLessThan(timeToMinutes('9:30 PM'));
    expect(timeToMinutes('08:00')).toBeLessThan(timeToMinutes('16:00'));
  });
});
