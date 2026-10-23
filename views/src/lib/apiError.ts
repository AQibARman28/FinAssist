import { isAxiosError } from "axios";

// Shared helpers for turning a failed API call into something a user can read.
// The API answers errors as { success:false, message, code?, errors?: {field: msg} }
// (zod failures use message "Invalid request" plus the per-field map).

export interface ApiErrorBody {
    success?: boolean;
    message?: string;
    code?: string;
    errors?: Record<string, string>;
}

// The parsed error body, or undefined when `err` isn't an axios error carrying
// an object body (network failure, timeout, or a plain exception in our code).
export function apiErrorBody(err: unknown): ApiErrorBody | undefined {
    if (!isAxiosError<ApiErrorBody>(err)) return undefined;
    const data = err.response?.data;
    return data && typeof data === "object" ? data : undefined;
}

export function apiErrorStatus(err: unknown): number | undefined {
    return isAxiosError(err) ? err.response?.status : undefined;
}

// Machine-readable reason on some errors, e.g. 409 'ROLLOVER_ALREADY_HANDLED'
// (month already handled) vs 409 'WALLET_BUSY' (transient lock — retry).
export function apiErrorCode(err: unknown): string | undefined {
    return apiErrorBody(err)?.code;
}

export function apiFieldErrors(err: unknown): Record<string, string> {
    return apiErrorBody(err)?.errors ?? {};
}

export function apiErrorMessage(err: unknown, fallback: string): string {
    const data = apiErrorBody(err);
    const fieldMsgs = data?.errors ? Object.values(data.errors).filter(Boolean) : [];
    if (fieldMsgs.length > 0 && (!data?.message || data.message === "Invalid request")) {
        return fieldMsgs.join(", ");
    }
    return data?.message || fallback;
}
