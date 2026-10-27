import {
  useEffect, useId, useRef, useState, type ReactNode, type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Btn, inputCls } from './ui.js';

interface ConfirmReq {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (v: boolean) => void;
}

interface PromptReq {
  title: string;
  body?: string;
  initial?: string;
  confirmLabel?: string;
  resolve: (v: string | null) => void;
}

let confirmHandler: ((r: Omit<ConfirmReq, 'resolve'>) => Promise<boolean>) | null = null;
let promptHandler: ((r: Omit<PromptReq, 'resolve'>) => Promise<string | null>) | null = null;

export function confirmDialog(req: Omit<ConfirmReq, 'resolve'>): Promise<boolean> {
  if (confirmHandler) return confirmHandler(req);
  return Promise.resolve(window.confirm(`${req.title}\n\n${req.body ?? ''}`));
}

export function promptDialog(req: Omit<PromptReq, 'resolve'>): Promise<string | null> {
  if (promptHandler) return promptHandler(req);
  return Promise.resolve(window.prompt(req.title, req.initial ?? ''));
}

// One shared scroll lock keeps nested/sequential dialogs from restoring the
// page overflow too early.
let openModalCount = 0;
let savedBodyOverflow = '';
let savedBodyPaddingRight = '';

function lockPageScroll(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  if (openModalCount === 0) {
    savedBodyOverflow = document.body.style.overflow;
    savedBodyPaddingRight = document.body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;
  }
  openModalCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    openModalCount = Math.max(0, openModalCount - 1);
    if (openModalCount === 0) {
      document.body.style.overflow = savedBodyOverflow;
      document.body.style.paddingRight = savedBodyPaddingRight;
    }
  };
}

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function focusable(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');
}

export interface ModalProps {
  title: ReactNode;
  description?: ReactNode;
  role?: 'dialog' | 'alertdialog';
  children?: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement>;
  showCloseButton?: boolean;
  closeLabel?: string;
  panelClassName?: string;
  bodyClassName?: string;
  testId?: string;
}

/**
 * Portal-based modal used for every destructive confirmation and shared
 * dialog. Rendering into `document.body` prevents a transformed/overflowing
 * dashboard card from becoming the containing block for `position: fixed`.
 */
export function Modal({
  title,
  description,
  role = 'dialog',
  children,
  footer,
  busy = false,
  onClose,
  initialFocusRef,
  showCloseButton = true,
  closeLabel = 'Close dialog',
  panelClassName = '',
  bodyClassName = '',
  testId,
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  onCloseRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    const releaseScroll = lockPageScroll();
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => {
      const target = initialFocusRef?.current && !initialFocusRef.current.hasAttribute('disabled')
        ? initialFocusRef.current
        : focusable(panelRef.current)[0] ?? panelRef.current;
      target?.focus();
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!busyRef.current) {
          event.preventDefault();
          onCloseRef.current();
        }
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable(panelRef.current);
      if (items.length === 0) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !panelRef.current?.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
      releaseScroll();
      if (previous?.isConnected) previous.focus();
    };
    // The modal is mounted only while open; refs above stay current without
    // rebinding the trap and scroll lock on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={busy || undefined}
        tabIndex={-1}
        data-lq-modal={testId ?? 'dialog'}
        className={`my-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#141830] p-4 text-slate-200 shadow-2xl outline-none sm:max-h-[calc(100dvh-2rem)] sm:p-5 ${panelClassName}`}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-bold sm:text-lg">{title}</h2>
            {description && (
              <div id={descriptionId} className="mt-1 text-sm text-slate-300">{description}</div>
            )}
          </div>
          {showCloseButton && (
            <button
              type="button"
              onClick={() => { if (!busy) onClose(); }}
              aria-label={closeLabel}
              disabled={busy}
              className="rounded-xl p-1.5 text-slate-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <X size={17} />
            </button>
          )}
        </div>
        {children && <div className={`mt-3 ${bodyClassName}`}>{children}</div>}
        {footer && <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function DialogHost() {
  const [confirm, setConfirm] = useState<ConfirmReq | null>(null);
  const [prompt, setPrompt] = useState<PromptReq | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmHandler = (r) => new Promise<boolean>((resolve) => setConfirm({ ...r, resolve }));
    promptHandler = (r) => new Promise<string | null>((resolve) => setPrompt({ ...r, resolve }));
    return () => {
      confirmHandler = null;
      promptHandler = null;
    };
  }, []);

  const close = () => {
    confirm?.resolve(false);
    prompt?.resolve(null);
    setConfirm(null);
    setPrompt(null);
  };

  if (!confirm && !prompt) return null;
  const active = prompt ?? confirm!;
  return (
    <Modal
      role={prompt ? 'dialog' : 'alertdialog'}
      title={active.title}
      description={active.body}
      onClose={close}
      initialFocusRef={prompt ? inputRef : cancelRef}
      testId="shared-dialog"
      footer={(
        <>
          <Btn ref={cancelRef} type="button" onClick={close}>Cancel</Btn>
          <Btn
            variant={confirm?.danger ? 'danger' : 'primary'}
            onClick={() => {
              if (prompt) {
                prompt.resolve(inputRef.current?.value ?? '');
                setPrompt(null);
              } else if (confirm) {
                confirm.resolve(true);
                setConfirm(null);
              }
            }}
          >
            {prompt ? (prompt.confirmLabel ?? 'Save') : (confirm?.confirmLabel ?? 'Confirm')}
          </Btn>
        </>
      )}
    >
      {prompt && (
        <input
          ref={inputRef}
          className={inputCls}
          defaultValue={prompt.initial ?? ''}
          aria-label={prompt.title}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              prompt.resolve((event.target as HTMLInputElement).value);
              setPrompt(null);
            }
          }}
        />
      )}
    </Modal>
  );
}
