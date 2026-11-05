import { PageSkeleton } from "@/components/dashboard/PageSkeleton";

// Dashboard pages render per request, and Next only prefetches a dynamic route
// up to its nearest loading boundary. This boundary is that prefetch: clicking
// a nav link swaps to this skeleton at once (inside the persistent sidebar)
// instead of waiting on the server before anything changes.
export default function DashboardLoading() {
    return <PageSkeleton />;
}
