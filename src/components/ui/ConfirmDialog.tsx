import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal?.();
    else dialog.current?.close?.();
  }, [open]);

  return (
    <dialog ref={dialog} className="rail-dialog" aria-labelledby="confirm-dialog-title" onCancel={onCancel}>

      <div
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="w-full"
      >
        <div className="mb-4 flex items-start gap-3">
          {(variant === 'danger' || variant === 'warning') && (
            <div className={`mt-0.5 rounded p-1 shrink-0 ${variant === 'danger' ? 'bg-[#ffab9e]/15 text-[#ffab9e]' : 'bg-[#f2c278]/15 text-[#f2c278]'}`}>
              <AlertTriangle className="h-4 w-4" />
            </div>
          )}
          <div>
            <h2 id="confirm-dialog-title" className="text-sm font-semibold text-white">
              {title}
            </h2>
            <p id="confirm-dialog-message" className="mt-1 text-xs text-[#acb9b0]">
              {message}
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-[#344039]">
          <Button
            variant="outline"
            onClick={onCancel}
            className="text-xs"
          >
            {cancelLabel}
          </Button>
          <Button
            variant={variant === 'danger' ? 'destructive' : variant === 'warning' ? 'warning' : 'default'}
            onClick={onConfirm}
            className="text-xs"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
