// Series roles → CSS variables (validated palette in app/globals.css). Color follows the entity, never rank.
export const SERIES_COLOR = {
  app: "var(--series-app)",
  web_agent: "var(--series-web-agent)",
  web_other: "var(--series-web-other)",
  neutral: "var(--series-neutral)",
  accent: "var(--accent)",
} as const;

export type SeriesColor = keyof typeof SERIES_COLOR;
