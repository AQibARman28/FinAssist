"use client";

import { useState } from "react";
import { Pencil, Trash2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/apiError";

interface RowActionsProps {
    /** Used in aria-labels, e.g. "Edit Groceries" / "Delete Groceries". */
    itemLabel: string;
    onEdit?: () => void;
    /** Performs the delete. Rejecting keeps the row and shows the error. */
    onDelete: () => Promise<unknown>;
    /** Short question shown in the confirm step. */
    confirmText?: string;
    className?: string;
}

// Edit + delete controls for a list row. Always visible (no hover-only
// affordances, so they work on touch screens) and delete is two-step: the
// first tap swaps the buttons for an inline "Delete? [Delete] [Cancel]".
export function RowActions({ itemLabel, onEdit, onDelete, confirmText = "Delete?", className }: RowActionsProps) {
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const confirmDelete = async () => {
        setBusy(true);
        setError(null);
        try {
            await onDelete();
            // The parent normally unmounts the row; reset in case it doesn't.
            setConfirming(false);
        } catch (err) {
            setError(apiErrorMessage(err, "Couldn't delete — try again."));
            setConfirming(false);
        } finally {
            setBusy(false);
        }
    };

    if (confirming) {
        return (
            <div className={cn("flex flex-wrap items-center justify-end gap-1.5", className)} role="group" aria-label={`Confirm delete ${itemLabel}`}>
                <span className="text-xs text-zinc-300 mr-0.5">{confirmText}</span>
                <button
                    type="button"
                    onClick={confirmDelete}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-50 transition-colors"
                >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    Delete
                </button>
                <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    disabled={busy}
                    className="px-3 py-2 text-xs rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-white/5 disabled:opacity-50 transition-colors"
                >
                    Cancel
                </button>
            </div>
        );
    }

    return (
        <div className={cn("flex items-center gap-0.5", className)}>
            {error && <span className="text-[11px] text-red-400 mr-1 max-w-[10rem] truncate" title={error}>{error}</span>}
            {onEdit && (
                <button
                    type="button"
                    onClick={onEdit}
                    aria-label={`Edit ${itemLabel}`}
                    className="p-2.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-white/5 transition-colors"
                >
                    <Pencil className="w-4 h-4" />
                </button>
            )}
            <button
                type="button"
                onClick={() => { setError(null); setConfirming(true); }}
                aria-label={`Delete ${itemLabel}`}
                className="p-2.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
                <Trash2 className="w-4 h-4" />
            </button>
        </div>
    );
}
