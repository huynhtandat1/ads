import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

interface Toast { id: number; msg: string; type: 'success' | 'error' }
const Ctx = createContext<(msg: string, type?: 'success' | 'error') => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id}
            className={`px-4 py-2.5 rounded-lg shadow-lg text-white text-sm font-medium animate-[fadeIn_.2s] ${
              t.type === 'success' ? 'bg-emerald-500' : 'bg-rose-500'}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
