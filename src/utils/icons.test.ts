import { describe, expect, it } from '#test';
import * as icons from './icons';

describe('icons', () => {
  it('renders all exported icons as svg strings', () => {
    const entries = Object.entries(icons) as Array<[string, (size?: number | string) => string]>;
    expect(entries.length).toBeGreaterThan(0);

    for (const [_name, iconFn] of entries) {
      const svg = iconFn(16);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('width="16px"');
      expect(svg).toContain('height="16px"');
      expect(svg).toContain('stroke="currentColor"');
    }
  });
});
