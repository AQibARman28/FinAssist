// The one way the app shows money. Taka (and rupees) use their own sign and
// lakh grouping (৳1,23,456), as people write them; other currencies follow the
// browser's locale. Whole amounts drop the ".00" so tiles and lists agree.

const LAKH_CURRENCIES = new Set(["BDT", "INR"]);

export interface MoneyFormatter {
    currency: string;
    format: (value: number) => string;
    // Money going out, with a leading minus: "-৳60".
    formatExpense: (value: number) => string;
}

export function moneyFormatter(currency = "USD", { compact = false }: { compact?: boolean } = {}): MoneyFormatter {
    const locale = LAKH_CURRENCIES.has(currency) ? "en-IN" : undefined;
    const base = { style: "currency", currency, currencyDisplay: "narrowSymbol" } as const;
    const whole = new Intl.NumberFormat(locale, compact
        ? { ...base, notation: "compact", maximumFractionDigits: 1 }
        : { ...base, minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const withPaisa = new Intl.NumberFormat(locale, { ...base, minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const format = (value: number) => {
        const v = Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
        return !compact && !Number.isInteger(v) ? withPaisa.format(v) : whole.format(v);
    };
    return { currency, format, formatExpense: (value) => `-${format(value)}` };
}
