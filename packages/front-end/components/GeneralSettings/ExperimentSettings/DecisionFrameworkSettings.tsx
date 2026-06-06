import React, { useState } from "react";
import { useFormContext } from "react-hook-form";
import { Box, Flex, Heading, Text, Tooltip } from "@radix-ui/themes";
import { FaPlusCircle } from "react-icons/fa";
import { DecisionCriteriaData } from "shared/types/experiment";
import {
  PRESET_DECISION_CRITERIA,
  PRESET_DECISION_CRITERIAS,
} from "shared/enterprise";
import Checkbox from "@/ui/Checkbox";
import Button from "@/ui/Button";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { GBInfo } from "@/components/Icons";
import { DocLink } from "@/components/DocLink";
import DecisionCriteriaTable from "@/components/DecisionCriteria/DecisionCriteriaTable";
import DecisionCriteriaModal from "@/components/DecisionCriteria/DecisionCriteriaModal";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";
import Modal from "@/components/Modal";
import { useAuth } from "@/services/auth";

const DecisionFrameworkSettings = () => {
  const { hasCommercialFeature } = useUser();
  const form = useFormContext();

  const { data, mutate } = useApi<{
    status: number;
    decisionCriteria: DecisionCriteriaData[];
  }>("/decision-criteria");

  const { apiCall } = useAuth();

  const [decisionCriteriaProps, setDecisionCriteriaProps] = useState<{
    open: boolean;
    editable: boolean;
    selectedCriteria: DecisionCriteriaData | undefined;
  }>({
    open: false,
    editable: true,
    selectedCriteria: undefined,
  });

  const [criteriaToDelete, setCriteriaToDelete] = useState<
    DecisionCriteriaData | undefined
  >(undefined);
  const isEditable = (criteria: DecisionCriteriaData) =>
    !criteria.id.startsWith("gbdeccrit_");

  return (
    <>
      {decisionCriteriaProps.open && (
        <DecisionCriteriaModal
          decisionCriteria={decisionCriteriaProps.selectedCriteria}
          onClose={() =>
            setDecisionCriteriaProps({ ...decisionCriteriaProps, open: false })
          }
          editable={decisionCriteriaProps.editable}
          trackingEventModalSource="experiment_settings"
          mutate={mutate}
        />
      )}

      {criteriaToDelete && (
        <Modal
          header="Delete Decision Criteria"
          trackingEventModalType="delete-decision-criteria"
          open={true}
          close={() => setCriteriaToDelete(undefined)}
          cta="Delete"
          submitColor="danger"
          submit={async () => {
            try {
              await apiCall<{ status: number; message?: string }>(
                `/decision-criteria/${criteriaToDelete.id}`,
                {
                  method: "DELETE",
                  body: JSON.stringify({ id: criteriaToDelete.id }),
                },
              );
              mutate();
              setCriteriaToDelete(undefined);
            } catch (e) {
              console.error(e);
            }
          }}
        >
          <div>
            <p>
              Are you sure you want to delete the <b>{criteriaToDelete.name}</b>{" "}
              decision criteria?
            </p>
          </div>
        </Modal>
      )}
      <Box className="appbox p-3">
        <Flex justify="between">
          <Heading size="3" className="font-weight-semibold" mb="4">
            Experiment Decision Framework
            <PremiumTooltip
              commercialFeature="decision-framework"
              style={{ display: "inline-flex" }}
            />
          </Heading>
          <Box>
            <Text wrap="nowrap">
              <DocLink docSection={"experimentDecisionFramework"}>
                View Docs
              </DocLink>
            </Text>
          </Box>
        </Flex>
        <Box mb="4">
          <Text size="2" style={{ color: "var(--color-text-mid)" }}>
            Evaluates metric and guardrail signals to guide experiment decisions
            — ship, rollback, or hold — with optional automation.
          </Text>
        </Box>
        <Flex
          display="inline-flex"
          gap="3"
          mb="4"
          align="center"
          justify="center"
        >
          <Checkbox
            mb="0"
            value={
              !hasCommercialFeature("decision-framework")
                ? false
                : form.watch("decisionFrameworkEnabled")
            }
            setValue={(v) => form.setValue("decisionFrameworkEnabled", v)}
            id="toggle-decisionFrameworkEnabled"
            disabled={!hasCommercialFeature("decision-framework")}
          />
          <Box>
            <label
              htmlFor="toggle-decisionFrameworkEnabled"
              className="font-weight-semibold mb-0"
            >
              Enable experiment decision framework
            </label>
          </Box>
        </Flex>
        {hasCommercialFeature("decision-framework") &&
          form.watch("decisionFrameworkEnabled") && (
            <>
              <Box mt="3" mb="3">
                <Heading size="2">
                  Minimum experiment runtime
                  <Tooltip content="Estimated duration and shipping recommendations are not made until an experiment has been running for this many days.">
                    <Flex
                      ml="2"
                      display="inline-flex"
                      style={{ verticalAlign: "middle" }}
                    >
                      <GBInfo />
                    </Flex>
                  </Tooltip>
                </Heading>
                <Box width="150px">
                  <Field
                    type="number"
                    append="days"
                    step="1"
                    min="0"
                    disabled={
                      !form.watch("decisionFrameworkEnabled") ||
                      !hasCommercialFeature("decision-framework")
                    }
                    {...form.register("experimentMinLengthDays", {
                      valueAsNumber: true,
                    })}
                  />
                </Box>
              </Box>
              <Flex align="start" direction="column">
                <Box mb="4">
                  <Flex align="center" gap="1" justify="between">
                    <Heading size="2" mb="2">
                      Default Decision Criteria
                    </Heading>
                    <Box mb="4">
                      <Button
                        variant="ghost"
                        mt="3"
                        onClick={() => {
                          setDecisionCriteriaProps({
                            open: true,
                            editable: true,
                            selectedCriteria: undefined,
                          });
                        }}
                      >
                        <Flex align="center" gap="1">
                          <FaPlusCircle size={12} />
                          <span>Add custom</span>
                        </Flex>
                      </Button>
                    </Box>
                  </Flex>

                  <DecisionCriteriaTable
                    defaultCriteriaId={
                      form.watch("defaultDecisionCriteriaId") ||
                      PRESET_DECISION_CRITERIA.id
                    }
                    setDefaultCriteriaId={(id) =>
                      form.setValue("defaultDecisionCriteriaId", id)
                    }
                    decisionCriterias={[
                      ...PRESET_DECISION_CRITERIAS,
                      ...(data?.decisionCriteria || []),
                    ]}
                    onViewEditClick={(criteria: DecisionCriteriaData) => {
                      setDecisionCriteriaProps({
                        open: true,
                        editable: isEditable(criteria),
                        selectedCriteria: criteria,
                      });
                    }}
                    onDeleteClick={(criteria) => {
                      setCriteriaToDelete(criteria);
                    }}
                    isEditable={isEditable}
                  />
                </Box>
              </Flex>

              <Box mt="5" mb="3">
                <Heading size="2" mb="3">
                  Experiment Automation Defaults
                </Heading>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "180px 280px",
                    gap: "12px 16px",
                    alignItems: "center",
                  }}
                >
                  <Text as="div" weight="medium">
                    Shipping
                  </Text>
                  <SelectField
                    value={form.watch("defaultShippingCriteriaMode") ?? "off"}
                    onChange={(v) =>
                      form.setValue("defaultShippingCriteriaMode", v)
                    }
                    options={[
                      {
                        value: "off",
                        label: "Manual",
                      },
                      {
                        value: "auto",
                        label: "Auto-ship clear winner",
                      },
                      {
                        value: "auto-force",
                        label: "Auto-ship on end date regardless",
                      },
                    ]}
                    sort={false}
                    isSearchable={false}
                  />

                  <Text as="div" weight="medium">
                    Rollbacks
                  </Text>
                  <SelectField
                    value={form.watch("defaultAutoRollbackMode") ?? "off"}
                    onChange={(v) =>
                      form.setValue("defaultAutoRollbackMode", v)
                    }
                    options={[
                      { value: "off", label: "Manual" },
                      { value: "all", label: "Automatic" },
                      {
                        value: "health-only",
                        label: "Automatic for health signals only",
                      },
                    ]}
                    sort={false}
                    isSearchable={false}
                  />

                  <Text as="div" weight="medium">
                    Ramp schedules
                  </Text>
                  <SelectField
                    value={
                      form.watch("defaultRampProgressionMode") ?? "standard"
                    }
                    onChange={(v) =>
                      form.setValue("defaultRampProgressionMode", v)
                    }
                    options={[
                      { value: "standard", label: "Standard progression" },
                      {
                        value: "hold-for-health",
                        label: "Hold for health signals",
                      },
                    ]}
                    sort={false}
                    isSearchable={false}
                  />
                </div>
              </Box>
            </>
          )}
      </Box>
    </>
  );
};

export default DecisionFrameworkSettings;
