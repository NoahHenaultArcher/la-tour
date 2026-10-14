import { useNotifications } from '../stores/notifications.ts';

export function Notifications() {
  const items = useNotifications((s) => s.items);
  const dismiss = useNotifications((s) => s.dismiss);
  return (
    <div className="notifications" role="status" aria-live="polite">
      {items.map((n) => (
        <button
          key={n.id}
          type="button"
          className={`notification ${n.kind}`}
          onClick={() => dismiss(n.id)}
        >
          {n.text}
          {n.count > 1 && <strong className="notification-count"> ×{n.count}</strong>}
        </button>
      ))}
    </div>
  );
}
