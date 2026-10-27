/**
 * The app's destinations, in order. The phone tab bar and the desktop sidebar both read this list,
 * so the two layouts always offer the same places. Plan covers two pages, switched at the top of each.
 */
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; also?: string[] };

export const NAV: NavItem[] = [
  { href: "/home", label: "Home", icon: "home" },
  { href: "/activity", label: "Activity", icon: "activity" },
  { href: "/budgets", label: "Plan", icon: "plan", also: ["/wealth"] },
  { href: "/insights", label: "Insights", icon: "insights" },
];

/** The two pages inside Plan. */
export const PLAN_PAGES = [
  { href: "/budgets", label: "Budgets" },
  { href: "/wealth", label: "Goals & net worth" },
];

export const ICONS = {
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  activity: "M4 6h16M4 12h16M4 18h10",
  plan: "M12 3a9 9 0 1 0 9 9h-9zM15 3.5A9 9 0 0 1 20.5 9H15z",
  insights: "M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3zM9.5 20h5",
  ask: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z",
} as const;

const under = (path: string, href: string) => path === href || path.startsWith(href + "/");

export const isActive = (path: string, item: NavItem) => [item.href, ...(item.also ?? [])].some((h) => under(path, h));
