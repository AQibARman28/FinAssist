import { create, all, type MathJsInstance } from "mathjs";

// Smart amount parser — turns user input ("1.2k", "4*250", "৳350", "12.50+8.99")
// into a positive number. Shared by the expense form and (Phase 2) quick-add.
//
// Security: there is NO eval() / new Function() here. Two independent defenses:
//   1. A character whitelist applied AFTER preprocessing — only digits and the
//      arithmetic operators survive, so no identifier/function name can reach
//      the evaluator (rejects `process.exit()`, `1; alert(1)`, `1+console.log`).
//   2. A mathjs instance with import/parse/evaluate/etc. disabled, per the
//      "limitedEvaluate" pattern in the mathjs docs (belt-and-suspenders).

export type AmountParseResult =
    | { ok: true; value: number; display: string; isExpression: boolean }
    | { ok: false; reason: "empty" | "invalid" | "negative" | "too_large" };

const MAX_AMOUNT = 1e12;

// ── Locked-down mathjs instance ─────────────────────────────────────────────
const math: MathJsInstance = create(all, {});
// Capture the real evaluate BEFORE the override below — overriding the
// `evaluate` import replaces math.evaluate itself, so calling it afterwards
// would hit the disabled stub. This is the mathjs-docs limitedEvaluate pattern.
const limitedEvaluate = math.evaluate;
const _disabled = () => {
    throw new Error("disabled");
};
math.import(
    {
        import: _disabled,
        createUnit: _disabled,
        reviver: _disabled,
        evaluate: _disabled,
        parse: _disabled,
        simplify: _disabled,
        derivative: _disabled,
    },
    { override: true },
);

// Currency symbols / ISO-ish tokens we strip from anywhere in the input.
const CURRENCY = /[৳$€£₹]|tk|bdt|usd|eur|gbp|inr|rs(?=\s|\d|$)/g;
// A number immediately followed by k/K → ×1000 (1.2k → 1.2*1000, 2k+500 → 2*1000+500).
const K_SUFFIX = /(\d+(?:\.\d+)?)k/g;
// After preprocessing, ONLY these characters may remain.
const ALLOWED = /^[\d+\-*/().\s]+$/;
// Used to decide isExpression (any arithmetic operator / paren present).
const HAS_OPERATOR = /[+\-*/()]/;

export function parseAmount(input: string): AmountParseResult {
    if (typeof input !== "string") return { ok: false, reason: "empty" };

    const trimmed = input.trim();
    if (trimmed === "") return { ok: false, reason: "empty" };

    // Preprocess: lowercase → strip currency → expand k-suffix.
    const cleaned = trimmed
        .toLowerCase()
        .replace(CURRENCY, "")
        .replace(K_SUFFIX, "$1*1000")
        .trim();

    if (cleaned === "") return { ok: false, reason: "empty" };
    if (!ALLOWED.test(cleaned)) return { ok: false, reason: "invalid" };

    const isExpression = HAS_OPERATOR.test(cleaned);

    let raw: unknown;
    try {
        raw = limitedEvaluate(cleaned);
    } catch {
        return { ok: false, reason: "invalid" };
    }

    if (typeof raw !== "number" || !Number.isFinite(raw)) {
        return { ok: false, reason: "invalid" };
    }

    const value = Math.round(raw * 100) / 100;

    if (value < 0) return { ok: false, reason: "negative" };
    if (value === 0) return { ok: false, reason: "invalid" };
    if (value > MAX_AMOUNT) return { ok: false, reason: "too_large" };

    return {
        ok: true,
        value,
        display: value.toLocaleString(undefined, { maximumFractionDigits: 2 }),
        isExpression,
    };
}
