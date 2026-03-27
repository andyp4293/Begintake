'use client';

import { useState, useCallback, createContext, useContext, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(async () => false);

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ ...options, resolve });
    });
  }, []);

  const handleConfirm = () => {
    state?.resolve(true);
    setState(null);
  };

  const handleCancel = () => {
    state?.resolve(false);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}

      {state && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleCancel} />

          {/* Dialog */}
          <div className="relative bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3 mb-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                state.destructive ? 'bg-red-500/10' : 'bg-zinc-800'
              }`}>
                <AlertTriangle className={`w-5 h-5 ${state.destructive ? 'text-red-400' : 'text-zinc-400'}`} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">{state.title || 'Confirm'}</h3>
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">{state.message}</p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-xs text-zinc-400 hover:text-white bg-zinc-800 border border-zinc-700 rounded-lg transition-colors"
              >
                {state.cancelLabel || 'Cancel'}
              </button>
              <button
                onClick={handleConfirm}
                autoFocus
                className={`px-4 py-2 text-xs font-medium rounded-lg transition-colors ${
                  state.destructive
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'bg-white text-black hover:bg-zinc-200'
                }`}
              >
                {state.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
