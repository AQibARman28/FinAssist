// Tukey-fence outlier detection for the spending timeline. Computed
// CLIENT-SIDE because "is this bucket unusually high" depends on the visible
// window, not on the whole dataset — the endpoint stays pure.
//
// A bucket is an outlier when its total exceeds the upper fence
// Q3 + 1.5·IQR. Only the UPPER tail matters here (spending spikes).
//
// Guard: with fewer than 5 buckets there isn't enough signal for quartiles to
// mean anything, so nothing is flagged.

function quantile(sortedAsc: number[], p: number): number {
    const pos = (sortedAsc.length - 1) * p;
    const base = Math.floor(pos);
    const rest = pos - base;
    const next = sortedAsc[base + 1];
    return next !== undefined ? sortedAsc[base] + rest * (next - sortedAsc[base]) : sortedAsc[base];
}

export function flagOutliers(totals: number[]): boolean[] {
    if (totals.length < 5) return totals.map(() => false);
    const sorted = [...totals].sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const upperFence = q3 + 1.5 * (q3 - q1);
    return totals.map((t) => t > upperFence);
}
