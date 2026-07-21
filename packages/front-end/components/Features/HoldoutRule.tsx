import { FeatureInterface } from "shared/types/feature";
import React, { forwardRef, useState } from "react";
import { Box, Flex, Heading, IconButton } from "@radix-ui/themes";
import { HoldoutInterface } from "shared/validators";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { PiArrowBendRightDown } from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import { filterEnvironmentsByFeature } from "shared/util";
import { hasTargetingConfigured } from "shared/experiments";
import Link from "@/ui/Link";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useEnvironments } from "@/services/features";
import Badge from "@/ui/Badge";
import RuleEnvScopeBadges from "@/components/Features/RuleEnvScopeBadges";
import RuleCard, { RuleCardSideColor } from "@/components/Features/RuleCard";
import useApi from "@/hooks/useApi";
import Callout from "@/ui/Callout";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import TruncatedConditionDisplay from "@/components/SavedGroups/TruncatedConditionDisplay";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import RemoveFromHoldoutModal from "./RemoveFromHoldoutModal";
import AddToHoldoutModal from "./AddToHoldoutModal";
import HoldoutSummary from "./HoldoutSummary";

interface Props {
  feature: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  mutate: () => void;
  setRuleModal: () => void;
  setVersion: (version: number) => void;
  isDeleted?: boolean;
  isLocked?: boolean;
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
      isLocked = false,
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
      linkedFeatures: FeatureInterface[];
      linkedExperiments: ExperimentInterfaceStringDates[];
      envs: string[];
    }>(`/holdout/${feature.holdout?.id}`, {
      shouldRun: () => !!feature.holdout?.id,
    });

    const permissionsUtil = usePermissionsUtil();

    const allEnvironments = useEnvironments();
    const environments = filterEnvironmentsByFeature(allEnvironments, feature);

    const holdout = data?.holdout;
    const holdoutExperiment = data?.experiment;

    if (!holdout || !holdoutExperiment) return null;

    // Holdout env scope lives on the holdout itself (not the feature link).
    // Show envs where the holdout is enabled as active, the rest as inactive.
    const activeHoldoutEnvIds = Object.entries(
      holdout.environmentSettings ?? {},
    )
      .filter(([, s]) => s?.enabled)
      .map(([id]) => id);

    const hasCondition = hasTargetingConfigured(holdoutExperiment.phases[0]);

    const canEdit =
      permissionsUtil.canViewFeatureModal(feature.project) &&
      permissionsUtil.canManageFeatureDrafts(feature);

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
        <RuleCard index={1} sideColor={sideColor}>
          <Flex
            justify="between"
            align="start"
            mb="3"
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
              {!isDeleted && (
                <ExperimentStatusIndicator experimentData={holdoutExperiment} />
              )}
            </Flex>

            <Flex align="center" gap="2" flexShrink="0">
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

              {canEdit && !isLocked && (
                <DropdownMenu
                  trigger={
                    <IconButton
                      variant="ghost"
                      color="gray"
                      radius="full"
                      size="2"
                      highContrast
                      style={{ marginRight: "calc(var(--space-2) * -1)" }}
                    >
                      <BsThreeDotsVertical size={16} />
                    </IconButton>
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
          <RuleEnvScopeBadges
            activeEnvironmentIds={activeHoldoutEnvIds}
            environments={environments}
            currentEnvironment={currentEnvironment}
          />
          <Box style={{ opacity: isInactive ? 0.6 : 1 }}>
            {isDeleted ? (
              <Callout status="error" size="sm">
                This feature has been removed from the holdout in the current
                draft. Publish or discard the draft to resolve.
              </Callout>
            ) : holdoutExperiment.status === "stopped" ? (
              <Callout status="info">
                This Holdout is stopped and this rule will be skipped.{" "}
                <Link href={`/holdout/${holdout.id}#results`}>
                  View Results
                </Link>
              </Callout>
            ) : null}
          </Box>
          {!isInactive && !isDeleted && (
            <Box style={{ opacity: isInactive ? 0.6 : 1 }} mt="3">
              {hasCondition && (
                <Flex align="center" justify="start" gap="3">
                  <Box pb="3">
                    <strong className="font-weight-semibold">IF</strong>
                  </Box>
                  <Box
                    width="100%"
                    flexShrink="4"
                    flexGrow="1"
                    overflowX="auto"
                    pb="3"
                  >
                    <TruncatedConditionDisplay
                      condition={holdoutExperiment.phases[0].condition || ""}
                      savedGroups={holdoutExperiment.phases[0].savedGroups}
                      prerequisites={holdoutExperiment.phases[0].prerequisites}
                      maxLength={500}
                    />
                  </Box>
                </Flex>
              )}
              <HoldoutSummary
                feature={feature}
                value={feature.holdout?.value || ""}
                hashAttribute={holdoutExperiment.hashAttribute || ""}
                holdoutWeight={
                  holdoutExperiment.phases[0].coverage *
                  holdoutExperiment.phases[0].variationWeights[0]
                }
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
