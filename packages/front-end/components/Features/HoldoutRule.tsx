import { FeatureInterface } from "back-end/types/feature";
import React, { forwardRef } from "react";
import Link from "next/link";
import { Box, Card, Flex, Heading } from "@radix-ui/themes";
import { HoldoutInterface } from "back-end/src/routers/holdout/holdout.validators";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useAuth } from "@/services/auth";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Badge from "@/components/Radix/Badge";
import useApi from "@/hooks/useApi";
import ExperimentStatusIndicator from "../Experiment/TabbedPage/ExperimentStatusIndicator";
import HoldoutSummary from "./HoldoutSummary";
import ConditionDisplay from "./ConditionDisplay";

interface Props {
  feature: FeatureInterface;
  mutate: () => void;
  setRuleModal: () => void;
}

// eslint-disable-next-line
export const HoldoutRule = forwardRef<HTMLDivElement, Props>(
  ({ feature, setRuleModal, mutate, ...props }, ref) => {
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
                backgroundColor: "var(--green-9)",
              }}
            ></div>
            <Flex align="start" justify="between" gap="3" p="1" px="2">
              <Box style={{ width: "14px" }} />
              <Box>
                <Badge label={<>1</>} radius="full" color="gray" />
              </Box>
              <Box flexGrow="1" flexShrink="5" overflowX="auto">
                <Flex align="center" mb="3" flexGrow="1">
                  <Box flexGrow="1">
                    <Heading as="h4" size="3" weight="medium" mb="0">
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
                  </Box>
                </Flex>
                <Box style={{ opacity: 1 }} mt="3">
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
                        <ConditionDisplay
                          condition={
                            holdoutExperiment.phases[0].condition || ""
                          }
                          savedGroups={holdoutExperiment.phases[0].savedGroups}
                          prerequisites={
                            holdoutExperiment.phases[0].prerequisites
                          }
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
              </Box>
              <Flex>
                {canEdit && (
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
                        await apiCall<{ version: number }>(
                          `/feature/${feature.id}`,
                          {
                            method: "PUT",
                            body: JSON.stringify({
                              holdout: undefined,
                            }),
                          },
                        );
                        await mutate();
                      }}
                    />
                  </MoreMenu>
                )}
              </Flex>
            </Flex>
          </Card>
        </Box>
      </Box>
    );
  },
);
