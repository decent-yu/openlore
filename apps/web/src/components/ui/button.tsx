import * as React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: any[]) {
  return twMerge(clsx(inputs));
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-950 disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
          variant === 'default' &&
            'bg-neutral-900 text-neutral-50 shadow hover:bg-neutral-900/90',
          variant === 'destructive' &&
            'bg-red-600 text-neutral-50 shadow-sm hover:bg-red-600/90',
          variant === 'outline' &&
            'border border-neutral-200 bg-white shadow-sm hover:bg-neutral-100 hover:text-neutral-900',
          variant === 'secondary' &&
            'bg-neutral-100 text-neutral-900 shadow-sm hover:bg-neutral-100/80',
          variant === 'ghost' && 'hover:bg-neutral-100 hover:text-neutral-900',
          size === 'default' && 'h-9 px-4 py-2',
          size === 'sm' && 'h-8 rounded-md px-3 text-xs',
          size === 'lg' && 'h-10 rounded-md px-8',
          size === 'icon' && 'h-9 w-9',
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
