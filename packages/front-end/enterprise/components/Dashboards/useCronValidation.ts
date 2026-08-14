import { useState, useEffect } from "react";
import cronstrue from "cronstrue";
import "cronstrue/locales/ru";
import { DashboardUpdateSchedule } from "shared/enterprise";
import { cronLocale, translate } from "@/services/i18n";

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
          locale: cronLocale(),
        })} ${translate("(UTC time)")}`,
      );
    } catch {
      setCronError(true);
    }
  }, [currentUpdateSchedule]);

  return { cronString, cronError };
}
