# Dashboard Implementation Plan

## Components to Build
1.  **Sidebar (`components/dashboard/Sidebar.tsx`)**:
    -   Fixed left navigation.
    -   Collapsible on mobile (responsive).
    -   Links: Home, Budgets, Expenses, Goals, Settings.
2.  **StatCard (`components/dashboard/StatCard.tsx`)**:
    -   Props: Title, Value, Trend (%), Icon.
    -   Glassmorphism style.
3.  **SpendingChart (`components/dashboard/SpendingChart.tsx`)**:
    -   Recharts `AreaChart`.
    -   Purple gradient fill.
4.  **Dashboard Page (`app/dashboard/page.tsx`)**:
    -   Bento grid layout using CSS Grid (`grid-cols-1 md:grid-cols-3`).
    -   Assembles all components.

## Data Integration
For now, we will use **mock data** in the components to ensure the UI looks perfect. Real API integration (Axios) will be the next logical step after the UI is signed off.
