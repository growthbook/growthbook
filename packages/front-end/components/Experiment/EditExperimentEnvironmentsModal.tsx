import { useState } from "react";
import { Box } from "@radix-ui/themes";
import {
  LinkedFeatureEnvInputs,
  LinkedFeatureEnvState,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import type { ExperimentRuleEnvironments } from "shared/validators";
import { filterEnvironmentsByFeature, isManagedFeature } from "shared/util";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import HelperText from "@/ui/HelperText";
import RuleEnvironmentScopeField from "@/components/Features/RuleModal/EnvironmentScopeField";
import { useEnvironments } from "@/services/features";
import LinkedFeatureLabel from "@/components/Experiment/LinkedFeatureLabel";
import { scopeFromStates } from "@/components/Experiment/LinkedChanges/EnvironmentStatesGrid";
import { joinAnd } from "@/services/utils";

/**
 * Picks where the experiment's rule applies; the page's Save stages it on the
 * flag's draft. The flag's project decides which environments it can run in.
 */
export default function EditExperimentEnvironmentsModal({
  info,
  stagedScope,
  environmentStates,
  environmentInputs,
  showFlag,
  close,
  apply,
}: {
  info: LinkedFeatureInfo;
  stagedScope: ExperimentRuleEnvironments | null;
  // Where the rule runs now, to start from when nothing is staged.
  environmentStates: { env: string; state: LinkedFeatureEnvState }[];
  // The settings the scope lands on, to say where it switches the flag on.
  environmentInputs?: Record<string, LinkedFeatureEnvInputs>;
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
  // Entering an environment switches the flag on there, for all its rules.
  const switchedOn = (
    allEnvironments ? environments.map((e) => e.id) : selectedEnvironments
  ).filter((id) => environmentInputs?.[id]?.flagEnabled === false);
  const managed = isManagedFeature(info.feature);

  return (
    <ModalStandard
      trackingEventModalType="edit-experiment-environments"
      trackingEventModalSource="traffic-allocation"
      header="Edit Environments"
      open={true}
      close={close}
      // No environment is a valid choice; the field warns what it means.
      cta="Apply"
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
      {switchedOn.length ? (
        <HelperText status="warning" size="sm" mt="2">
          {`${joinAnd(switchedOn)} ${
            switchedOn.length === 1 ? "is" : "are"
          } off for this Feature Flag. Applying turns ${
            switchedOn.length === 1 ? "it on there" : "them on"
          }${managed ? "" : ", for all of its rules"}.`}
        </HelperText>
      ) : null}
    </ModalStandard>
  );
}
