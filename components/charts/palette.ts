// Series roles → CSS variables (validated palette in app/globals.css). Color follows the entity, never rank.
export const SERIES_COLOR = {
  app: "var(--series-app)",
  web: "var(--series-web-agent)",
  web_agent: "var(--series-web-agent)",
  web_other: "var(--series-web-other)",
  neutral: "var(--series-neutral)",
  tier_4: "var(--series-tier-4)",
  tier_5: "var(--series-tier-5)",
  accent: "var(--accent)",
} as const;

export type SeriesColor = keyof typeof SERIES_COLOR;
