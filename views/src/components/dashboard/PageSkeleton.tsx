import { cn } from "@/lib/utils";

// Placeholder blocks shaped like a dashboard page: the page heading, a
// headline figure and two cards. Shown while a page's code or first data
// loads, so the layout appears at once and doesn't jump when figures arrive.
export function SkeletonBlock({ className }: { className?: string }) {
    return <div aria-hidden className={cn("rounded-2xl bg-white/[0.05] animate-pulse", className)} />;
}

export function PageSkeleton() {
    return (
        <div className="mx-auto max-w-[1280px] px-4 pt-5 md:px-8 md:pt-8 lg:px-10 flex flex-col gap-4 md:gap-6" role="status" aria-label="Loading">
            <div className="space-y-2.5">
                <SkeletonBlock className="h-8 w-44 rounded-lg" />
                <SkeletonBlock className="h-4 w-64 rounded-lg" />
            </div>
            <div className="py-2 md:py-4 space-y-3">
                <SkeletonBlock className="h-3 w-28 rounded" />
                <SkeletonBlock className="h-16 md:h-20 w-64 md:w-80" />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
                <SkeletonBlock className="lg:col-span-8 h-72 rounded-3xl" />
                <SkeletonBlock className="lg:col-span-4 h-72 rounded-3xl" />
            </div>
        </div>
    );
}
