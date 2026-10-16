import * as React from 'react';
import { cn } from './button.js';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'destructive' | 'success' | 'warning';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-950 focus:ring-offset-2',
        variant === 'default' &&
          'border-transparent bg-neutral-900 text-neutral-50 shadow',
        variant === 'secondary' &&
          'border-transparent bg-neutral-100 text-neutral-900 hover:bg-neutral-100/80',
        variant === 'outline' && 'text-neutral-950 border-neutral-200',
        variant === 'destructive' &&
          'border-transparent bg-red-500 text-neutral-50 shadow',
        variant === 'success' &&
          'border-transparent bg-emerald-500 text-white shadow',
        variant === 'warning' &&
          'border-transparent bg-amber-500 text-white shadow',
        className,
      )}
      {...props}
    />
  );
}
