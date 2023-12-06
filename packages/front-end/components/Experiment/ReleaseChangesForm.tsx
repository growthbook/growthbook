import { UseFormReturn } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  ExperimentTargetingData,
} from "back-end/types/experiment";
import React, {useEffect, useMemo, useState} from "react";
import useOrgSettings from "@/hooks/useOrgSettings";
import SelectField from "../Forms/SelectField";
import Toggle from "../Forms/Toggle";
import Tooltip from "../Tooltip/Tooltip";
import { DocLink } from "../DocLink";
import { NewBucketingSDKList } from "./HashVersionSelector";
import {TbTargetArrow} from "react-icons/tb";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import {FaQuestionCircle} from "react-icons/fa";
import {useUser} from "@/services/UserContext";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  form: UseFormReturn<ExperimentTargetingData>;
  // | ExperimentPhaseStringDates & { reseed: boolean, blockedVariations: number[], minBucketVersion: number }
}

function getRecommendedRolloutData({
  experiment,
  data,
  stickyBucketing,
}: {
  experiment: ExperimentInterfaceStringDates;
  data: ExperimentTargetingData;
  // | (ExperimentPhaseStringDates & { reseed: boolean, blockedVariations: number[], minBucketVersion: number });
  stickyBucketing: boolean;
}) {
  const lastPhase: ExperimentPhaseStringDates | undefined =
    experiment.phases[experiment.phases.length - 1];

  // Returned recommendations:
  let promptExistingUserOptions = true;
  const newPhase = false;
  const newBucketVersion = false;
  const newSeed = false;
  const blockPreviouslyBucketed = false;
  // Returned meta:
  let reason = "";
  const messages: string[] = [];
  const warnings: string[] = [];

  // Decision variables (1-8):
  let moreRestrictiveTargeting = false;
  const otherTargetingChanges = false;
  let decreaseCoverage = false;
  let addToNamespace = false;
  const decreaseNamespaceRange = false;
  const otherNamespaceChanges = false;
  let changeVariationWeights = false;
  let disableVariation = false;

  // 1. More restrictive targeting?
  // Remove outer curly braces from condition so we can use it to look for substrings
  // e.g. If they have 3 conditions ANDed together and delete one, that is a safe change
  // But if they add new conditions or modify an existing one, that is not
  // There are some edge cases with '$or' that are not handled correctly, but those are super rare
  // todo: is this correct?
  const strippedCondition = data.condition.slice(1).slice(0, -1);
  if (!(lastPhase.condition || "").includes(strippedCondition)) {
    moreRestrictiveTargeting = true;
  }

  // 2. Other targeting changes?
  // todo: assess?

  // 3. Decrease coverage?
  if (data.coverage < (lastPhase.coverage ?? 1)) {
    decreaseCoverage = true;
  }

  // 4. Add to namespace?
  if (
    data.namespace.enabled &&
    (!lastPhase.namespace.enabled ||
      data.namespace.name !== lastPhase.namespace?.name)
  ) {
    addToNamespace = true;
  }

  // 5. Decrease namespace range?
  // todo: is this reasonable?
  if (
    data.namespace.enabled &&
    lastPhase.namespace.enabled &&
    data.namespace.name === lastPhase.namespace.name
  ) {
    const namespaceRange = data.namespace.range ?? [0, 1];
    const lastNamespaceRange = lastPhase.namespace.range ?? [0, 1];
    if (
      namespaceRange[0] > lastNamespaceRange[0] ||
      namespaceRange[1] < lastNamespaceRange[1]
    ) {
      addToNamespace = true;
    }
  }

  // 6. Other namespace changes?
  // todo: assess?

  // 7.
  // Changing variation weights will almost certainly cause an SRM error
  if (
    JSON.stringify(data.variationWeights) !==
    JSON.stringify(lastPhase.variationWeights)
  ) {
    changeVariationWeights = true;
  }

  // 8. Disable variation?
  const blockedVariations: number[] = data.blockedVariations ?? [];
  const lastBlockedVariations: number[] = experiment.blockedVariations ?? [];
  if (blockedVariations.some((v) => !lastBlockedVariations.includes(v))) {
    disableVariation = true;
  }

  console.log({
    moreRestrictiveTargeting,
    otherTargetingChanges,
    decreaseCoverage,
    addToNamespace,
    decreaseNamespaceRange,
    otherNamespaceChanges,
    changeVariationWeights,
    disableVariation,
  })

  if (
    !moreRestrictiveTargeting &&
    !otherTargetingChanges &&
    !decreaseCoverage &&
    !addToNamespace &&
    !decreaseNamespaceRange &&
    !otherNamespaceChanges &&
    !changeVariationWeights &&
    !disableVariation
  ) {
    // recommend no release changes
    promptExistingUserOptions = false;
    reason = "no risky changes detected";
  }

  return {
    promptExistingUserOptions,
    newPhase,
    newBucketVersion,
    newSeed,
    blockPreviouslyBucketed,
    reason,
    messages,
    warnings,
  };
}

type ExistingUsersOption = "keep" | "exclude";

export default function ReleaseChangesForm({ experiment, form }: Props) {
  const settings = useOrgSettings();
  const { hasCommercialFeature } = useUser();

  const stickyBucketing = !!settings.useStickyBucketing;
  const hasStickyBucketFeature = hasCommercialFeature("sticky-bucketing");
  const [stickyBucketingCTAOpen, setStickyBucketingCTAOpen] = useState(false);

  const lastPhase: ExperimentPhaseStringDates | undefined =
    experiment.phases[experiment.phases.length - 1];

  const [existingUsersOption, setExistingUsersOption] = useState<ExistingUsersOption>("keep");

  const newPhase = form.watch("newPhase");
  const variationWeights = form.watch("variationWeights");
  const coverage = form.watch("coverage");
  const condition = form.watch("condition");
  const namespace = form.watch("namespace");
  const savedGroups = form.watch("savedGroups");
  const encodedVariationWeights = JSON.stringify(variationWeights);
  const encodedNamespace = JSON.stringify(namespace);
  const isNamespaceEnabled = namespace.enabled;
  const shouldCreateNewPhase = useMemo<boolean>(() => {
    // If no previous phase, we don't need to ask about creating a new phase
    if (!lastPhase) return false;

    // Changing variation weights will almost certainly cause an SRM error
    if (
      encodedVariationWeights !== JSON.stringify(lastPhase.variationWeights)
    ) {
      return true;
    }

    // Remove outer curly braces from condition so we can use it to look for substrings
    // e.g. If they have 3 conditions ANDed together and delete one, that is a safe change
    // But if they add new conditions or modify an existing one, that is not
    // There are some edge cases with '$or' that are not handled correctly, but those are super rare
    const strippedCondition = condition.slice(1).slice(0, -1);
    if (!(lastPhase.condition || "").includes(strippedCondition)) {
      return true;
    }

    // Changing saved groups
    // TODO: certain changes should be safe, so make this logic smarter
    if (
      JSON.stringify(savedGroups || []) !==
      JSON.stringify(lastPhase.savedGroups || [])
    ) {
      return true;
    }

    // If adding or changing a namespace
    if (
      isNamespaceEnabled &&
      encodedNamespace !== JSON.stringify(lastPhase.namespace)
    ) {
      return true;
    }

    // If reducing coverage
    if (coverage < (lastPhase.coverage ?? 1)) {
      return true;
    }

    // If not changing any of the above, no reason to create a new phase
    return false;
  }, [
    coverage,
    lastPhase,
    encodedVariationWeights,
    condition,
    isNamespaceEnabled,
    encodedNamespace,
    savedGroups,
  ]);

  const recommendedRolloutData = getRecommendedRolloutData({
    experiment,
    data: form.getValues(),
    stickyBucketing,
  });
  console.log(recommendedRolloutData);

  useEffect(() => {
    form.setValue("newPhase", shouldCreateNewPhase);
    form.setValue("reseed", true);
  }, [form, shouldCreateNewPhase]);

  if (!lastPhase) return null;

  return (
    <div className="mb-2">
      <hr />
      {/*<div className="alert alert-info">*/}
      {/*  We have defaulted you to the recommended release settings below based on*/}
      {/*  the changes you made above. These recommendations will prevent bias and*/}
      {/*  data quality issues in your results.{" "}*/}
      {/*  <DocLink docSection="targetingChanges">Learn more</DocLink>*/}
      {/*</div>*/}



      <div className="mb-4 d-flex">
        {!stickyBucketingCTAOpen ? (<div className="d-inline-block">
          <div>
            Sticky bucketing is currently {stickyBucketing ? "enabled" : "disabled"} for your organization.
          </div>
          <a
            role="button"
            className="a"
            onClick={(e) => {
              e.preventDefault();
              setStickyBucketingCTAOpen(true);
            }}
          >
            Change
          </a>
        </div>) : (
          <>
        <label className="mr-2" htmlFor="toggle-useStickyBucketing">
          <PremiumTooltip
            commercialFeature={"sticky-bucketing"}
            body={
              <>
                <div className="mb-2">
                  Sticky bucketing allows you to persist a
                  user&apos;s assigned variation if any of the
                  following change:
                  <ol className="mt-1 mb-2" type="a">
                    <li>the user logs in or logs out</li>
                    <li>experiment targeting conditions change</li>
                    <li>experiment coverage changes</li>
                    <li>variation weights change</li>
                  </ol>
                </div>
                <div>
                  Enabling sticky bucketing also allows you to set
                  fine controls over bucketing behavior, such as:
                  <ul className="mt-1 mb-2">
                    <li>
                      assigning variations based on both a{" "}
                      <code>user_id</code> and{" "}
                      <code>anonymous_id</code>
                    </li>
                    <li>invalidating existing buckets</li>
                    <li>and more</li>
                  </ul>
                </div>
                <p className="mb-0">
                  You must enable this feature in your SDK
                  integration code for it to take effect.
                </p>
              </>
            }
          >
            Enable sticky bucketing for organization <FaQuestionCircle />
          </PremiumTooltip>
        </label>
        <Toggle
          id={"toggle-useStickyBucketing"}
          value={stickyBucketing}
          setValue={(value) => {
            console.log('change...', value);
          }}
          disabled={!hasStickyBucketFeature}
        />
      </>
      )}
      </div>



      { recommendedRolloutData.promptExistingUserOptions ? (<>
        <div className="alert alert-warning">
          <div>
            <TbTargetArrow size={16} className="mr-1" />
            Warning: These targeting changes will affect existing users.
          </div>
          <hr className="my-2" />
          <div>
            With experiment sticky bucketing, you can customize how existing users are handled.
          </div>
          {/*todo: org level SB setting warning (and double check it does anything)*/}
          {/*todo: experiment level SB setting*/}
        </div>
        <SelectField
          label="What should happen to existing users after making these changes?"
          value={existingUsersOption}
          options={[
            {
              label: "Keep their assigned variation",
              value: "keep",
            },
            {
              label: "Exclude them from the experiment",
              value: "exclude",
            }
          ]}
          onChange={(v)=> setExistingUsersOption(v as ExistingUsersOption)}
        />
      </>) : (
        <div>skip...</div>
      )}

      <SelectField
        label="How to release changes"
        options={[
          {
            label: "Start a new phase",
            value: "new",
          },
          {
            label: "Update the existing phase",
            value: "existing",
          },
        ]}
        formatOptionLabel={(value) => {
          const recommended =
            (value.value === "new" && shouldCreateNewPhase) ||
            (value.value === "existing" && !shouldCreateNewPhase);

          return (
            <>
              {value.label}{" "}
              {recommended && (
                <span className="badge badge-purple badge-pill ml-2">
                  recommended
                </span>
              )}
            </>
          );
        }}
        value={newPhase ? "new" : "existing"}
        onChange={(value) => form.setValue("newPhase", value === "new")}
      />

      {newPhase && (
        <div className="form-group">
          <Toggle
            id="reseed-traffic"
            value={form.watch("reseed")}
            setValue={(reseed) => form.setValue("reseed", reseed)}
          />{" "}
          <label htmlFor="reseed-traffic" className="text-dark">
            Re-randomize Traffic
          </label>{" "}
          <span className="badge badge-purple badge-pill ml-2">
            recommended
          </span>
          <small className="form-text text-muted">
            Removes carryover bias. Returning visitors will be re-bucketed and
            may start seeing a different variation from before. Only supported
            in{" "}
            <Tooltip
              body={
                <>
                  Only supported in the following SDKs:
                  <NewBucketingSDKList />
                  Unsupported SDKs and versions will simply ignore this setting
                  and continue with the previous randomization.
                </>
              }
            >
              <span className="text-primary">some SDKs</span>
            </Tooltip>
          </small>
        </div>
      )}
    </div>
  );
}
