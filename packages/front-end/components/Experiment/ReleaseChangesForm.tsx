import { UseFormReturn } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  ExperimentTargetingData,
} from "back-end/types/experiment";
import React, { useEffect, useState } from "react";
import { FaCheck, FaExclamationCircle, FaQuestionCircle } from "react-icons/fa";
import { HiOutlineExclamationCircle } from "react-icons/hi";
import clsx from "clsx";
import { RxInfoCircled } from "react-icons/rx";
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
  stickyBucketing,
}: {
  experiment: ExperimentInterfaceStringDates;
  data: ExperimentTargetingData;
  stickyBucketing: boolean;
  // | (ExperimentPhaseStringDates & { reseed: boolean, blockedVariations: number[], minBucketVersion: number });
}) {
  const lastPhase: ExperimentPhaseStringDates | undefined =
    experiment.phases[experiment.phases.length - 1];

  // Returned recommendations:
  let newPhase = false;
  let newSeed = false;
  // Secondary recommendations for when the user chooses "reassign"
  let reassign_newPhase = false;
  let reassign_newSeed = false;

  // UI related:
  let promptExistingUserOptions = true;
  let existingUsersOption: ExistingUsersOption = "reassign";
  let disableKeepOption = false;
  let disableSamePhase = false;

  // for messaging about the benefits of sticky bucketing
  let samePhaseSafeWithStickyBucketing = false;
  // for displaying the level of risk imposed by the changes
  let riskLevel = "safe";

  // Returned meta:
  let reasons: {
    moreRestrictiveTargeting?: boolean;
    otherTargetingChanges?: boolean;
    decreaseCoverage?: boolean;
    addToNamespace?: boolean;
    decreaseNamespaceRange?: boolean;
    otherNamespaceChanges?: boolean;
    changeVariationWeights?: boolean;
    disableVariation?: boolean;
  } = {};

  // Decision variables (1-8):
  let moreRestrictiveTargeting = false;
  const otherTargetingChanges = false;
  let decreaseCoverage = false;
  let addToNamespace = false;
  let decreaseNamespaceRange = false;
  const otherNamespaceChanges = false;
  let changeVariationWeights = false;
  let disableVariation = false;

  // Assign decision variables (1-8)
  // ===============================

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
      decreaseNamespaceRange = true;
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

  // Make recommendations, control available options
  // --> based on decision variables (1-8) and sticky bucketing support
  // ===============================

  // A. Nothing risky has changed
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
  } else {
    // B. Calculate recommendations as if sticky bucketing is enabled
    // (We will override these later if it is not. Calculating this allows us to
    // show the user the benefits of enabling sticky bucketing)
    if (moreRestrictiveTargeting || decreaseCoverage || disableVariation) {
      // safe
      promptExistingUserOptions = true;
      existingUsersOption = "keep";
      samePhaseSafeWithStickyBucketing = true;
      riskLevel = "safe";
    }
    if (otherTargetingChanges) {
      // warning
      promptExistingUserOptions = true;
      existingUsersOption = "exclude";
      samePhaseSafeWithStickyBucketing = true;
      riskLevel = "warning";
      reasons = { ...reasons, otherTargetingChanges };
    }
    if (
      addToNamespace ||
      decreaseNamespaceRange ||
      otherNamespaceChanges ||
      changeVariationWeights
    ) {
      // danger
      promptExistingUserOptions = true;
      existingUsersOption = "exclude";
      disableKeepOption = true;
      samePhaseSafeWithStickyBucketing = false;
      riskLevel = "danger";
      reasons = {
        ...reasons,
        addToNamespace,
        decreaseNamespaceRange,
        otherNamespaceChanges,
        changeVariationWeights,
      };
    }
    // secondary recommendations for when the user chooses "reassign"
    if (
      moreRestrictiveTargeting ||
      decreaseCoverage ||
      addToNamespace ||
      decreaseNamespaceRange ||
      otherTargetingChanges ||
      otherNamespaceChanges ||
      changeVariationWeights ||
      disableVariation
    ) {
      reassign_newPhase = true;
      reassign_newSeed = true;
    }

    // C. Calculate recommendations when sticky bucketing is disabled
    if (!stickyBucketing) {
      // reset
      promptExistingUserOptions = true;
      existingUsersOption = "keep";
      newPhase = false;
      newSeed = false;
      riskLevel = "safe";
      reasons = {};

      if (
        moreRestrictiveTargeting ||
        decreaseCoverage ||
        addToNamespace ||
        decreaseNamespaceRange
      ) {
        // warning
        promptExistingUserOptions = true;
        existingUsersOption = "reassign";
        disableSamePhase = true;
        newPhase = true;
        newSeed = true;
        riskLevel = "warning";
        reasons = {
          ...reasons,
          moreRestrictiveTargeting,
          decreaseCoverage,
          addToNamespace,
          decreaseNamespaceRange,
        };
      }
      if (
        otherTargetingChanges ||
        otherNamespaceChanges ||
        changeVariationWeights ||
        disableVariation
      ) {
        // danger
        promptExistingUserOptions = true;
        existingUsersOption = "reassign";
        disableKeepOption = true;
        disableSamePhase = true;
        newPhase = true;
        newSeed = true;
        riskLevel = "danger";
        reasons = {
          ...reasons,
          otherTargetingChanges,
          otherNamespaceChanges,
          changeVariationWeights,
          disableVariation,
        };
      }
    }
  }

  return {
    promptExistingUserOptions,
    existingUsersOption,
    disableKeepOption,
    disableSamePhase,
    newPhase,
    // newBucketVersion,
    newSeed,
    // blockPreviouslyBucketed,
    reassign_newPhase,
    reassign_newSeed,
    samePhaseSafeWithStickyBucketing,
    riskLevel,
    reasons,
  };
}

function SafeToReleaseBanner(
  { className, style, lowRiskWithStickyBucketing = false }: { className?: string, style?: React.CSSProperties, lowRiskWithStickyBucketing?: boolean }
) {
  return (
    <div className={clsx("alert alert-success", className)} style={style}>
      <div className="mb-1">
        <FaCheck/>{" "}
        {lowRiskWithStickyBucketing
          ? "The changes you have made do not impact existing bucketed users because Sticky Bucketing is enabled."
          : "The changes you have made do not impact existing bucketed users."
        }
      </div>
      <div className="mb-0 small">
        You may safely update the existing experiment phase, if desired, without
        additional considerations.
      </div>
    </div>
  );
}

type ExistingUsersOption = "keep" | "exclude" | "reassign";

export default function ReleaseChangesForm({ experiment, form }: Props) {
  const { apiCall } = useAuth();
  const { hasCommercialFeature, refreshOrganization } = useUser();
  const permissions = usePermissions();
  const settings = useOrgSettings();

  const orgStickyBucketing = !!settings.useStickyBucketing;
  const usingStickyBucketing =
    orgStickyBucketing && !experiment.disableStickyBucketing;
  const hasStickyBucketFeature = hasCommercialFeature("sticky-bucketing");
  const [stickyBucketingCTAOpen, setStickyBucketingCTAOpen] = useState(false);

  const lastPhase: ExperimentPhaseStringDates | undefined =
    experiment.phases[experiment.phases.length - 1];

  const [
    existingUsersOption,
    setExistingUsersOption,
  ] = useState<ExistingUsersOption>("reassign");

  const recommendedRolloutData = getRecommendedRolloutData({
    experiment,
    data: form.getValues(),
    stickyBucketing: usingStickyBucketing,
  });

  useEffect(() => {
    if (existingUsersOption === "keep") {
      // same phase, same seed, same bucket version
      form.setValue("newPhase", false);
      form.setValue("reseed", false);
      form.setValue("bucketVersion", experiment.bucketVersion);
      form.setValue("minBucketVersion", experiment.minBucketVersion);
    } else if (existingUsersOption === "exclude") {
      // new phase, new seed, new bucket version (block prior buckets)
      form.setValue("newPhase", true);
      form.setValue("reseed", true);
      form.setValue("bucketVersion", (experiment.bucketVersion ?? 0) + 1);
      form.setValue("minBucketVersion", (experiment.bucketVersion ?? 0) + 1);
    } else if (existingUsersOption === "reassign") {
      // new phase, new seed, new bucket version (reassign prior buckets)
      form.setValue("newPhase", recommendedRolloutData.reassign_newPhase);
      form.setValue("reseed", recommendedRolloutData.reassign_newSeed);
      form.setValue("bucketVersion", (experiment.bucketVersion ?? 0) + 1);
      form.setValue("minBucketVersion", experiment.minBucketVersion ?? 0);
      // todo: this is a problem because the recommended "newPhase" and "reseed" values in
      // the users prompt may not match the recommended values when choosing "reassign"
    }
  }, [existingUsersOption]);

  useEffect(() => {
    if (existingUsersOption !== "reassign") return;
    if (!form.watch("newPhase")) {
      // existing
      form.setValue("reseed", false);
      form.setValue("bucketVersion", experiment.bucketVersion);
      form.setValue("minBucketVersion", experiment.minBucketVersion);
    } else {
      // new
      form.setValue("bucketVersion", (experiment.bucketVersion ?? 0) + 1);
      form.setValue("minBucketVersion", experiment.minBucketVersion);
    }
  }, [existingUsersOption, form.watch("newPhase"), form.watch("reseed")]);

  useEffect(() => {
    setExistingUsersOption(recommendedRolloutData.existingUsersOption);
    form.setValue("newPhase", recommendedRolloutData.newPhase);
    form.setValue("reseed", recommendedRolloutData.newSeed);
  }, [
    recommendedRolloutData.existingUsersOption,
    recommendedRolloutData.newPhase,
    recommendedRolloutData.newSeed,
  ]);

  if (!lastPhase) return null;

  return (
    <div
      className="bg-light px-4 py-4 mt-4 border-top"
      style={{ boxShadow: "rgba(0, 0, 0, 0.06) 0px 2px 4px 0px inset" }}
    >
      <div className="d-flex mb-3">
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
                className="a"
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
          {recommendedRolloutData.riskLevel === "safe" ? (
            <SafeToReleaseBanner
              className="mb-0"
              style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
              lowRiskWithStickyBucketing={true}
            />
          ) : (
            <div
              className={`alert alert-${recommendedRolloutData.riskLevel} mb-0`}
              style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
            >
              <div>
                {recommendedRolloutData.riskLevel === "warning" ? (
                  <>
                    <FaExclamationCircle /> The changes you have made may impact
                    existing bucketed users.
                  </>
                ) : (
                  <>
                    <FaExclamationCircle /> The changes you have made have a
                    high risk of impacting existing bucketed users.
                  </>
                )}

                <Tooltip
                  body={
                    <>
                      <div className="font-weight-bold mb-2">
                        Existing users may be impacted by the following changes
                        you have made:
                      </div>
                      <ul className="mb-1">
                        {recommendedRolloutData.reasons
                          .moreRestrictiveTargeting && (
                          <li>More restrictive targeting</li>
                        )}
                        {recommendedRolloutData.reasons.decreaseCoverage && (
                          <li>Decreased coverage</li>
                        )}
                        {recommendedRolloutData.reasons.addToNamespace && (
                          <li>Added to namespace</li>
                        )}
                        {recommendedRolloutData.reasons
                          .decreaseNamespaceRange && (
                          <li>Decreased namespace range</li>
                        )}
                        {recommendedRolloutData.reasons
                          .changeVariationWeights && (
                          <li>Changed variation weights</li>
                        )}
                        {recommendedRolloutData.reasons.disableVariation && (
                          <li>Disabled a variation</li>
                        )}
                      </ul>
                      {recommendedRolloutData.samePhaseSafeWithStickyBucketing && (
                        <div className="mt-3">
                          <span
                            className="badge badge-muted-info badge-pill mr-2"
                            style={{ fontSize: "10px" }}
                          >
                            SB
                          </span>
                          If you would like to release these changes while
                          maintaining the same phase, you can mitigate the risk
                          by enabling Sticky Bucketing.
                        </div>
                      )}
                    </>
                  }
                >
                  <a role="button" className="a ml-2">
                    Learn more <RxInfoCircled />
                  </a>
                </Tooltip>

                <div className="mt-2">
                  We have recommended a release strategy to mitigate risk to
                  your experiment.
                </div>
              </div>
              {/*todo: experiment level SB setting*/}
            </div>
          )}
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

                const recommended =
                  value.value === recommendedRolloutData.existingUsersOption;

                const disabled =
                  (requiresStickyBucketing && !usingStickyBucketing) ||
                  (value.value === "keep" &&
                    recommendedRolloutData.disableKeepOption);

                return (
                  <div
                    className={clsx({
                      "cursor-disabled": disabled,
                    })}
                  >
                    <span style={{ opacity: disabled ? 0.5 : 1 }}>
                      {value.label}{" "}
                    </span>
                    {requiresStickyBucketing && (
                      <Tooltip
                        body={`${
                          usingStickyBucketing ? "Uses" : "Requires"
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
                    {recommended && (
                      <span className="badge badge-purple badge-pill ml-2">
                        recommended
                      </span>
                    )}
                  </div>
                );
              }}
              onChange={(v) => {
                const requiresStickyBucketing = v === "keep" || v === "exclude";
                const disabled =
                  (requiresStickyBucketing && !usingStickyBucketing) ||
                  (v === "keep" && recommendedRolloutData.disableKeepOption);
                if (disabled) return;
                setExistingUsersOption(v as ExistingUsersOption);
              }}
            />
          </div>
        </>
      ) : (
        <SafeToReleaseBanner />
      )}

      {existingUsersOption === "reassign" && (
        <>
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
                (value.value === "new" && recommendedRolloutData.reassign_newPhase) ||
                (value.value === "existing" &&
                  !recommendedRolloutData.reassign_newPhase);

              const disabled =
                value.value === "existing" &&
                recommendedRolloutData.disableSamePhase;

              return (
                <div
                  className={clsx({
                    "cursor-disabled": disabled,
                  })}
                >
                  <span style={{ opacity: disabled ? 0.5 : 1 }}>
                    {value.label}
                  </span>
                  {recommended && (
                    <span className="badge badge-purple badge-pill ml-2">
                      recommended
                    </span>
                  )}
                </div>
              );
            }}
            value={form.watch("newPhase") ? "new" : "existing"}
            onChange={(value) => {
              const disabled =
                value === "existing" && recommendedRolloutData.disableSamePhase;
              if (disabled) return;
              form.setValue("newPhase", value === "new");
            }}
          />

          {form.watch("newPhase") && (
            <div className="form-group">
              <Toggle
                id="reseed-traffic"
                value={form.watch("reseed")}
                setValue={(reseed) => form.setValue("reseed", reseed)}
              />{" "}
              <label htmlFor="reseed-traffic" className="text-dark">
                Re-randomize traffic
              </label>{" "}
              {recommendedRolloutData.reassign_newSeed && (
                <span className="badge badge-purple badge-pill ml-2">
                  recommended
                </span>
              )}
              <small className="form-text text-muted">
                Removes carryover bias. Returning visitors will be re-bucketed
                and may start seeing a different variation from before. Only
                supported in{" "}
                <Tooltip
                  body={
                    <>
                      Only supported in the following SDKs:
                      <NewBucketingSDKList />
                      Unsupported SDKs and versions will simply ignore this
                      setting and continue with the previous randomization.
                    </>
                  }
                >
                  <span className="text-primary">some SDKs</span>
                </Tooltip>
              </small>
            </div>
          )}
        </>
      )}

      <hr className="mt-4" />
      <div className="mt-4">
        <div className="h5 text-muted">Release plan</div>
        <table className="table table-sm">
          <tbody>
            <tr>
              <td>New phase?</td>
              <td>{form.watch("newPhase") ? "Yes" : "No"}</td>
            </tr>
            <tr>
              <td>Re-randomize traffic?</td>
              <td>{form.watch("reseed") ? "Yes" : "No"}</td>
            </tr>
            <tr>
              <td>Bucket version?</td>
              <td>{form.watch("bucketVersion") !== experiment.bucketVersion
                ? `Changed: ${(experiment.bucketVersion ?? 0)} -> ${form.watch("bucketVersion")}`
                : `No change: ${form.watch("bucketVersion")}`
              }</td>
            </tr>
            <tr>
              <td>Block previous bucket?</td>
              <td>{form.watch("minBucketVersion") !== experiment.minBucketVersion
                ? `Changed: ${(experiment.minBucketVersion ?? 0)} -> ${form.watch("minBucketVersion")}`
                : `No change: ${form.watch("minBucketVersion")}`
              }</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
