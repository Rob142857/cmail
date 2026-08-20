import { describe, expect, it } from 'vitest';
import { COUNTRIES, countryName, isValidCountryCode } from './countries';

describe('countries', () => {
  it('has no duplicate codes', () => {
    const codes = COUNTRIES.map((country) => country.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('uses exactly two uppercase letters for every code', () => {
    expect(COUNTRIES.every((country) => /^[A-Z]{2}$/.test(country.code))).toBe(true);
  });

  it('is sorted alphabetically by name', () => {
    const names = COUNTRIES.map((country) => country.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b, 'en'));
    expect(names).toEqual(sorted);
  });

  it('includes Australia and New Zealand', () => {
    const codes = new Set(COUNTRIES.map((country) => country.code));
    expect(codes.has('AU')).toBe(true);
    expect(codes.has('NZ')).toBe(true);
  });

  describe('countryName', () => {
    it('resolves a known code case-insensitively', () => {
      expect(countryName('au')).toBe('Australia');
      expect(countryName('AU')).toBe('Australia');
      expect(countryName(' nz ')).toBe('New Zealand');
    });

    it('falls back to the uppercased code for an unknown value', () => {
      expect(countryName('zz')).toBe('ZZ');
    });
  });

  describe('isValidCountryCode', () => {
    it('accepts only codes actually in the list', () => {
      expect(isValidCountryCode('AU')).toBe(true);
      expect(isValidCountryCode('au')).toBe(true);
      expect(isValidCountryCode('XX')).toBe(false);
      expect(isValidCountryCode('XK')).toBe(false); // Kosovo: deliberately unofficial, excluded
      expect(isValidCountryCode('')).toBe(false);
    });
  });
});
