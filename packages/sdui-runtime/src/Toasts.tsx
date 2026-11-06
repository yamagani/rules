import { useSyncExternalStore } from 'react';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

/**
 * Module-level toast store: toasts survive the screen remount that follows an action
 * which navigates (e.g. "Saved as draft v6" → open v6).
 */
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function pushToast(message: string, tone: Tone = 'info'): void {
  const id = nextId++;
  toasts = [...toasts, { id, message, tone }];
  emit();
  setTimeout(
    () => {
      toasts = toasts.filter((t) => t.id !== id);
      emit();
    },
    tone === 'danger' ? 8000 : 5000,
  );
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useToasts() {
  const list = useSyncExternalStore(subscribe, () => toasts, () => toasts);
  return { toasts: list, push: pushToast };
}

export function ToastStack({ toasts: list }: { toasts: Toast[] }) {
  return (
    <div role="status" aria-live="polite" style={{ position: 'fixed', right: 16, bottom: 16, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 60, maxWidth: 'calc(100vw - 32px)' }}>
      {list.map((t) => (
        <div key={t.id} className="rr-card" data-testid="toast" style={{ borderLeft: `4px solid var(--rr-${t.tone === 'neutral' ? 'border' : t.tone})`, padding: '8px 12px' }}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
