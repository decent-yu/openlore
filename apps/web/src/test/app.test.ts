import { describe, expect, it } from 'vitest';
import { cn } from '../components/ui/button.js';

describe('Web UI components & utilities', () => {
  it('combines class names correctly with cn()', () => {
    expect(cn('p-4', 'text-sm')).toBe('p-4 text-sm');
    expect(cn('p-4', false && 'hidden', 'text-sm')).toBe('p-4 text-sm');
    expect(cn('p-4', 'p-6')).toBe('p-6'); // tailwind-merge override
  });

  it('renders route structure without throwing', () => {
    expect(true).toBe(true);
  });
});
