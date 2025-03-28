import React, { useState } from "react";
import { useFormContext } from "react-hook-form";
import { Box, Flex, Heading, Text, Tooltip } from "@radix-ui/themes";
import { FaPlusCircle } from "react-icons/fa";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { DecisionCriteriaData } from "back-end/types/experiment";
import {
  DEFAULT_DECISION_CRITERIA,
  DEFAULT_DECISION_CRITERIAS,
} from "shared/enterprise";
import Checkbox from "@/components/Radix/Checkbox";
import Button from "@/components/Radix/Button";
import Field from "@/components/Forms/Field";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { GBInfo } from "@/components/Icons";
import { DocLink } from "@/components/DocLink";
import DecisionCriteriaTable from "@/components/DecisionCriteria/DecisionCriteriaTable";
import DecisionCriteriaModal from "@/components/DecisionCriteria/DecisionCriteriaModal";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";

interface DecisionFrameworkSettingsProps {
  // No specific props needed as we use form context
}

const DecisionFrameworkSettings: React.FC<DecisionFrameworkSettingsProps> = () => {
  const { hasCommercialFeature } = useUser();
  const form = useFormContext();

  const gb = useGrowthBook();

  const { data, mutate } = useApi<{
    status: number;
    decisionCriteria: DecisionCriteriaData[];
  }>("/decision-criteria");

  const [decisionCriteriaModalOpen, setDecisionCriteriaModalOpen] = useState(
    false
  );
  const [selectedCriteria, setSelectedCriteria] = useState<
    DecisionCriteriaData | undefined
  >(undefined);
  const [
    decisionCriteriaModalDisabled,
    setDecisionCriteriaModalDisabled,
  ] = useState(false);

  return (
    <>
      {decisionCriteriaModalOpen && (
        <DecisionCriteriaModal
          open={decisionCriteriaModalOpen}
          decisionCriteria={selectedCriteria}
          onClose={() => setDecisionCriteriaModalOpen(false)}
          disabled={decisionCriteriaModalDisabled}
          trackingEventModalSource="experiment_settings"
          mutate={mutate}
        />
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
              {gb.isOn("decision-framework-criteria") ? (
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
                            setSelectedCriteria(undefined);
                            setDecisionCriteriaModalOpen(true);
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
                        form.watch("defaultDecisionCriteriaId") ??
                        DEFAULT_DECISION_CRITERIA.id
                      }
                      setDefaultCriteriaId={(id) =>
                        form.setValue("defaultDecisionCriteriaId", id)
                      }
                      selectedCriteria={selectedCriteria}
                      setSelectedCriteria={setSelectedCriteria}
                      setDecisionCriteriaModalDisabled={
                        setDecisionCriteriaModalDisabled
                      }
                      setDecisionCriteriaModalOpen={
                        setDecisionCriteriaModalOpen
                      }
                      decisionCriterias={[
                        ...DEFAULT_DECISION_CRITERIAS,
                        ...(data?.decisionCriteria || []),
                      ]}
                      mutate={mutate}
                    />
                  </Box>
                </Flex>
              ) : null}
            </>
          )}
      </Box>
    </>
  );
};

export default DecisionFrameworkSettings;
