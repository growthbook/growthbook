import {
  FeatureInterface,
  FeaturePrerequisite,
  SavedGroupTargeting,
} from "shared/types/feature";
import { Separator } from "@radix-ui/themes";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";
import ConditionInput from "@/components/Features/ConditionInput";
import PrerequisiteInput, {
  RuleCyclicResult,
} from "@/components/Features/PrerequisiteInput";

export interface TargetingFieldsGroupProps {
  project: string;
  environments: string[];
  // When set, `PrerequisiteInput` will use the feature's project + linked-feature
  // metadata. Pass `feature` from rule modals; leave undefined for experiment-level
  // targeting (where there is no parent feature).
  feature?: FeatureInterface;

  savedGroups: SavedGroupTargeting[];
  setSavedGroups: (v: SavedGroupTargeting[]) => void;

  condition: string;
  setCondition: (v: string) => void;
  // Bumped by the parent to force ConditionInput to re-mount after a fix-up.
  conditionKey: number;

  prerequisites: FeaturePrerequisite[];
  setPrerequisites: (v: FeaturePrerequisite[]) => void;
  setPrerequisiteTargetingSdkIssues: (v: boolean) => void;
  onRuleCyclicChange?: (result: RuleCyclicResult) => void;
}

export default function TargetingFieldsGroup({
  project,
  environments,
  feature,
  savedGroups,
  setSavedGroups,
  condition,
  setCondition,
  conditionKey,
  prerequisites,
  setPrerequisites,
  setPrerequisiteTargetingSdkIssues,
  onRuleCyclicChange,
}: TargetingFieldsGroupProps) {
  return (
    <>
      <SavedGroupTargetingField
        value={savedGroups}
        setValue={setSavedGroups}
        project={project}
      />
      <Separator size="4" my="5" />
      <ConditionInput
        defaultValue={condition}
        onChange={setCondition}
        key={conditionKey}
        project={project}
      />
      <Separator size="4" my="5" />
      <PrerequisiteInput
        value={prerequisites}
        setValue={setPrerequisites}
        feature={feature}
        project={project}
        environments={environments}
        setPrerequisiteTargetingSdkIssues={setPrerequisiteTargetingSdkIssues}
        onRuleCyclicChange={onRuleCyclicChange}
      />
    </>
  );
}
