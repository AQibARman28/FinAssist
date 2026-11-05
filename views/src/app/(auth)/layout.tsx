import { ShieldCheck } from "lucide-react";

// The sign-in screens (DESIGN.md › Timeline): Ground, a form column and, from
// 1024px, a graphite showcase panel holding the one titanium plate. The plate
// is static lettering, never figures: no account is open yet. Below 1024px
// the plate gives way to the FA chip and the name above the form.

// The pay period as a ruler of days, engraved: the days gone, today a little
// taller, the days ahead faint. An illustration, not data.
const DAYS = 30;
const TODAY = 11;
function DayRuler() {
    return (
        <svg aria-hidden viewBox="0 0 300 26" preserveAspectRatio="none" className="block h-5 w-full">
            {Array.from({ length: DAYS }, (_, i) => {
                const x = 4 + (i * 292) / (DAYS - 1);
                const today = i === TODAY;
                return (
                    <line
                        key={i}
                        x1={x} x2={x}
                        y1={today ? 1 : i < TODAY ? 9 : 15} y2={25}
                        stroke={today ? "rgb(255 255 255 / 0.9)" : i < TODAY ? "rgb(255 255 255 / 0.5)" : "rgb(255 255 255 / 0.2)"}
                        strokeWidth={today ? 1.6 : 1}
                        vectorEffect="non-scaling-stroke"
                    />
                );
            })}
        </svg>
    );
}

function Plate() {
    return (
        <div
            aria-hidden
            className="metal-card relative grid grid-rows-[auto_1fr_auto] aspect-[1.586] w-full rounded-[22px] p-[clamp(18px,5%,26px)] overflow-hidden text-[#e8e8eb]"
        >
            <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium tracking-[0.32em] [font-stretch:125%] text-[#b9b9be]">FINASSIST</span>
                <span className="metal-chip grid place-items-center w-[34px] h-[26px] rounded-md text-[10px] font-semibold tracking-[0.1em] [font-stretch:125%]">FA</span>
            </div>

            <p className="self-center text-[clamp(1.5rem,2.3vw,2rem)] font-light [font-stretch:118%] leading-[1.15] tracking-[-0.01em] text-[#ededf0] [text-shadow:0_-1px_0_rgb(0_0_0/0.6),0_1px_0_rgb(255_255_255/0.1)]">
                Your pay period,<br />day by day
            </p>

            <div>
                <DayRuler />
                <div className="mt-2 flex justify-between text-[10.5px] font-medium tracking-[0.16em] [font-stretch:118%] uppercase text-[#b3b3b8]">
                    <span>Day 1</span>
                    <span>Next income</span>
                </div>
            </div>
        </div>
    );
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-dvh bg-zinc-950 text-zinc-200 lg:grid lg:grid-cols-2">
            <main
                id="main"
                className="flex min-h-dvh flex-col justify-center"
                style={{
                    paddingTop: "calc(2.5rem + env(safe-area-inset-top))",
                    paddingBottom: "calc(2.5rem + env(safe-area-inset-bottom))",
                    paddingLeft: "max(1rem, env(safe-area-inset-left))",
                    paddingRight: "max(1rem, env(safe-area-inset-right))",
                }}
            >
                <div className="mx-auto w-full max-w-[400px]">
                    {/* Phones and tablets: the monogram stands in for the plate. */}
                    <div className="lg:hidden mb-10 flex items-center gap-3">
                        <span aria-hidden className="metal-chip grid place-items-center w-11 h-11 rounded-[14px] text-[11px] font-semibold tracking-[0.12em] pl-[0.12em] [font-stretch:125%]">FA</span>
                        <span className="text-[12px] font-medium tracking-[0.32em] [font-stretch:125%] uppercase text-zinc-200">FinAssist</span>
                    </div>
                    {children}
                </div>
            </main>

            <aside aria-label="About FinAssist" className="hidden lg:block sticky top-0 h-dvh p-4 pl-0">
                <div className="grid h-full place-items-center rounded-3xl bg-graphite p-10 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] overflow-hidden">
                    <div className="w-full max-w-[460px]">
                        <Plate />
                        <p className="mt-10 max-w-[34ch] text-[16px] leading-relaxed text-zinc-300">
                            See what&apos;s safe to spend each day until your next income, and where the rest of the month went.
                        </p>
                        {/* StateNote's markup: this layout is a server component, and an
                            icon component can't be handed across to a client one. */}
                        <span className="mt-4 flex items-center gap-1.5 text-[12.5px] text-zinc-300">
                            <ShieldCheck aria-hidden className="w-[15px] h-[15px] shrink-0 text-emerald-400" />
                            Encrypted · signed
                        </span>
                    </div>
                </div>
            </aside>
        </div>
    );
}
