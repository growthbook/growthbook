import { useState } from "react";
import { Box } from "@radix-ui/themes";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import type { ExperimentRuleEnvironments } from "shared/validators";
import { filterEnvironmentsByExperiment } from "shared/util";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import RuleEnvironmentScopeField from "@/components/Features/RuleModal/EnvironmentScopeField";
import { useEnvironments } from "@/services/features";
import LinkedFeatureLabel from "@/components/Experiment/LinkedFeatureLabel";

/** Picks where the experiment's rule applies; the page's Save stages it on the flag's draft. */
export default function EditExperimentEnvironmentsModal({
  experiment,
  info,
  scope,
  showFlag,
  close,
  apply,
}: {
  experiment: ExperimentInterfaceStringDates;
  info: LinkedFeatureInfo;
  // What the rule covers now, staged or stored.
  scope: ExperimentRuleEnvironments;
  showFlag: boolean;
  close: () => void;
  apply: (scope: ExperimentRuleEnvironments) => void;
}) {
  const environments = filterEnvironmentsByExperiment(
    useEnvironments(),
    experiment,
  );
  const [allEnvironments, setAllEnvironments] = useState(scope.allEnvironments);
  const [selectedEnvironments, setSelectedEnvironments] = useState(
    scope.environments,
  );

  return (
    <ModalStandard
      trackingEventModalType="edit-experiment-environments"
      trackingEventModalSource="traffic-allocation"
      header="Edit Environments"
      open={true}
      close={close}
      cta="Apply"
      ctaEnabled={allEnvironments || selectedEnvironments.length > 0}
      submit={() =>
        apply({
          allEnvironments,
          environments: allEnvironments ? [] : selectedEnvironments,
        })
      }
    >
      {showFlag ? (
        <Box mb="4">
          <LinkedFeatureLabel featureId={info.feature.id} />
        </Box>
      ) : null}
      <RuleEnvironmentScopeField
        environments={environments}
        allEnvironments={allEnvironments}
        setAllEnvironments={setAllEnvironments}
        selectedEnvironments={selectedEnvironments}
        setSelectedEnvironments={setSelectedEnvironments}
        label="Environments"
      />
    </ModalStandard>
  );
}
