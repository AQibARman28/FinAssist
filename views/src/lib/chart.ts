// Shared geometry for the Timeline charts (RunwayChart, ColumnChart).

// A bar with 4px rounded top corners on a square baseline.
export function barPath(x: number, yTop: number, w: number, yBase: number, r = 4): string {
    const h = yBase - yTop;
    if (h <= 0) return "";
    r = Math.min(r, h, w / 2);
    return `M${x} ${yBase}V${yTop + r}Q${x} ${yTop} ${x + r} ${yTop}H${x + w - r}Q${x + w} ${yTop} ${x + w} ${yTop + r}V${yBase}Z`;
}

const NICE = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

// The smallest round number at or above `v` (1.2k, 2.5k, 40k...), so the
// scale's top line reads cleanly. Never below `floor`.
export function niceMax(v: number, floor = 1): number {
    const target = Math.max(v, floor);
    const mag = 10 ** Math.floor(Math.log10(target));
    return (NICE.find((s) => s * mag >= target) ?? 10) * mag;
}

// Axis numbers: compact (1.2K, 40K) so the left gutter stays narrow. Two
// decimals so a half-step of a 2.5K scale reads 1.25K, not 1.3K.
export const axisNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });
