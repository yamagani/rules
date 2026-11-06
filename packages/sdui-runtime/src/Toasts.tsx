import { useCallback, useState } from 'react';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

let nextId = 1;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Tone = 'info') => {
    const id = nextId++;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'danger' ? 8000 : 4000);
  }, []);
  return { toasts, push };
}

export function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div role="status" aria-live="polite" style={{ position: 'fixed', right: 16, bottom: 16, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 60, maxWidth: 'calc(100vw - 32px)' }}>
      {toasts.map((t) => (
        <div key={t.id} className="rr-card" data-testid="toast" style={{ borderLeft: `4px solid var(--rr-${t.tone === 'neutral' ? 'border' : t.tone})`, padding: '8px 12px' }}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
