import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-[#9ac4fb]',
  {
    variants: {
      variant: {
        default: 'border-[#344039] bg-[#111816] text-[#f1f5ef]',
        secondary: 'border-[#344039] bg-[#1a231f] text-[#acb9b0]',
        destructive: 'border-[#ffab9e]/30 bg-[#ffab9e]/15 text-[#ffab9e]',
        danger: 'border-[#ffab9e]/30 bg-[#ffab9e]/15 text-[#ffab9e]',
        outline: 'border-[#344039] text-[#f1f5ef]',
        success: 'border-[#9be7be]/30 bg-[#9be7be]/15 text-[#9be7be]',
        warning: 'border-[#f2c278]/30 bg-[#f2c278]/15 text-[#f2c278]',
        info: 'border-[#9ac4fb]/30 bg-[#9ac4fb]/15 text-[#9ac4fb]',
        neutral: 'border-[#344039] bg-[#111816] text-[#acb9b0]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
