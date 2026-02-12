import { FeatureInterface } from "shared/types/feature";
import React, { forwardRef } from "react";
import Link from "next/link";
import { Box, Card, Flex, Heading } from "@radix-ui/themes";
import { HoldoutInterface } from "shared/validators";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { PiArrowBendRightDown, PiArrowSquareOut } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Badge from "@/ui/Badge";
import useApi from "@/hooks/useApi";
import Callout from "@/ui/Callout";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import TruncatedConditionDisplay from "@/components/SavedGroups/TruncatedConditionDisplay";
import HoldoutSummary from "./HoldoutSummary";

interface Props {
  feature: FeatureInterface;
  mutate: () => void;
  setRuleModal: () => void;
  ruleCount: number;
}

// eslint-disable-next-line
export const HoldoutRule = forwardRef<HTMLDivElement, Props>(
  ({ feature, setRuleModal, mutate, ruleCount, ...props }, ref) => {
    const { apiCall } = useAuth();

    const { data } = useApi<{
      holdout: HoldoutInterface;
      experiment: ExperimentInterfaceStringDates;
      linkedFeatures: FeatureInterface[];
      linkedExperiments: ExperimentInterfaceStringDates[];
      envs: string[];
    }>(`/holdout/${feature.holdout?.id}`);

    const permissionsUtil = usePermissionsUtil();

    const holdout = data?.holdout;
    const holdoutExperiment = data?.experiment;

    if (!holdout || !holdoutExperiment) return null;

    const hasCondition =
      (holdoutExperiment.phases[0].condition &&
        holdoutExperiment.phases[0].condition !== "{}") ||
      !!holdoutExperiment.phases[0].savedGroups?.length ||
      !!holdoutExperiment.phases[0].prerequisites?.length;

    const canEdit =
      permissionsUtil.canViewFeatureModal(feature.project) &&
      permissionsUtil.canManageFeatureDrafts(feature);

    const isInactive =
      holdoutExperiment.status === "stopped" || holdoutExperiment.archived;

    return (
      <Box {...props} ref={ref}>
        <Box mt="3">
          <Card>
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: "4px",
                backgroundColor: isInactive
                  ? "var(--amber-7)"
                  : "var(--green-9)",
              }}
            ></div>
            <Flex align="start" justify="between" gap="3" p="1" px="2">
              <Box style={{ width: ruleCount > 1 ? "14px" : "0px" }} />
              <Box>
                <Badge label={<>1</>} radius="full" color="gray" />
              </Box>
              <Box flexGrow="1" pr="2">
                <Flex align="center" justify="between" mb="3" flexGrow="1">
                  <Flex
                    flexGrow="1"
                    gap="3"
                    justify="between"
                    mr="3"
                    align="center"
                  >
                    <Heading as="h4" size="3" weight="medium" mb="0">
                      <Flex gap="3" align="center">
                        <div>Holdout: </div>
                        <Link href={`/holdout/${feature.holdout?.id}`}>
                          {holdout.name}
                          <PiArrowSquareOut className="ml-1" />
                        </Link>
                        <ExperimentStatusIndicator
                          experimentData={holdoutExperiment}
                        />
                      </Flex>
                    </Heading>
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
                  </Flex>
                  {canEdit && (
                    <Flex>
                      <MoreMenu useRadix={true} size={14}>
                        <a
                          href="#"
                          className="dropdown-item"
                          onClick={(e) => {
                            e.preventDefault();
                            setRuleModal();
                          }}
                        >
                          Edit
                        </a>
                        {/* Do we want to delete holdouts? Do we want a confirmation modal? */}
                        <DeleteButton
                          className="dropdown-item"
                          displayName="Rule"
                          useIcon={false}
                          text="Delete"
                          onClick={async () => {
                            await apiCall(
                              `/holdout/${feature.holdout?.id}/feature/${feature.id}`,
                              {
                                method: "DELETE",
                              },
                            );
                            await mutate();
                          }}
                        />
                      </MoreMenu>
                    </Flex>
                  )}
                </Flex>
                <Box style={{ opacity: isInactive ? 0.6 : 1 }}>
                  {holdoutExperiment.status === "stopped" && (
                    <Callout status="info">
                      This Holdout is stopped and this rule will be skipped.{" "}
                      <Link href={`/holdout/${holdout.id}#results`}>
                        View Results
                      </Link>
                    </Callout>
                  )}
                </Box>
                {!isInactive && (
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
                            condition={
                              holdoutExperiment.phases[0].condition || ""
                            }
                            savedGroups={
                              holdoutExperiment.phases[0].savedGroups
                            }
                            project={feature.project}
                            prerequisites={
                              holdoutExperiment.phases[0].prerequisites
                            }
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
                          holdoutExperiment.phases[0].variationWeights[0] || 1
                      }
                    />
                  </Box>
                )}
              </Box>
            </Flex>
          </Card>
        </Box>
      </Box>
    );
  },
);
