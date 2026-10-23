import { createElement } from "react";
import type { LucideProps } from "lucide-react";
import { iconFor } from "@/lib/categoryIcons";

// Renders a category's icon by its backend enum name. `iconFor` returns a
// module-level lucide component, so this is a lookup, not a component created
// during render — createElement keeps that explicit for the React-compiler lint.
export function CategoryIcon({ icon, ...props }: { icon?: string | null } & LucideProps) {
    return createElement(iconFor(icon), props);
}
