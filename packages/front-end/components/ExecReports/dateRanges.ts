// Shared preset date-range options for experiment reporting surfaces (the
// Executive Report and the dashboard "Completed Experiments" blocks). Kept in
// one place so the presets can't drift between the two.
export const experimentDateRanges = [
  { label: "30 days", value: "30" },
  { label: "60 days", value: "60" },
  { label: "90 days", value: "90" },
  { label: "180 days", value: "180" },
  { label: "1 year", value: "365" },
  { label: "Custom", value: "custom" },
];
