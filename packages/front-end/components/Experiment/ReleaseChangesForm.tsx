import { UseFormReturn } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  ExperimentTargetingData,
} from "back-end/types/experiment";
import React, { useEffect, useMemo, useState } from "react";
import {
  FaCheck,
  FaExclamationCircle,
  FaQuestionCircle,
} from "react-icons/fa";
import { HiOutlineExclamationCircle } from "react-icons/hi";
import clsx from "clsx";
import useOrgSettings from "@/hooks/useOrgSettings";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import usePermissions from "@/hooks/usePermissions";
import SelectField from "../Forms/SelectField";
import Toggle from "../Forms/Toggle";
import Tooltip from "../Tooltip/Tooltip";
import { NewBucketingSDKList } from "./HashVersionSelector";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  form: UseFormReturn<ExperimentTargetingData>;
  // | ExperimentPhaseStringDates & { reseed: boolean, blockedVariations: number[], minBucketVersion: number }
}

function getRecommendedRolloutData({
  experiment,
  data,
}: {
  experiment: ExperimentInterfaceStringDates;
  data: ExperimentTargetingData;
  // | (ExperimentPhaseStringDates & { reseed: boolean, blockedVariations: number[], minBucketVersion: number });
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
  });

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
  const { apiCall } = useAuth();
  const { hasCommercialFeature, refreshOrganization } = useUser();
  const permissions = usePermissions();
  const settings = useOrgSettings();

  const orgStickyBucketing = !!settings.useStickyBucketing;
  const hasStickyBucketFeature = hasCommercialFeature("sticky-bucketing");
  const [stickyBucketingCTAOpen, setStickyBucketingCTAOpen] = useState(false);

  const lastPhase: ExperimentPhaseStringDates | undefined =
    experiment.phases[experiment.phases.length - 1];

  const [
    existingUsersOption,
    setExistingUsersOption,
  ] = useState<ExistingUsersOption>("keep");

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
  });
  console.log(recommendedRolloutData);

  useEffect(() => {
    form.setValue("newPhase", shouldCreateNewPhase);
    form.setValue("reseed", true);
  }, [form, shouldCreateNewPhase]);

  if (!lastPhase) return null;

  return (
    <div
      className="bg-light px-4 py-4 mt-4 border-top"
      style={{ boxShadow: "rgba(0, 0, 0, 0.06) 0px 2px 4px 0px inset" }}
    >
      <div className="d-flex mb-2">
        <div className="h4 mb-0">Release changes</div>
        {/*<div className="alert alert-info">*/}
        {/*  We have defaulted you to the recommended release settings below based on*/}
        {/*  the changes you made above. These recommendations will prevent bias and*/}
        {/*  data quality issues in your results.{" "}*/}
        {/*  <DocLink docSection="targetingChanges">Learn more</DocLink>*/}
        {/*</div>*/}
        <div className="flex-1" />

        <div
          className="text-muted mb-0 pt-1 pb-0 px-2"
          style={{ marginTop: -5 }}
        >
          <div>
            {!orgStickyBucketing ? (
              <HiOutlineExclamationCircle className="mr-1" />
            ) : (
              <FaCheck className="mr-1" />
            )}
            Sticky Bucketing is {orgStickyBucketing ? "enabled" : "disabled"}{" "}
            for your organization
          </div>
          {!stickyBucketingCTAOpen &&
          !orgStickyBucketing &&
          permissions.organizationSettings ? (
            <div className="text-right">
              <a
                role="button"
                className="a ml-3"
                onClick={(e) => {
                  e.preventDefault();
                  setStickyBucketingCTAOpen(true);
                }}
              >
                Enable?
              </a>
            </div>
          ) : null}
          {stickyBucketingCTAOpen && permissions.organizationSettings ? (
            <div className="d-flex justify-content-end mt-2">
              <label className="mr-2" htmlFor="toggle-useStickyBucketing">
                <PremiumTooltip
                  commercialFeature={"sticky-bucketing"}
                  body={
                    <>
                      <div className="font-weight-bold mb-2">
                        This is an organization-level change.
                      </div>
                      <div className="mb-2">
                        Sticky Bucketing allows you to persist a user&apos;s
                        assigned variation if any of the following change:
                        <ol className="mt-1 mb-2" type="a">
                          <li>the user logs in or logs out</li>
                          <li>experiment targeting conditions change</li>
                          <li>experiment coverage changes</li>
                          <li>variation weights change</li>
                        </ol>
                      </div>
                      <div>
                        Enabling Sticky Bucketing also allows you to set fine
                        controls over bucketing behavior, such as:
                        <ul className="mt-1 mb-2">
                          <li>
                            assigning variations based on both a{" "}
                            <code>user_id</code> and <code>anonymous_id</code>
                          </li>
                          <li>invalidating existing buckets</li>
                          <li>and more</li>
                        </ul>
                      </div>
                      <p className="mb-0 text-warning-orange">
                        <FaExclamationCircle /> You must enable this feature in
                        your SDK integration code for it to take effect.
                      </p>
                    </>
                  }
                >
                  Enable Sticky Bucketing <FaQuestionCircle />
                </PremiumTooltip>
              </label>
              <Toggle
                id={"toggle-useStickyBucketing"}
                innerStyle={{ boxShadow: "0px 0 1px rgba(0, 0, 0, 0.75)" }}
                value={orgStickyBucketing}
                setValue={async (value) => {
                  await apiCall(`/organization`, {
                    method: "PUT",
                    body: JSON.stringify({
                      settings: {
                        useStickyBucketing: value,
                      },
                    }),
                  });
                  await refreshOrganization();
                }}
                disabled={!hasStickyBucketFeature}
              />
            </div>
          ) : null}
        </div>
      </div>

      {recommendedRolloutData.promptExistingUserOptions ? (
        <>
          <div
            className="alert alert-warning mb-0"
            style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
          >
            <div>
              <FaExclamationCircle /> The changes you have made may impact
              existing bucketed users
            </div>
            {/*todo: experiment level SB setting*/}
          </div>
          <div
            className="appbox mt-0 px-4 pt-3 pb-2"
            style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0 }}
          >
            <SelectField
              label={
                <>
                  <div>What should happen to existing bucketed users?</div>
                  <small>
                    Choose an option and we&apos;ll recommend how to release
                    these changes
                  </small>
                </>
              }
              value={existingUsersOption}
              options={[
                {
                  label: "Keep their assigned variation",
                  value: "keep",
                },
                {
                  label: "Exclude them from the experiment",
                  value: "exclude",
                },
                {
                  label: "Reassign them to a new variation",
                  value: "reassign",
                },
              ]}
              formatOptionLabel={(value) => {
                const requiresStickyBucketing =
                  value.value === "keep" || value.value === "exclude";
                return (
                  <div
                    className={clsx({
                      "cursor-disabled":
                        requiresStickyBucketing && !orgStickyBucketing,
                    })}
                  >
                    <span
                      style={{
                        opacity:
                          requiresStickyBucketing && !orgStickyBucketing
                            ? 0.5
                            : 1,
                      }}
                    >
                      {value.label}{" "}
                    </span>
                    {requiresStickyBucketing && (
                      <Tooltip
                        body={`${
                          orgStickyBucketing ? "Uses" : "Requires"
                        } Sticky Bucketing`}
                        className="mr-2"
                      >
                        <span
                          className="badge badge-muted-info badge-pill ml-2 position-relative"
                          style={{ zIndex: 1, fontSize: "10px" }}
                        >
                          SB
                        </span>
                      </Tooltip>
                    )}
                  </div>
                );
              }}
              onChange={(v) => {
                const requiresStickyBucketing = v === "keep" || v === "exclude";
                if (requiresStickyBucketing && !orgStickyBucketing) return;
                setExistingUsersOption(v as ExistingUsersOption);
              }}
            />
          </div>
        </>
      ) : (
        <div className="alert alert-success">
          <div className="mb-1">
            <FaCheck /> The changes you have made do not impact existing
            bucketed users
          </div>
          <div className="mb-0 small">
            You may safely update the existing experiment phase, if desired,
            without additional considerations.
          </div>
        </div>
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
