import * as chrono from "chrono-node";
import { parseAmount } from "./parseAmount";
import { CATEGORY_SYNONYMS } from "./categorySynonyms";

// Minimal category shape this parser needs. The full Category (CategoryPicker)
// has more fields; we only require id + name to match and return a selection.
export interface CategoryOption {
    _id: string;
    name: string;
}

export type ParsedExpense = {
    amount: number | null;
    amountRaw: string | null;
    category: CategoryOption | null;
    date: Date; // defaults to today
    description: string;
    warnings: string[];
};

// word -> default-category-name (e.g. "uber" -> "transport")
const SYNONYM_TO_CATEGORY: Record<string, string> = (() => {
    const m: Record<string, string> = {};
    for (const [cat, words] of Object.entries(CATEGORY_SYNONYMS)) {
        for (const w of words) m[w] = cat;
    }
    return m;
})();

const HAS_LETTER = /[a-z]/i;
const NUMERIC_DATE = /\b\d{1,4}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/;
const DAY_MS = 86_400_000;

// chrono will happily read a bare "350" as a time-of-day; only treat a result
// as a date if its matched text has a letter (yesterday/last friday/...) or
// looks like a real numeric date (12/05/2026). This stops amounts being eaten.
function looksLikeDate(text: string): boolean {
    return HAS_LETTER.test(text) || NUMERIC_DATE.test(text);
}

export function parseExpenseInput(
    input: string,
    userCategories: CategoryOption[],
): ParsedExpense {
    const warnings: string[] = [];
    const now = new Date();

    const byName = new Map<string, CategoryOption>();
    for (const c of userCategories) byName.set(c.name.toLowerCase(), c);

    // 1. Date first — slice the date phrase out of the working text.
    let date = now;
    let working = input;
    const dateRes = chrono.parse(input, now).find((r) => looksLikeDate(r.text));
    if (dateRes) {
        date = dateRes.start.date();
        working =
            input.slice(0, dateRes.index) +
            " " +
            input.slice(dateRes.index + dateRes.text.length);
    }
    if (date.getTime() - now.getTime() > DAY_MS) {
        warnings.push("Date is more than a day in the future");
    }

    let tokens = working.split(/\s+/).filter(Boolean);

    // 2. Amount — first token parseAmount accepts (handles k-suffix, currency,
    //    and inline expressions like 4*250).
    let amount: number | null = null;
    let amountRaw: string | null = null;
    for (let i = 0; i < tokens.length; i++) {
        const r = parseAmount(tokens[i]);
        if (r.ok) {
            amount = r.value;
            amountRaw = tokens[i];
            tokens.splice(i, 1);
            break;
        }
    }
    if (amount === null) warnings.push("No amount detected");

    // 3. Category — an exact category-NAME token is a label (precedence +
    //    removed from the description); a SYNONYM is a real description word
    //    (kept). Only ever a suggestion: unresolved -> null.
    let category: CategoryOption | null = null;
    const nameMatchIdx = new Set<number>();
    tokens.forEach((t, i) => {
        const cat = byName.get(t.toLowerCase());
        if (cat) {
            nameMatchIdx.add(i);
            if (!category) category = cat;
        }
    });
    if (!category) {
        for (const t of tokens) {
            const target = SYNONYM_TO_CATEGORY[t.toLowerCase()];
            const cat = target ? byName.get(target) : undefined;
            if (cat) {
                category = cat;
                break;
            }
        }
    }
    tokens = tokens.filter((_, i) => !nameMatchIdx.has(i));

    // 4. Description — the leftovers; fall back to the category name.
    let description = tokens.join(" ").replace(/\s+/g, " ").trim();
    if (!description) {
        description = category ? (category as CategoryOption).name : "Expense";
    }

    return { amount, amountRaw, category, date, description, warnings };
}
