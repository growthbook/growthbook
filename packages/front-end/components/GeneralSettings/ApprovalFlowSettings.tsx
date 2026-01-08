import React from "react";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { useFormContext } from "react-hook-form";
import { PiPlus, PiTrash } from "react-icons/pi";
import Frame from "@/ui/Frame";
import Checkbox from "@/ui/Checkbox";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import ApprovalFlowConditionInput, {
  ApprovalEntityType,
} from "@/components/ApprovalFlow/ApprovalFlowConditionInput";

interface ApprovalFlowSetting {
  requireReviewOn?: boolean;
  condition?: Record<string, unknown>;
  approverRoles?: string[];
  resetReviewOnChange?: boolean;
}

const DEFAULT_SETTING: ApprovalFlowSetting = {
  requireReviewOn: true,
  condition: {},
  approverRoles: [],
  resetReviewOnChange: false,
};

// Default member roles available in the system
const APPROVER_ROLE_OPTIONS = [
  { value: "readonly", label: "Read Only" },
  { value: "collaborator", label: "Collaborator" },
  { value: "visualEditor", label: "Visual Editor" },
  { value: "analyst", label: "Analyst" },
  { value: "engineer", label: "Engineer" },
  { value: "experimenter", label: "Experimenter" },
  { value: "admin", label: "Admin" },
];

export default function ApprovalFlowSettings() {
  const form = useFormContext();

  const addMetricSetting = () => {
    const currentSettings = form.watch("approvalFlow.metrics") || [];
    form.setValue("approvalFlow.metrics", [
      ...currentSettings,
      { ...DEFAULT_SETTING },
    ]);
  };

  const removeMetricSetting = (index: number) => {
    const currentSettings = form.watch("approvalFlow.metrics") || [];
    form.setValue(
      "approvalFlow.metrics",
      currentSettings.filter((_: unknown, i: number) => i !== index)
    );
  };

  const addFactTableSetting = () => {
    const currentSettings = form.watch("approvalFlow.factTables") || [];
    form.setValue("approvalFlow.factTables", [
      ...currentSettings,
      { ...DEFAULT_SETTING },
    ]);
  };

  const removeFactTableSetting = (index: number) => {
    const currentSettings = form.watch("approvalFlow.factTables") || [];
    form.setValue(
      "approvalFlow.factTables",
      currentSettings.filter((_: unknown, i: number) => i !== index)
    );
  };

  const metricSettings = form.watch("approvalFlow.metrics") || [];
  const factTableSettings = form.watch("approvalFlow.factTables") || [];

  return (
    <Frame>
      <Flex gap="4">
        <Box width="220px" flexShrink="0">
          <Heading size="4" as="h4">
            <PremiumTooltip commercialFeature="require-approvals">
              Approval Flow
            </PremiumTooltip>
          </Heading>
        </Box>
      </Flex>
      <Flex align="start" direction="column" flexGrow="1" pt="6">
        <Box mb="6" width="100%">
          <Box className="appbox p-4">
            <Flex justify="between" align="center" mb="4">
              <Heading size="3" className="font-weight-semibold">
                Metric Approval Settings
              </Heading>
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                onClick={addMetricSetting}
              >
                <PiPlus className="mr-1" /> Add Setting
              </button>
            </Flex>

            {metricSettings.length === 0 && (
              <Text size="2" color="gray" as="p">
                No metric approval settings configured. Click &quot;Add Setting&quot; to create one.
              </Text>
            )}

            {metricSettings.map((_: unknown, i: number) => (
                <Box
                  key={`metric-approval-flow-${i}`}
                  mb="4"
                  p="3"
                  style={{
                    border: "1px solid var(--gray-5)",
                    borderRadius: "var(--radius-2)",
                  }}
                >
                  <Flex justify="between" align="start" mb="3">
                    <Text size="2" weight="medium" color="gray">
                      Setting {i + 1}
                    </Text>
                    <button
                      type="button"
                      className="btn btn-link text-danger p-0"
                      onClick={() => removeMetricSetting(i)}
                      title="Remove setting"
                    >
                      <PiTrash size={16} />
                    </button>
                  </Flex>
                  <Flex gap="3" align="start">
                    <Box pt="1">
                      <Checkbox
                        id={`toggle-require-metric-reviews-${i}`}
                        value={
                          !!form.watch(
                            `approvalFlow.metrics.${i}.requireReviewOn`
                          )
                        }
                        setValue={(value) => {
                          form.setValue(
                            `approvalFlow.metrics.${i}.requireReviewOn`,
                            value
                          );
                        }}
                      />
                    </Box>
                    <Box width="100%">
                      <Text
                        as="label"
                        size="2"
                        className="font-weight-semibold"
                        htmlFor={`toggle-require-metric-reviews-${i}`}
                      >
                        Require approval to publish changes
                      </Text>

                      {!!form.watch(
                        `approvalFlow.metrics.${i}.requireReviewOn`
                      ) && (
                        <Box mt="4">
                          <Box mb="4">
                            <Text
                              as="label"
                              size="2"
                              className="font-weight-semibold d-block mb-2"
                            >
                              Targeting Conditions
                            </Text>
                            <Text
                              as="p"
                              size="1"
                              color="gray"
                              className="mb-3"
                            >
                              Define which metrics require approval based on
                              their properties
                            </Text>
                            <ApprovalFlowConditionInput
                              entityType={"metrics" as ApprovalEntityType}
                              value={
                                form.watch(
                                  `approvalFlow.metrics.${i}.condition`
                                ) as Record<string, unknown> | undefined
                              }
                              onChange={(condition) => {
                                form.setValue(
                                  `approvalFlow.metrics.${i}.condition`,
                                  condition
                                );
                              }}
                            />
                          </Box>

                          <Box mb="4">
                            <Text
                              as="label"
                              size="2"
                              htmlFor={`metric-approver-roles-${i}`}
                              className="font-weight-semibold d-block mb-2"
                            >
                              Approver Roles
                            </Text>
                            <MultiSelectField
                              id={`metric-approver-roles-${i}`}
                              value={
                                form.watch(
                                  `approvalFlow.metrics.${i}.approverRoles`
                                ) || []
                              }
                              onChange={(approverRoles) => {
                                form.setValue(
                                  `approvalFlow.metrics.${i}.approverRoles`,
                                  approverRoles
                                );
                              }}
                              options={APPROVER_ROLE_OPTIONS}
                              placeholder="All Roles (anyone can approve)"
                            />
                          </Box>

                          <Flex gap="3" align="center">
                            <Checkbox
                              id={`toggle-reset-metric-review-on-change-${i}`}
                              value={
                                !!form.watch(
                                  `approvalFlow.metrics.${i}.resetReviewOnChange`
                                )
                              }
                              setValue={(value) => {
                                form.setValue(
                                  `approvalFlow.metrics.${i}.resetReviewOnChange`,
                                  value
                                );
                              }}
                            />
                            <Text
                              as="label"
                              size="2"
                              className="font-weight-semibold"
                              htmlFor={`toggle-reset-metric-review-on-change-${i}`}
                            >
                              Reset review on changes
                            </Text>
                          </Flex>
                        </Box>
                      )}
                    </Box>
                  </Flex>
                </Box>
              ))}
          </Box>
        </Box>

        <Box mb="6" width="100%">
          <Box className="appbox p-4">
            <Flex justify="between" align="center" mb="4">
              <Heading size="3" className="font-weight-semibold">
                Fact Table Approval Settings
              </Heading>
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                onClick={addFactTableSetting}
              >
                <PiPlus className="mr-1" /> Add Setting
              </button>
            </Flex>

            {factTableSettings.length === 0 && (
              <Text size="2" color="gray" as="p">
                No fact table approval settings configured. Click &quot;Add Setting&quot; to create one.
              </Text>
            )}

            {factTableSettings.map((_: unknown, i: number) => (
                <Box
                  key={`fact-table-approval-flow-${i}`}
                  mb="4"
                  p="3"
                  style={{
                    border: "1px solid var(--gray-5)",
                    borderRadius: "var(--radius-2)",
                  }}
                >
                  <Flex justify="between" align="start" mb="3">
                    <Text size="2" weight="medium" color="gray">
                      Setting {i + 1}
                    </Text>
                    <button
                      type="button"
                      className="btn btn-link text-danger p-0"
                      onClick={() => removeFactTableSetting(i)}
                      title="Remove setting"
                    >
                      <PiTrash size={16} />
                    </button>
                  </Flex>
                  <Flex gap="3" align="start">
                    <Box pt="1">
                      <Checkbox
                        id={`toggle-require-fact-table-reviews-${i}`}
                        value={
                          !!form.watch(
                            `approvalFlow.factTables.${i}.requireReviewOn`
                          )
                        }
                        setValue={(value) => {
                          form.setValue(
                            `approvalFlow.factTables.${i}.requireReviewOn`,
                            value
                          );
                        }}
                      />
                    </Box>
                    <Box width="100%">
                      <Text
                        as="label"
                        size="2"
                        className="font-weight-semibold"
                        htmlFor={`toggle-require-fact-table-reviews-${i}`}
                      >
                        Require approval to publish changes
                      </Text>

                      {!!form.watch(
                        `approvalFlow.factTables.${i}.requireReviewOn`
                      ) && (
                        <Box mt="4">
                          <Box mb="4">
                            <Text
                              as="label"
                              size="2"
                              className="font-weight-semibold d-block mb-2"
                            >
                              Targeting Conditions
                            </Text>
                            <Text
                              as="p"
                              size="1"
                              color="gray"
                              className="mb-3"
                            >
                              Define which fact tables require approval based on
                              their properties
                            </Text>
                            <ApprovalFlowConditionInput
                              entityType={"factTables" as ApprovalEntityType}
                              value={
                                form.watch(
                                  `approvalFlow.factTables.${i}.condition`
                                ) as Record<string, unknown> | undefined
                              }
                              onChange={(condition) => {
                                form.setValue(
                                  `approvalFlow.factTables.${i}.condition`,
                                  condition
                                );
                              }}
                            />
                          </Box>

                          <Box mb="4">
                            <Text
                              as="label"
                              size="2"
                              htmlFor={`fact-table-approver-roles-${i}`}
                              className="font-weight-semibold d-block mb-2"
                            >
                              Approver Roles
                            </Text>
                            <MultiSelectField
                              id={`fact-table-approver-roles-${i}`}
                              value={
                                form.watch(
                                  `approvalFlow.factTables.${i}.approverRoles`
                                ) || []
                              }
                              onChange={(approverRoles) => {
                                form.setValue(
                                  `approvalFlow.factTables.${i}.approverRoles`,
                                  approverRoles
                                );
                              }}
                              options={APPROVER_ROLE_OPTIONS}
                              placeholder="All Roles (anyone can approve)"
                            />
                          </Box>

                          <Flex gap="3" align="center">
                            <Checkbox
                              id={`toggle-reset-fact-table-review-on-change-${i}`}
                              value={
                                !!form.watch(
                                  `approvalFlow.factTables.${i}.resetReviewOnChange`
                                )
                              }
                              setValue={(value) => {
                                form.setValue(
                                  `approvalFlow.factTables.${i}.resetReviewOnChange`,
                                  value
                                );
                              }}
                            />
                            <Text
                              as="label"
                              size="2"
                              className="font-weight-semibold"
                              htmlFor={`toggle-reset-fact-table-review-on-change-${i}`}
                            >
                              Reset review on changes
                            </Text>
                          </Flex>
                        </Box>
                      )}
                    </Box>
                  </Flex>
                </Box>
              ))}
          </Box>
        </Box>
      </Flex>
    </Frame>
  );
}
