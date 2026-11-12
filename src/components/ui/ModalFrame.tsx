import { useEffect, useRef, type ReactNode } from 'react';
/** Native modal supplies focus containment, Escape handling and background inertness. */
export function ModalFrame({open,onClose,label,children}:{open:boolean;onClose:()=>void;label:string;children:ReactNode}) {
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(open)ref.current?.showModal?.();else ref.current?.close?.();},[open]);
 return <dialog ref={ref} className="modal-frame" aria-label={label} onCancel={onClose}>{children}</dialog>;
}
