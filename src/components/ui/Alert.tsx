import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const alertVariants = cva(
  'relative w-full rounded border p-3 text-xs [&>svg~*]:pl-6 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-3 [&>svg]:top-3 [&>svg]:text-[#f1f5ef]',
  {
    variants: {
      variant: {
        default: 'border-[#344039] bg-[#1a231f] text-[#f1f5ef]',
        destructive: 'border-[#ffab9e]/30 bg-[#ffab9e]/15 text-[#ffab9e] [&>svg]:text-[#ffab9e]',
        warning: 'border-[#f2c278]/30 bg-[#f2c278]/15 text-[#f2c278] [&>svg]:text-[#f2c278]',
        success: 'border-[#9be7be]/30 bg-[#9be7be]/15 text-[#9be7be] [&>svg]:text-[#9be7be]',
        info: 'border-[#9ac4fb]/30 bg-[#9ac4fb]/15 text-[#9ac4fb] [&>svg]:text-[#9ac4fb]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn('mb-1 font-semibold leading-none tracking-tight text-white', className)}
    {...props}
  />
));
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('text-xs [&_p]:leading-relaxed text-[#acb9b0]', className)}
    {...props}
  />
));
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription };
