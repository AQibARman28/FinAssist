/**
 * Shared mapping between the backend's category-icon enum and lucide-react
 * components. Single source of truth so the picker, the settings page, the
 * income/expense lists, and anything else can render a category without
 * each one re-importing the same icons.
 *
 * The backend enum (see Backend/models/Category.js) is the canonical list:
 *   cart, car, home, heart, book, gift, briefcase, wallet, star,
 *   utensils, phone, plane, more
 */

import {
    ShoppingCart, Car, Home, Heart, Book, Gift, Briefcase, Wallet,
    Star, Utensils, Phone, Plane, MoreHorizontal,
    type LucideIcon,
} from "lucide-react";

export const CATEGORY_ICONS = {
    cart:      ShoppingCart,
    car:       Car,
    home:      Home,
    heart:     Heart,
    book:      Book,
    gift:      Gift,
    briefcase: Briefcase,
    wallet:    Wallet,
    star:      Star,
    utensils:  Utensils,
    phone:     Phone,
    plane:     Plane,
    more:      MoreHorizontal,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof CATEGORY_ICONS;

export const ICON_NAMES: readonly IconName[] = Object.freeze(
    Object.keys(CATEGORY_ICONS) as IconName[]
);

// Curated set of swatches for the inline create form (the brief asks for
// ~10 — these are the seeded defaults plus a few extras for variety).
export const CATEGORY_COLOR_SWATCHES = Object.freeze([
    "#F97316", // orange
    "#3B82F6", // blue
    "#EF4444", // red
    "#A855F7", // violet
    "#10B981", // emerald
    "#FBBF24", // amber
    "#EC4899", // pink
    "#14B8A6", // teal
    "#8B5CF6", // purple
    "#6B7280", // gray
]);

// Resolve an icon name to its component, falling back to MoreHorizontal so
// a stale value from the DB doesn't crash render.
export function iconFor(name: string | undefined | null): LucideIcon {
    if (!name) return MoreHorizontal;
    return (CATEGORY_ICONS as Record<string, LucideIcon>)[name] ?? MoreHorizontal;
}
