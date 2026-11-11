import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#9ac4fb] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-[#285dab] text-white hover:bg-[#3471c9]',
        primary: 'bg-[#285dab] text-white hover:bg-[#3471c9]',
        destructive: 'bg-[#a93d38] text-white hover:bg-[#c3363b]',
        danger: 'bg-[#a93d38] text-white hover:bg-[#c3363b]',
        outline: 'border border-[#344039] bg-[#111816] hover:bg-[#1a231f] text-[#f1f5ef]',
        secondary: 'border border-[#344039] bg-[#1a231f] hover:bg-[#233128] text-[#f1f5ef]',
        ghost: 'border border-[#344039] bg-[#111816] text-[#acb9b0] hover:text-[#f1f5ef] hover:bg-[#1a231f]',
        warning: 'bg-[#f2c278] text-black hover:bg-[#c88d25]',
        success: 'bg-[#28734a] text-white hover:bg-[#349e6d]',
        link: 'text-[#9ac4fb] underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-3 py-1.5',
        sm: 'h-7 rounded px-2 text-xs',
        lg: 'h-9 rounded px-4',
        icon: 'h-8 w-8',
      },
    },
    defaultVariants: {
      variant: 'ghost',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        type={props.type || 'button'}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
