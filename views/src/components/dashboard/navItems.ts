import { LayoutDashboard, Wallet, CreditCard, Target, Settings, PieChart, TrendingUp, PiggyBank, type LucideIcon } from "lucide-react";

// Shared by the desktop Sidebar and the mobile drawer (MobileNav) so the two
// navigations never drift apart.
export interface NavItem {
    icon: LucideIcon;
    label: string;
    href: string;
}

export const menuItems: NavItem[] = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
    { icon: PieChart,        label: "Analytics", href: "/dashboard/analytics" },
    { icon: Wallet,          label: "Budgets",   href: "/dashboard/budgets" },
    { icon: TrendingUp,      label: "Income",    href: "/dashboard/income" },
    { icon: CreditCard,      label: "Expenses",  href: "/dashboard/expenses" },
    { icon: Target,          label: "Goals",     href: "/dashboard/goals" },
    { icon: PiggyBank,       label: "Savings",   href: "/dashboard/savings" },
    { icon: Settings,        label: "Settings",  href: "/dashboard/settings" },
];
