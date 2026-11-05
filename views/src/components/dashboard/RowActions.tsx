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
                <span className="text-[13px] text-zinc-300 mr-0.5">{confirmText}</span>
                <button
                    type="button"
                    onClick={confirmDelete}
                    disabled={busy}
                    className="btn-danger px-3 text-[13px]"
                >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Trash2 className="w-3.5 h-3.5" aria-hidden />}
                    Delete
                </button>
                <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    disabled={busy}
                    className="btn-quiet text-[13px]"
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
                    className="btn-icon"
                >
                    <Pencil className="w-4 h-4" aria-hidden />
                </button>
            )}
            <button
                type="button"
                onClick={() => { setError(null); setConfirming(true); }}
                aria-label={`Delete ${itemLabel}`}
                className="btn-icon hover:text-red-300 hover:bg-red-500/10"
            >
                <Trash2 className="w-4 h-4" aria-hidden />
            </button>
        </div>
    );
}
