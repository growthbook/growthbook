import { useUser } from "@/services/UserContext";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useForm } from "react-hook-form";

interface ExperimentNotificationsSettings {
  enabled: boolean;
  activationMetric: boolean;
  guardrails: Record<string, boolean>;
  metrics: Record<string, boolean>;
}

export default function NotificationsTab({
  experiment,
}: {
  experiment: ExperimentInterfaceStringDates;
}) {
  const {
    settings: { experimentNotificationsEnabled },
  } = useUser();

  const form = useForm<ExperimentNotificationsSettings>({
    enabled: experimentNotificationsEnabled,
    activationMetric: false,
    guardrails: {},
    metrics: {}
  });

  console.log("f", form.getValues());

  return null;
}
