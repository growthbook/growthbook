import { useState, useEffect } from "react";
import cronstrue from "cronstrue";
import { DashboardUpdateSchedule } from "shared/enterprise";

export function useCronValidation(
  currentUpdateSchedule: DashboardUpdateSchedule | undefined,
): { cronString: string; cronError: boolean } {
  const [cronString, setCronString] = useState("");
  const [cronError, setCronError] = useState(false);

  useEffect(() => {
    setCronError(false);
    setCronString("");
    if (currentUpdateSchedule?.type !== "cron") return;
    try {
      setCronString(
        `${cronstrue.toString(currentUpdateSchedule.cron, {
          throwExceptionOnParseError: true,
          verbose: true,
        })} (UTC time)`,
      );
    } catch {
      setCronError(true);
    }
  }, [currentUpdateSchedule]);

  return { cronString, cronError };
}
