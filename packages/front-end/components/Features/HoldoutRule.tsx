import { FeatureInterface } from "shared/types/feature";
import React, { forwardRef, useState } from "react";
import Link from "next/link";
import { Box, Card, Flex, Heading, IconButton } from "@radix-ui/themes";
import { HoldoutInterface } from "shared/validators";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { PiArrowBendRightDown } from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Badge from "@/ui/Badge";
import useApi from "@/hooks/useApi";
import Callout from "@/ui/Callout";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import TruncatedConditionDisplay from "@/components/SavedGroups/TruncatedConditionDisplay";
import Text from "@/ui/Text";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
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

    const [dropdownOpen, setDropdownOpen] = useState(false);

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
            <Flex align="start" justify="between" gap="3" p="1" pr="2">
              <Box style={{ width: ruleCount > 1 ? "14px" : "0px" }} />
              <Box>
                <Badge label={<>1</>} radius="full" color="gray" />
              </Box>
              <Box flexGrow="1" style={{ minWidth: 0, maxWidth: "100%" }}>
                <Flex
                  align="center"
                  justify="between"
                  mb="3"
                  flexGrow="1"
                  style={{ minWidth: 0, maxWidth: "100%" }}
                >
                  <Flex
                    flexGrow="1"
                    gap="3"
                    justify="between"
                    mr="3"
                    align="center"
                    style={{ minWidth: 0, maxWidth: "100%" }}
                  >
                    <Heading
                      as="h4"
                      size="3"
                      weight="medium"
                      mb="0"
                      className="w-100"
                      style={{
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        // prevent overflow-hidden from cutting off badge edges
                        marginTop: -10,
                        marginBottom: -10,
                        paddingTop: 10,
                        paddingBottom: 10,
                      }}
                    >
                      <Flex gap="3" align="center">
                        <div>Holdout: </div>
                        <Link href={`/holdout/${feature.holdout?.id}`}>
                          {holdout.name}
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
                    <DropdownMenu
                      trigger={
                        <IconButton
                          variant="ghost"
                          color="gray"
                          radius="full"
                          size="2"
                          highContrast
                          mt="1"
                        >
                          <BsThreeDotsVertical size={18} />
                        </IconButton>
                      }
                      open={dropdownOpen}
                      onOpenChange={setDropdownOpen}
                      menuPlacement="end"
                      variant="soft"
                    >
                      <DropdownMenuGroup>
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
                          confirmation={{
                            confirmationTitle: "Delete Holdout Rule",
                            cta: "Delete",
                            submit: async () => {
                              await apiCall(
                                `/holdout/${feature.holdout?.id}/feature/${feature.id}`,
                                {
                                  method: "DELETE",
                                },
                              );
                              await mutate();
                            },
                          }}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenu>
                  )}
                </Flex>
                <Box>{/* Callouts would go here if needed */}</Box>
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
                <Box style={{ opacity: isInactive ? 0.6 : 1 }} mt="3">
                  {hasCondition && (
                    <Box mb="3">
                      <TruncatedConditionDisplay
                        condition={holdoutExperiment.phases[0].condition || ""}
                        savedGroups={holdoutExperiment.phases[0].savedGroups}
                        prerequisites={
                          holdoutExperiment.phases[0].prerequisites
                        }
                        maxLength={500}
                        prefix={<Text weight="medium">IF</Text>}
                      />
                    </Box>
                  )}
                  {!isInactive && (
                    <HoldoutSummary
                      feature={feature}
                      value={feature.holdout?.value || ""}
                      hashAttribute={holdoutExperiment.hashAttribute || ""}
                      holdoutWeight={
                        holdoutExperiment.phases[0].coverage *
                          holdoutExperiment.phases[0].variationWeights[0] || 1
                      }
                    />
                  )}
                </Box>
              </Box>
            </Flex>
          </Card>
        </Box>
      </Box>
    );
  },
);
