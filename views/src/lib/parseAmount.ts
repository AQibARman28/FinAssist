// Smart amount parser — turns user input ("1.2k", "4*250", "৳350", "12.50+8.99")
// into a positive number. Shared by the expense form and (Phase 2) quick-add.
//
// Security: there is NO eval() / new Function() here. Two independent defenses:
//   1. A character whitelist applied AFTER preprocessing — only digits and the
//      arithmetic operators survive, so no identifier/function name can reach
//      the evaluator (rejects `process.exit()`, `1; alert(1)`, `1+console.log`).
//   2. The evaluator below only knows numbers, + - * /, unary signs and
//      parentheses — there is nothing else for an input to reach.
//
// It replaces mathjs, which put ~170 kB (gzipped) of JavaScript on every
// dashboard page (the quick-add bubble lives in the shared layout) to do
// four-function arithmetic.

export type AmountParseResult =
    | { ok: true; value: number; display: string; isExpression: boolean }
    | { ok: false; reason: "empty" | "invalid" | "negative" | "too_large" };

const MAX_AMOUNT = 1e12;

// ── Arithmetic evaluator ────────────────────────────────────────────────────
//   expr   := term (("+" | "-") term)*
//   term   := unary (("*" | "/") unary | <implicit ×> "(" expr ")")*
//   unary  := ("+" | "-") unary | primary
//   primary:= number | "(" expr ")"
// Implicit multiplication ("2(3)", "(1+2)(3)") matches what mathjs accepted.
const TOKEN = /\s*(\d+(?:\.\d*)?|\.\d+|[+\-*/()])/y;

function tokenize(src: string): string[] {
    const tokens: string[] = [];
    TOKEN.lastIndex = 0;
    while (TOKEN.lastIndex < src.length) {
        const start = TOKEN.lastIndex;
        const m = TOKEN.exec(src);
        if (!m) {
            if (src.slice(start).trim() === "") break;   // trailing whitespace
            throw new Error("unexpected character");
        }
        tokens.push(m[1]);
    }
    return tokens;
}

function evaluate(src: string): number {
    const tokens = tokenize(src);
    let pos = 0;
    const peek = () => tokens[pos];
    const isNumber = (t: string | undefined) => t !== undefined && /^[\d.]/.test(t);

    const primary = (): number => {
        const t = tokens[pos++];
        if (isNumber(t)) return Number(t);
        if (t === "(") {
            const v = expr();
            if (tokens[pos++] !== ")") throw new Error("expected )");
            return v;
        }
        throw new Error("expected a number");
    };
    const unary = (): number => {
        if (peek() === "-") { pos++; return -unary(); }
        if (peek() === "+") { pos++; return unary(); }
        return primary();
    };
    const term = (): number => {
        let v = unary();
        for (;;) {
            const t = peek();
            if (t === "*") { pos++; v *= unary(); }
            else if (t === "/") { pos++; v /= unary(); }
            else if (t === "(") v *= primary();
            else return v;
        }
    };
    const expr = (): number => {
        let v = term();
        for (;;) {
            const t = peek();
            if (t === "+") { pos++; v += term(); }
            else if (t === "-") { pos++; v -= term(); }
            else return v;
        }
    };

    const v = expr();
    if (pos !== tokens.length) throw new Error("unexpected token");
    return v;
}

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
        raw = evaluate(cleaned);
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
