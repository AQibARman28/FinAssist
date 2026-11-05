// After a panel the user was in disappears ("Later", "Skip for now"), keyboard
// focus would otherwise drop to <body>. Send it to the page's heading instead,
// which carries tabIndex={-1} for exactly this.
export function focusPageHeading(): void {
    document.querySelector<HTMLElement>("main h1[tabindex]")?.focus();
}
