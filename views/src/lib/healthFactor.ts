// How a health-score factor's row reads, on the dashboard card and on
// Analytics alike: not counted (no data yet), needs attention (its words name
// something to fix), or fine. The server sets `attention` so the icon always
// matches the sentence ("1 of 2 goals out of reach" can average 50); without
// it, a score under the weak line is the one to work on.
export type FactorState = "uncounted" | "attention" | "ok";

const WEAK = 50;

export function factorState(f: { score: number | null; attention?: boolean }): FactorState {
    if (f.score === null) return "uncounted";
    return (f.attention ?? f.score < WEAK) ? "attention" : "ok";
}
