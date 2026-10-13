import { useEffect, useRef, useState } from 'react';
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

export function DialogHost() {
  const [confirm, setConfirm] = useState<ConfirmReq | null>(null);
  const [prompt, setPrompt] = useState<PromptReq | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    confirmHandler = (r) => new Promise<boolean>((resolve) => setConfirm({ ...r, resolve }));
    promptHandler = (r) => new Promise<string | null>((resolve) => setPrompt({ ...r, resolve }));
    return () => {
      confirmHandler = null;
      promptHandler = null;
    };
  }, []);

  useEffect(() => {
    if (prompt) inputRef.current?.focus();
  }, [prompt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (prompt) {
          prompt.resolve(null);
          setPrompt(null);
        } else if (confirm) {
          confirm.resolve(false);
          setConfirm(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prompt, confirm]);

  if (!confirm && !prompt) return null;
  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={() => {
        confirm?.resolve(false);
        prompt?.resolve(null);
        setConfirm(null);
        setPrompt(null);
      }}
      role="presentation"
    >
      <div
        role={prompt ? 'dialog' : 'alertdialog'}
        aria-modal="true"
        aria-label={prompt ? prompt.title : confirm?.title}
        className="glass w-full max-w-sm rounded-2xl bg-[#141830] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-bold">{prompt ? prompt.title : confirm?.title}</h2>
        {(prompt?.body || confirm?.body) && (
          <p className="mt-1 text-sm text-slate-400">{prompt ? prompt.body : confirm?.body}</p>
        )}
        {prompt && (
          <input
            ref={inputRef}
            className={`${inputCls} mt-3`}
            defaultValue={prompt.initial ?? ''}
            aria-label={prompt.title}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                prompt.resolve((e.target as HTMLInputElement).value);
                setPrompt(null);
              }
            }}
          />
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Btn
            onClick={() => {
              confirm?.resolve(false);
              prompt?.resolve(null);
              setConfirm(null);
              setPrompt(null);
            }}
          >
            Cancel
          </Btn>
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
        </div>
      </div>
    </div>
  );
}
