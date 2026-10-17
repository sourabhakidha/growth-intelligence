// Navigation sections (order = sidebar order). Icons are resolved client-side by key.
export const NAV = [
  { href: "/", label: "Overview", icon: "overview" },
  { href: "/meta-ads", label: "Meta Ads", icon: "meta" },
  { href: "/creatives", label: "Creative Intelligence", icon: "creative" },
  { href: "/funnel", label: "App Funnel", icon: "funnel" },
  { href: "/cart-recovery", label: "Abandoned Cart Recovery", icon: "cart" },
  { href: "/new-sales", label: "New Sales", icon: "sales" },
  { href: "/regions", label: "Regional Analysis", icon: "region" },
] as const;

export type NavIcon = (typeof NAV)[number]["icon"];
