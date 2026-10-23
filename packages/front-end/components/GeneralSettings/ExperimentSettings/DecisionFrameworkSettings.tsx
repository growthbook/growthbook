import React, { useState } from "react";
import { useFormContext } from "react-hook-form";
import { Box, Flex } from "@radix-ui/themes";
import { FaPlusCircle } from "react-icons/fa";
import { DecisionCriteriaData } from "shared/types/experiment";
import {
  PRESET_DECISION_CRITERIA,
  PRESET_DECISION_CRITERIAS,
} from "shared/enterprise";
import Checkbox from "@/ui/Checkbox";
import Button from "@/ui/Button";
import Field from "@/components/Forms/Field";
import { SettingsField } from "@/components/GeneralSettings/SettingsGroup";
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
      <Box>
        <DocLink useRadix={false} docSection={"experimentDecisionFramework"}>
          View docs
        </DocLink>
      </Box>
      <Checkbox
        id="toggle-decisionFrameworkEnabled"
        label="Enable decision framework"
        value={
          !hasCommercialFeature("decision-framework")
            ? false
            : form.watch("decisionFrameworkEnabled")
        }
        setValue={(v) => form.setValue("decisionFrameworkEnabled", v)}
        disabled={!hasCommercialFeature("decision-framework")}
      />
      {hasCommercialFeature("decision-framework") &&
        form.watch("decisionFrameworkEnabled") && (
          <Flex direction="column" gap="4" pl="5">
            <SettingsField
              label="Minimum runtime"
              help="Experiments won't get a shipping recommendation before this."
            >
              <Box width="150px">
                <Field
                  size="md"
                  type="number"
                  append="days"
                  step="1"
                  min="0"
                  containerClassName="mb-0"
                  disabled={
                    !form.watch("decisionFrameworkEnabled") ||
                    !hasCommercialFeature("decision-framework")
                  }
                  {...form.register("experimentMinLengthDays", {
                    valueAsNumber: true,
                  })}
                />
              </Box>
            </SettingsField>
            <SettingsField
              label="Decision criteria"
              help="The org default is applied to new experiments."
            >
              <Flex justify="end" mb="2">
                <Button
                  variant="ghost"
                  size="sm"
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
            </SettingsField>
          </Flex>
        )}
    </>
  );
};

export default DecisionFrameworkSettings;
