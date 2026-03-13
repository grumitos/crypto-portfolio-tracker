function normalizeRawNumericInput(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/[\s,]+/g, '')
    .replace(/[^\d.-]+/g, '')
    .trim();
}

export function parseLooseNumber(value: unknown): number {
  const normalized = normalizeRawNumericInput(value);
  return normalized ? Number.parseFloat(normalized) : Number.NaN;
}

export function parseStrictNumber(value: unknown): number {
  if (typeof value !== 'number' && typeof value !== 'string') return Number.NaN;
  const normalized = String(value).trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(normalized)) return Number.NaN;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function parseFlexibleNumber(raw: string): number {
  const cleaned = raw
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^\d.,+-]/g, '');
  if (!cleaned) return Number.NaN;

  const sign = cleaned.startsWith('-') ? -1 : 1;
  const unsigned = cleaned.replace(/^[+-]/, '');
  if (!unsigned) return Number.NaN;

  const commaCount = (unsigned.match(/,/g) || []).length;
  const dotCount = (unsigned.match(/\./g) || []).length;
  if (commaCount === 0 && dotCount === 0) {
    const value = Number(unsigned);
    return Number.isFinite(value) ? sign * value : Number.NaN;
  }

  let decimalSep: ',' | '.' | null = null;
  if (commaCount > 0 && dotCount > 0) {
    decimalSep = unsigned.lastIndexOf(',') > unsigned.lastIndexOf('.') ? ',' : '.';
  } else {
    const sep: ',' | '.' = commaCount > 0 ? ',' : '.';
    const count = sep === ',' ? commaCount : dotCount;
    const lastIndex = unsigned.lastIndexOf(sep);
    const fractionalLength = unsigned.length - lastIndex - 1;
    decimalSep = fractionalLength === 3 && count >= 1 ? null : sep;
  }

  const normalized = !decimalSep
    ? unsigned.replace(/[.,]/g, '')
    : (() => {
        const index = unsigned.lastIndexOf(decimalSep);
        const integerPart = unsigned.slice(0, index).replace(/[.,]/g, '');
        const fractionPart = unsigned.slice(index + 1).replace(/[.,]/g, '');
        return `${integerPart}.${fractionPart}`;
      })();

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? sign * parsed : Number.NaN;
}
