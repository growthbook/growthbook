import { FC, useState } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import {
  DecisionFrameworkMetricOverrides,
  ExperimentInterfaceStringDates,
} from "back-end/types/experiment";
import Modal from "@/components/Modal";
import { ExperimentMetricInterfaceWithComputedTargetMDE } from "@/components/Experiment/TabbedPage/AnalysisSettings";
import Field from "@/components/Forms/Field";
import { useAuth } from "@/services/auth";
import Checkbox from "@/ui/Checkbox";

interface TargetMDEModalProps {
  goalsWithTargetMDE: ExperimentMetricInterfaceWithComputedTargetMDE[];
  onSubmit: () => void;
  onClose: () => void;
  experiment: Pick<
    ExperimentInterfaceStringDates,
    "id" | "decisionFrameworkSettings"
  >;
}

const TargetMDEModal: FC<TargetMDEModalProps> = ({
  goalsWithTargetMDE,
  onSubmit,
  onClose,
  experiment,
}) => {
  const decisionFrameworkMetricOverrides =
    experiment.decisionFrameworkSettings?.decisionFrameworkMetricOverrides;
  const [overrides, setOverrides] = useState<
    Record<string, DecisionFrameworkMetricOverrides>
  >(
    decisionFrameworkMetricOverrides?.reduce((acc, metric) => {
      acc[metric.id] = metric;
      return acc;
    }, {}) ?? {},
  );
  const { apiCall } = useAuth();

  const handleOverrideChange = (
    metricId: string,
    checked: boolean,
    targetMDE: number,
  ) => {
    setOverrides((prev) => {
      if (checked) {
        return {
          ...prev,
          [metricId]: { ...prev[metricId], id: metricId, targetMDE },
        };
      } else {
        const newOverride = { ...prev[metricId] };
        delete newOverride.targetMDE;
        // if only `id` is left, remove the override
        const remainingKeys = Object.keys(newOverride);
        if (remainingKeys.length === 1 && remainingKeys[0] === "id") {
          const newOverrides = { ...prev };
          delete newOverrides[metricId];
          return newOverrides;
        }
        return { ...prev, [metricId]: newOverride };
      }
    });
  };

  return (
    <Modal
      open={true}
      header="Edit Target MDEs"
      submit={() => {
        const newOverrides: DecisionFrameworkMetricOverrides[] =
          Object.values(overrides);
        apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify({
            decisionFrameworkSettings: {
              ...experiment.decisionFrameworkSettings,
              decisionFrameworkMetricOverrides: newOverrides,
            },
          }),
        }).then(() => {
          onSubmit();
        });
      }}
      close={onClose}
      size="md"
      trackingEventModalType="target-mde"
    >
      <Box mb="4">
        <Text>
          The Target Minimum Detectable Effect (MDE) is the smallest lift that
          you would like to reliably detect in the experiment. Smaller values
          require more data and longer run times, but the results will be more
          precise.
        </Text>
      </Box>
      <Flex direction="column" gap="3">
        {goalsWithTargetMDE.map((metric) => {
          const currentValue = metric.computedTargetMDE;
          const isOverridden = !!overrides[metric.id];
          return (
            <Box key={metric.id} className="p-3">
              <Flex direction="column" gap="2">
                <Flex direction="row" gap="2" justify="between">
                  <Text weight="bold">{metric.name}</Text>
                  <Flex align="center" gap="2">
                    <Checkbox
                      value={isOverridden}
                      setValue={(checked) =>
                        handleOverrideChange(
                          metric.id,
                          checked,
                          metric.computedTargetMDE,
                        )
                      }
                      label={`Override metric default`}
                      weight="regular"
                    />
                  </Flex>
                </Flex>
                <Field
                  type="number"
                  value={parseFloat(
                    (
                      (overrides[metric.id]?.targetMDE ?? currentValue) * 100
                    ).toFixed(9),
                  )}
                  onChange={(e) =>
                    handleOverrideChange(
                      metric.id,
                      isOverridden,
                      parseFloat(e.target.value) / 100,
                    )
                  }
                  step={"any"}
                  append="%"
                  min={0}
                  disabled={!isOverridden}
                />
              </Flex>
            </Box>
          );
        })}
      </Flex>
    </Modal>
  );
};

export default TargetMDEModal;
