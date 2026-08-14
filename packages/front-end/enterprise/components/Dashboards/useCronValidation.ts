import { useState, useEffect } from "react";
import cronstrue from "cronstrue";
import "cronstrue/locales/ru";
import { DashboardUpdateSchedule } from "shared/enterprise";
import { cronLocale, translate, useLocale } from "@/services/i18n";

export function useCronValidation(
  currentUpdateSchedule: DashboardUpdateSchedule | undefined,
): { cronString: string; cronError: boolean } {
  const { locale } = useLocale();
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
  }, [currentUpdateSchedule, locale]);

  return { cronString, cronError };
}
