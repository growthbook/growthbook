import { useState } from "react";
import { Box } from "@radix-ui/themes";
import {
  LinkedFeatureEnvInputs,
  LinkedFeatureEnvState,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import type { ExperimentRuleEnvironments } from "shared/validators";
import { filterEnvironmentsByFeature } from "shared/util";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import HelperText from "@/ui/HelperText";
import RuleEnvironmentScopeField from "@/components/Features/RuleModal/EnvironmentScopeField";
import { useEnvironments } from "@/services/features";
import LinkedFeatureLabel from "@/components/Experiment/LinkedFeatureLabel";
import {
  sameScope,
  scopeFromStates,
} from "@/components/Experiment/LinkedChanges/EnvironmentStatesGrid";

/** Picks where the experiment's rule applies, from the environments its flag's project allows. */
export default function EditExperimentEnvironmentsModal({
  info,
  stagedScope,
  environmentStates,
  storedAllEnvironments,
  environmentInputs,
  showFlag,
  close,
  apply,
}: {
  info: LinkedFeatureInfo;
  stagedScope: ExperimentRuleEnvironments | null;
  // Where the rule the save writes to runs now, to start from when nothing is staged.
  environmentStates: { env: string; state: LinkedFeatureEnvState }[];
  // That rule's own setting, so a list naming every environment stays a list.
  storedAllEnvironments: boolean | null;
  // The settings the scope lands on, to say where it switches the flag on.
  environmentInputs?: Record<string, LinkedFeatureEnvInputs>;
  showFlag: boolean;
  close: () => void;
  /** Null when the choice is what's stored, which unstages any scope. */
  apply: (scope: ExperimentRuleEnvironments | null) => void;
}) {
  const environments = filterEnvironmentsByFeature(
    useEnvironments(),
    info.feature,
  );
  const stored = scopeFromStates(
    Object.fromEntries(environmentStates.map((e) => [e.env, e.state])),
    environments.map((e) => e.id),
    storedAllEnvironments,
  );
  const scope = stagedScope ?? stored;
  const [allEnvironments, setAllEnvironments] = useState(scope.allEnvironments);
  const [selectedEnvironments, setSelectedEnvironments] = useState(
    scope.environments,
  );
  // Entering an environment switches the flag on there, for all its rules.
  const switchedOn = (
    allEnvironments ? environments.map((e) => e.id) : selectedEnvironments
  ).filter((id) => environmentInputs?.[id]?.flagEnabled === false);

  return (
    <ModalStandard
      trackingEventModalType="edit-experiment-environments"
      trackingEventModalSource="traffic-allocation"
      header="Edit Environments"
      open={true}
      close={close}
      cta="Apply"
      // A rule in no environment serves nothing and drops off this page.
      ctaEnabled={allEnvironments || selectedEnvironments.length > 0}
      submit={() => {
        const next = {
          allEnvironments,
          environments: allEnvironments ? [] : selectedEnvironments,
        };
        apply(sameScope(next, stored) ? null : next);
      }}
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
          {`${new Intl.ListFormat("en-GB", { type: "conjunction" }).format(
            switchedOn,
          )} ${
            switchedOn.length === 1 ? "is" : "are"
          } off for this Feature Flag. Applying turns ${
            switchedOn.length === 1 ? "it on there" : "them on"
          }, for all of its rules.`}
        </HelperText>
      ) : null}
    </ModalStandard>
  );
}
