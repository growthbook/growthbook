import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useForm } from "react-hook-form";
import { MetricInterface } from "back-end/types/metric";
import { useUser } from "@/services/UserContext";
import useApi from "@/hooks/useApi";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Toggle from "@/components/Forms/Toggle";
import { ensureAndReturn } from "@/types/utils";

interface ExperimentNotificationsSettings {
  enabled: boolean;
  guardrails: string[];
  metrics: string[];
}

export default function NotificationsTab({
  experiment,
}: {
  experiment: ExperimentInterfaceStringDates;
}) {
  const {
    settings: { experimentNotificationsEnabled },
  } = useUser();

  const metricsIdsParams = [
    ...(experiment.guardrails || []),
    ...experiment.metrics,
  ]
    .map((v) => `ids=${v}`)
    .join("&");
  const { data } = useApi<{
    metrics: MetricInterface[];
  }>(`/metrics/by-ids?${metricsIdsParams}`);

  const form = useForm<ExperimentNotificationsSettings>({
    defaultValues: {
      enabled: !!(
        experiment.metricsNotificationsEnabled || experimentNotificationsEnabled
      ),
      guardrails: [],
      metrics: [],
    },
  });

  if (!data) return null;

  const { metrics: metricDetails } = data;

  const notificationsEnabled = form.watch("enabled");

  return (
    <div className="pt-2 container-fluid pagecontents">
      <h1>Experiment Notifications</h1>

      <div className="mb-1">
        <p>
          Configure notifications for this experiment. Notifications can be
          enabled or disabled globally in your General Settings and also set
          per-experiment here.
        </p>
      </div>

      <div className="p-1">
        <div className="pl-3 pb-3">
          <Toggle
            id="experiment_notifications_enabled"
            label="Enabled"
            className="mr-3"
            value={notificationsEnabled}
            setValue={(enabled) => form.setValue("enabled", enabled)}
            type="toggle"
          />
          <label htmlFor="experiment_notifications_enabled" className="mr-2">
            Enable Notifications
          </label>
        </div>

        <div className="p-3 form-group flex-column align-items-start border">
          <p>
            Please choose the metrics on which you would like to receive
            notifications for this experiment.
          </p>

          <MultiSelectField
            label="Main Metrics"
            helpText="Receive notifications for selected main metrics. Leave blank to receive all."
            sort={false}
            disabled={!notificationsEnabled}
            value={form.watch("metrics")}
            options={experiment.metrics.map((id) => ({
              label: ensureAndReturn(
                metricDetails.find((m) => m.id === id)?.name
              ),
              value: id,
            }))}
            onChange={(value: string[]) => {
              form.setValue("metrics", value);
            }}
          />

          <MultiSelectField
            label="Guardrails Metrics"
            helpText="Receive notifications for selected guardrail metrics. Leave blank to receive all."
            sort={false}
            disabled={!notificationsEnabled}
            value={form.watch("guardrails")}
            options={(experiment.guardrails || []).map((id) => ({
              label: ensureAndReturn(
                metricDetails.find((m) => m.id === id)?.name
              ),
              value: id,
            }))}
            onChange={(value: string[]) => {
              form.setValue("guardrails", value);
            }}
          />
        </div>
      </div>
    </div>
  );
}
