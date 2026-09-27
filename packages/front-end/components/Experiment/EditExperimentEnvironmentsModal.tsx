import { useState } from "react";
import { Box } from "@radix-ui/themes";
import {
  LinkedFeatureEnvState,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import type { ExperimentRuleEnvironments } from "shared/validators";
import { filterEnvironmentsByFeature } from "shared/util";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import RuleEnvironmentScopeField from "@/components/Features/RuleModal/EnvironmentScopeField";
import { useEnvironments } from "@/services/features";
import LinkedFeatureLabel from "@/components/Experiment/LinkedFeatureLabel";
import { scopeFromStates } from "@/components/Experiment/LinkedChanges/EnvironmentStatesGrid";

/**
 * Picks where the experiment's rule applies; the page's Save stages it on the
 * flag's draft. The flag's project decides which environments it can run in.
 */
export default function EditExperimentEnvironmentsModal({
  info,
  stagedScope,
  environmentStates,
  showFlag,
  close,
  apply,
}: {
  info: LinkedFeatureInfo;
  stagedScope: ExperimentRuleEnvironments | null;
  // Where the rule runs now, to start from when nothing is staged.
  environmentStates: { env: string; state: LinkedFeatureEnvState }[];
  showFlag: boolean;
  close: () => void;
  apply: (scope: ExperimentRuleEnvironments) => void;
}) {
  const environments = filterEnvironmentsByFeature(
    useEnvironments(),
    info.feature,
  );
  const scope =
    stagedScope ??
    scopeFromStates(
      Object.fromEntries(environmentStates.map((e) => [e.env, e.state])),
      environments.map((e) => e.id),
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
