import { useState } from "react";
import { ApiContextualBanditInterface } from "shared/validators";
import { useAuth } from "@/services/auth";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import ExperimentMetricsSelector from "@/components/Experiment/ExperimentMetricsSelector";

/** CB-native metrics editor. Reuses the generic ExperimentMetricsSelector and PUTs to the CB endpoint. */
export default function ContextualBanditMetricsModal({
  cb,
  mutate,
  close,
}: {
  cb: ApiContextualBanditInterface;
  mutate: () => void;
  close: () => void;
}) {
  const { apiCall } = useAuth();
  const [goalMetrics, setGoalMetrics] = useState<string[]>(cb.goalMetrics);
  const [secondaryMetrics, setSecondaryMetrics] = useState<string[]>(
    cb.secondaryMetrics,
  );
  const [guardrailMetrics, setGuardrailMetrics] = useState<string[]>(
    cb.guardrailMetrics,
  );

  return (
    <ModalStandard
      open
      trackingEventModalType="cb-edit-metrics"
      header="Edit Metrics"
      close={close}
      cta="Save"
      submit={async () => {
        await apiCall(`/api/v1/contextual-bandits/${cb.id}`, {
          method: "PUT",
          body: JSON.stringify({
            goalMetrics,
            secondaryMetrics,
            guardrailMetrics,
          }),
        });
        mutate();
      }}
    >
      <ExperimentMetricsSelector
        datasource={cb.datasource}
        exposureQueryId={cb.exposureQueryId}
        project={cb.project}
        goalMetrics={goalMetrics}
        secondaryMetrics={secondaryMetrics}
        guardrailMetrics={guardrailMetrics}
        setGoalMetrics={setGoalMetrics}
        setSecondaryMetrics={setSecondaryMetrics}
        setGuardrailMetrics={setGuardrailMetrics}
        forceSingleGoalMetric
        goalMetricsDescription="The single decision metric the bandit optimizes toward."
      />
    </ModalStandard>
  );
}
