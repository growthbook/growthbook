import { formatInteger } from "shared/util";

// Footer line for experiment cards: "{units} units - {days} days", with
// whichever parts the event payload recorded.
export function formatExperimentFooter(
  units?: number,
  durationDays?: number,
): string | undefined {
  const text = [
    units !== undefined ? `${formatInteger(units)} units` : undefined,
    durationDays !== undefined
      ? `${durationDays} day${durationDays === 1 ? "" : "s"}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" - ");
  return text || undefined;
}
