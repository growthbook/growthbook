import clsx from "clsx";
import { FeatureInterface } from "shared/types/feature";
import React, { forwardRef, useState } from "react";
import { Box, Flex, Heading } from "@radix-ui/themes";
import { HoldoutInterface } from "shared/validators";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { PiArrowBendRightDown } from "react-icons/pi";
import {
  coverageToHoldoutSize,
  filterEnvironmentsByFeature,
  getEnabledHoldoutEnvironments,
} from "shared/util";
import { hasTargetingConfigured } from "shared/experiments";
import Link from "@/ui/Link";
import { LockedRowMenu } from "@/components/Features/ScheduleLock";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useExperimentStatusIndicator } from "@/hooks/useExperimentStatusIndicator";
import Text from "@/ui/Text";
import { useEnvironments } from "@/services/features";
import Badge from "@/ui/Badge";
import RuleEnvScopeBadges from "@/components/Features/RuleEnvScopeBadges";
import RuleCard, { RuleCardSideColor } from "@/components/Features/RuleCard";
import useApi from "@/hooks/useApi";
import Callout from "@/ui/Callout";
import TruncatedConditionDisplay from "@/components/SavedGroups/TruncatedConditionDisplay";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  MoreMenuTrigger,
} from "@/ui/DropdownMenu";
import RemoveFromHoldoutModal from "./RemoveFromHoldoutModal";
import AddToHoldoutModal from "./AddToHoldoutModal";
import HoldoutSummary from "./HoldoutSummary";
import RuleField from "./RuleField";
import { useFeaturePageRedesign } from "./FeaturePageRedesign";
import cornerStyles from "./CornerActions.module.scss";
import ruleCardStyles from "./RuleCard.module.scss";

interface Props {
  feature: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  mutate: () => void;
  setRuleModal: () => void;
  setVersion: (version: number) => void;
  isDeleted?: boolean;
  // The current draft adds this holdout; it goes live when the draft publishes.
  isPendingAdd?: boolean;
  isLocked?: boolean;
  // Shows the menu disabled rather than hiding it.
  lockedBySchedule?: boolean;
  // Per-env tab passes its env id so the badge sorts current env first;
  // omitted in the All-Environments view.
  currentEnvironment?: string;
}

// eslint-disable-next-line
export const HoldoutRule = forwardRef<HTMLDivElement, Props>(
  (
    {
      feature,
      revisionList,
      setRuleModal,
      mutate,
      setVersion,
      isDeleted = false,
      isPendingAdd = false,
      isLocked = false,
      lockedBySchedule = false,
      currentEnvironment,
      ...props
    },
    ref,
  ) => {
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [removeModal, setRemoveModal] = useState(false);
    const [reEnableModal, setReEnableModal] = useState(false);

    const { data } = useApi<{
      holdout: HoldoutInterface;
      experiment: ExperimentInterfaceStringDates;
      envs: string[];
    }>(`/holdout/${feature.holdout?.id}?summary=1`, {
      shouldRun: () => !!feature.holdout?.id,
    });

    const permissionsUtil = usePermissionsUtil();

    const allEnvironments = useEnvironments();
    const environments = filterEnvironmentsByFeature(allEnvironments, feature);

    const getStatusIndicator = useExperimentStatusIndicator();
    const redesign = useFeaturePageRedesign();
    const holdout = data?.holdout;
    const holdoutExperiment = data?.experiment;

    if (!holdout || !holdoutExperiment) return null;

    // Holdout env scope lives on the holdout itself (not the feature link).
    // Show envs where the holdout is enabled as active, the rest as inactive.
    const activeHoldoutEnvIds = getEnabledHoldoutEnvironments(
      holdout.environmentSettings,
    );

    // The phase the payload sends.
    const phase = holdoutExperiment.phases[0];
    const hasCondition = hasTargetingConfigured(phase);
    const status = getStatusIndicator(holdoutExperiment);

    const canEdit = permissionsUtil.canEditFeatureDrafts(feature);

    const isInactive =
      !isDeleted &&
      (holdoutExperiment.status === "stopped" || holdoutExperiment.archived);

    const sideColor: RuleCardSideColor = isDeleted
      ? "removed"
      : isInactive
        ? "skipped"
        : "active";

    return (
      <Box {...props} ref={ref} style={{ margin: -1 }}>
        <RuleCard
          index={1}
          sideColor={sideColor}
          header={
            <Flex
              justify="between"
              align="center"
              gap="3"
              style={{ maxWidth: "100%" }}
            >
              <Flex
                align="center"
                gap="2"
                style={{ flex: "0 1 auto", flexWrap: "wrap" }}
              >
                <Heading as="h4" size="3" weight="medium" mb="0">
                  <>
                    Holdout:{" "}
                    <Link
                      href={`/holdout/${feature.holdout?.id}`}
                      style={{ marginRight: "var(--space-2)" }}
                    >
                      {holdout.name}
                    </Link>
                  </>
                </Heading>
                {/* Its status alone, as the experiment page shows a holdout's. */}
                {!isDeleted && (
                  <Badge
                    label={status.status}
                    color={status.color}
                    variant="soft"
                    radius="full"
                  />
                )}
              </Flex>

              <Flex align="center" gap="3" flexShrink="0">
                {isInactive && (
                  <Badge
                    color="amber"
                    label={
                      <>
                        <PiArrowBendRightDown />
                        Skipped
                      </>
                    }
                  />
                )}

                {canEdit && lockedBySchedule ? (
                  <LockedRowMenu
                    className={clsx(
                      cornerStyles.actions,
                      ruleCardStyles.rowMenu,
                    )}
                  />
                ) : null}
                {canEdit && !isLocked && (
                  <DropdownMenu
                    trigger={
                      <MoreMenuTrigger
                        label="Holdout actions"
                        className={clsx(
                          cornerStyles.actions,
                          ruleCardStyles.rowMenu,
                        )}
                      />
                    }
                    open={dropdownOpen}
                    onOpenChange={setDropdownOpen}
                    menuPlacement="end"
                    variant="soft"
                  >
                    <DropdownMenuGroup>
                      {isDeleted ? (
                        <DropdownMenuItem
                          onClick={() => {
                            setDropdownOpen(false);
                            setReEnableModal(true);
                          }}
                        >
                          Re-enable holdout
                        </DropdownMenuItem>
                      ) : (
                        <>
                          <DropdownMenuItem
                            onClick={() => {
                              setRuleModal();
                              setDropdownOpen(false);
                            }}
                          >
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            color="red"
                            onClick={() => {
                              setDropdownOpen(false);
                              setRemoveModal(true);
                            }}
                          >
                            Remove from holdout
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuGroup>
                  </DropdownMenu>
                )}
              </Flex>
            </Flex>
          }
        >
          <RuleField label="Environments">
            <RuleEnvScopeBadges
              activeEnvironmentIds={activeHoldoutEnvIds}
              environments={environments}
              currentEnvironment={currentEnvironment}
              my="0"
            />
          </RuleField>
          <Box style={{ opacity: isInactive ? 0.6 : 1 }}>
            {isDeleted ? (
              <Callout status="error" size="sm">
                This feature has been removed from the holdout in the current
                draft. Publish or discard the draft to resolve.
              </Callout>
            ) : isPendingAdd ? (
              <Callout status="info" size="sm">
                This feature will be added to the holdout when the current draft
                is published. Discard the draft to cancel.
              </Callout>
            ) : holdoutExperiment.status === "stopped" ? (
              <Callout status="info">
                This Holdout is stopped and this rule will be skipped.{" "}
                <Link href={`/holdout/${holdout.id}#results`}>
                  View results
                </Link>
              </Callout>
            ) : null}
          </Box>
          {!isInactive && !isDeleted && (
            <Box style={{ opacity: isInactive ? 0.6 : 1 }} mt="3">
              <RuleField label="Targeting">
                {hasCondition ? (
                  <TruncatedConditionDisplay
                    condition={phase.condition || ""}
                    savedGroups={phase.savedGroups}
                    prerequisites={phase.prerequisites}
                    prefix={
                      redesign ? <Text weight="medium">IF</Text> : undefined
                    }
                  />
                ) : (
                  "All traffic"
                )}
              </RuleField>
              <HoldoutSummary
                feature={feature}
                value={feature.holdout?.value || ""}
                hashAttribute={holdoutExperiment.hashAttribute || ""}
                holdoutSize={coverageToHoldoutSize(phase.coverage)}
              />
            </Box>
          )}
        </RuleCard>
        {removeModal && (
          <RemoveFromHoldoutModal
            feature={feature}
            revisionList={revisionList}
            close={() => setRemoveModal(false)}
            mutate={mutate}
            setVersion={setVersion}
          />
        )}
        {reEnableModal && (
          <AddToHoldoutModal
            feature={feature}
            revisionList={revisionList}
            close={() => setReEnableModal(false)}
            mutate={mutate}
            setVersion={setVersion}
          />
        )}
      </Box>
    );
  },
);
