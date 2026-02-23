import { describe, expect, it } from 'vitest';
import { skeletonSpan } from './ui-helpers';

describe('ui helpers', () => {
  it('renders skeleton span with default and custom width', () => {
    expect(skeletonSpan()).toContain('width:80px');
    expect(skeletonSpan('120px')).toContain('width:120px');
    expect(skeletonSpan('120px')).toContain('skeleton-number');
  });
});
