import type { KnownBlock } from "@slack/types";
import { formatInteger } from "shared/util";
import { getExperimentUrl } from "back-end/src/util/appUrls";
import { type AlertField, buildAlertMessage } from "./alertMessage";
import type { SlackMessage } from "./slack-event-handler-utils";

// The experiment fields every message needs. Payloads from before the owner
// was captured lack the email; the footer then omits it.
export interface ExperimentIdentity {
  id: string;
  name: string;
  ownerEmail?: string;
}

export interface ExperimentRun {
  durationDays?: number;
  units?: number;
}

// ["314 days", "67,970 users"], with whichever parts the event knows.
export const experimentRunDetails = ({
  durationDays,
  units,
}: ExperimentRun): string[] =>
  [
    durationDays !== undefined
      ? `${durationDays} day${durationDays === 1 ? "" : "s"}`
      : undefined,
    units === 0
      ? "No users yet"
      : units !== undefined
        ? `${formatInteger(units)} users`
        : undefined,
  ].filter((part): part is string => part !== undefined);

// Every experiment text message: the shared alert layout with the
// experiment's link, run, and owner filled in.
export function buildExperimentAlertMessage({
  experiment: { id, name, ownerEmail },
  durationDays,
  units,
  ...rest
}: ExperimentRun & {
  experiment: ExperimentIdentity;
  label: string;
  fields?: AlertField[];
  blocks?: KnownBlock[];
}): SlackMessage {
  return buildAlertMessage({
    name,
    url: getExperimentUrl(id),
    ownerEmail,
    details: experimentRunDetails({ durationDays, units }),
    ...rest,
  });
}
