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
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { GBInfo } from "@/components/Icons";
import { DocLink } from "@/components/DocLink";
import DecisionCriteriaTable from "@/components/DecisionCriteria/DecisionCriteriaTable";
import DecisionCriteriaModal from "@/components/DecisionCriteria/DecisionCriteriaModal";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";
import Modal from "@/components/Modal";
import { useAuth } from "@/services/auth";

interface DecisionFrameworkSettingsProps {
  // No specific props needed as we use form context
}

const DecisionFrameworkSettings: React.FC<
  DecisionFrameworkSettingsProps
> = () => {
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
  // Check if a criteria is editable (user created vs. system)
  const isEditable = (criteria: DecisionCriteriaData) => {
    return !criteria.id.startsWith("gbdeccrit_");
  };

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
            Calculates the estimated duration of your experiment using target
            minimum detectable effects and makes shipping recommendations.
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
            </>
          )}
      </Box>
    </>
  );
};

export default DecisionFrameworkSettings;
