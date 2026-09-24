// Display name for a connected health source slug (terra provider or
// profiles.active_health_provider), shared by the emails that mention it.

// Health-provider / wearable slug → display label. Mirrors the connect screen.
export const WEARABLE_LABELS: Record<string, string> = {
  "apple-health": "Apple Health",
  "health-connect": "Health Connect",
  "google-fit": "Google Fit",
  "samsung-health": "Samsung Health",
  whoop: "Whoop",
  garmin: "Garmin",
  fitbit: "Fitbit",
  oura: "Oura",
  strava: "Strava",
  polar: "Polar",
  coros: "Coros",
  suunto: "Suunto",
};

export function wearableLabel(slug: string | null): string | null {
  if (!slug) return null;
  return WEARABLE_LABELS[slug.toLowerCase()] ?? slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
