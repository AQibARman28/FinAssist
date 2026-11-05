// Lets any screen open the quick-add sheet, which lives in the dashboard
// layout (components/dashboard/QuickAddHost.tsx).
const EVENT = "finassist:open-quick-add";

export function openQuickAdd(): void {
    window.dispatchEvent(new Event(EVENT));
}

export function onOpenQuickAdd(handler: () => void): () => void {
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
}
