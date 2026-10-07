// PROTOTYPE ONLY — DROP BEFORE MERGING.
//
// The Event Logs page and its sidebar entry are behind the `event-logs`
// feature, which isn't in GrowthBook's dev SDK payload, so a development build
// renders a 404 for everyone. This forces it on in development builds only
// (`next dev`); production builds, including PR previews, still follow the
// flag.
//
// To remove: delete this file and put `!!gb?.isOn("event-logs")` back at its
// two call sites (pages/event-logs/index.tsx, components/Layout/sidebarNav.ts).
export function isEventLogsOn(flagOn: boolean): boolean {
  return flagOn || process.env.NODE_ENV === "development";
}
