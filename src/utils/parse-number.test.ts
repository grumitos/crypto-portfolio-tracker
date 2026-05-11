import { describe, expect, it } from '#test';
import { parseFlexibleNumber, parseLooseNumber, parseStrictNumber } from './parse-number';

describe('parse-number', () => {
  it('parses loose numeric values with symbols and separators', () => {
    expect(parseLooseNumber(' $1,234.56 ')).toBeCloseTo(1234.56, 8);
    expect(parseLooseNumber('abc')).toBeNaN();
    expect(parseLooseNumber(null)).toBeNaN();
  });

  it('parses strict numeric values only', () => {
    expect(parseStrictNumber('123.45')).toBe(123.45);
    expect(parseStrictNumber('-10')).toBe(-10);
    expect(parseStrictNumber('1,234')).toBeNaN();
    expect(parseStrictNumber('abc')).toBeNaN();
  });

  it('parses flexible localized number strings', () => {
    expect(parseFlexibleNumber('1,234.56')).toBeCloseTo(1234.56, 8);
    expect(parseFlexibleNumber('1.234,56')).toBeCloseTo(1234.56, 8);
    expect(parseFlexibleNumber('12 345')).toBe(12345);
    expect(parseFlexibleNumber('-1.500')).toBe(-1500);
    expect(parseFlexibleNumber('')).toBeNaN();
  });
});
