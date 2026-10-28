import { useForm } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { MEASUREMENT_ARM_EDITABLE_FIELDS } from "shared/experiments";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getIsExperimentIncludedInIncrementalRefresh } from "@/services/experiments";
import ExperimentMetricsSelector from "@/components/Experiment/ExperimentMetricsSelector";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import HelperText from "@/ui/HelperText";

type FormValues = Pick<
  ExperimentInterfaceStringDates,
  (typeof MEASUREMENT_ARM_EDITABLE_FIELDS)[number]
>;

export default function MeasurementArmMetricsForm({
  experiment,
  cancel,
  mutate,
  source,
}: {
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
  source?: string;
}) {
  const { apiCall } = useAuth();
  const { getDatasourceById } = useDefinitions();
  const datasource = getDatasourceById(experiment.datasource);
  const form = useForm<FormValues>({
    defaultValues: {
      secondaryMetrics: experiment.secondaryMetrics || [],
      guardrailMetrics: experiment.guardrailMetrics || [],
    },
  });

  return (
    <ModalStandard
      trackingEventModalType="measurement-arm-metrics-form"
      trackingEventModalSource={source}
      header="Edit Metrics"
      size="lg"
      open={true}
      close={cancel}
      submit={form.handleSubmit(async (value) => {
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify(value),
        });
        mutate();
      })}
    >
      <HelperText status="info" mb="4">
        The goal metric follows the Contextual Bandit. Only secondary and
        guardrail metrics can be changed here.
      </HelperText>
      <ExperimentMetricsSelector
        noLegacyMetrics={getIsExperimentIncludedInIncrementalRefresh(
          datasource ?? undefined,
          experiment.id,
          experiment.type,
        )}
        datasource={experiment.datasource}
        exposureQueryId={experiment.exposureQueryId}
        exposureQueryIdentifierType={experiment.exposureQueryIdentifierType}
        project={experiment.project}
        goalMetrics={experiment.goalMetrics || []}
        secondaryMetrics={form.watch("secondaryMetrics")}
        guardrailMetrics={form.watch("guardrailMetrics")}
        goalDisabled={true}
        setSecondaryMetrics={(secondaryMetrics) =>
          form.setValue("secondaryMetrics", secondaryMetrics)
        }
        setGuardrailMetrics={(guardrailMetrics) =>
          form.setValue("guardrailMetrics", guardrailMetrics)
        }
        experimentId={experiment.id}
        experimentType={experiment.type}
      />
    </ModalStandard>
  );
}
