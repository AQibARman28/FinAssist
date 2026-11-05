import { cn } from "@/lib/utils";

// Placeholder blocks shaped like a dashboard page: a title, a row of stat
// tiles and two panels. Shown while a page's code or first data loads, so the
// layout appears at once and doesn't jump when the numbers arrive.
export function SkeletonBlock({ className }: { className?: string }) {
    return <div aria-hidden className={cn("rounded-2xl bg-zinc-900/60 border border-white/5 animate-pulse", className)} />;
}

export function PageSkeleton({ tiles = 4 }: { tiles?: number }) {
    return (
        <div className="p-4 md:p-6 space-y-5 md:space-y-6 max-w-7xl mx-auto" role="status" aria-label="Loading">
            <div className="space-y-2 mb-2 md:mb-4">
                <SkeletonBlock className="h-7 w-48 rounded-lg" />
                <SkeletonBlock className="h-4 w-64 rounded-lg" />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                {Array.from({ length: tiles }, (_, i) => <SkeletonBlock key={i} className="h-[104px] md:h-[116px]" />)}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
                <SkeletonBlock className="lg:col-span-2 h-72 rounded-3xl" />
                <SkeletonBlock className="h-72 rounded-3xl" />
            </div>
        </div>
    );
}
