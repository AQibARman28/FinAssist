"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Keyboard behaviour every modal panel (sheet, drawer) needs: focus moves in
// when it opens, Tab stays inside, Esc closes it, and focus goes back to
// whatever opened it.
export function useDialogFocus(
    open: boolean,
    panel: RefObject<HTMLElement | null>,
    onClose: () => void,
    initialFocus?: RefObject<HTMLElement | null>,
) {
    // Latest onClose without re-running the effect (which would refocus).
    const close = useRef(onClose);
    useEffect(() => { close.current = onClose; }, [onClose]);

    useEffect(() => {
        if (!open) return;
        const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const items = () => [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
        (initialFocus?.current ?? items()[0])?.focus();

        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") { e.preventDefault(); close.current(); return; }
            if (e.key !== "Tab") return;
            const list = items();
            if (list.length === 0) { e.preventDefault(); return; }
            const first = list[0];
            const last = list[list.length - 1];
            const active = document.activeElement;
            if (!panel.current?.contains(active)) { e.preventDefault(); first.focus(); }
            else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
        };
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("keydown", onKey);
            if (returnTo?.isConnected) returnTo.focus();
        };
    }, [open, panel, initialFocus]);
}
