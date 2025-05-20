import { FC, useState } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Modal from "@/components/Modal";
import { ExperimentMetricInterfaceWithComputedTargetMDE } from "@/components/Experiment/TabbedPage/AnalysisSettings";
import Field from "@/components/Forms/Field";
import { useAuth } from "@/services/auth";
import Checkbox from "@/components/Radix/Checkbox";

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
  const [overrides, setOverrides] = useState<Record<string, number>>(
    experiment.decisionFrameworkSettings?.goalMetricTargetMDEOverrides?.reduce(
      (acc, metric) => {
        acc[metric.id] = metric.targetMDE;
        return acc;
      },
      {}
    ) ?? {}
  );
  const { apiCall } = useAuth();

  const handleOverrideChange = (
    metricId: string,
    checked: boolean,
    targetMDE: number
  ) => {
    setOverrides((prev) => {
      if (checked) {
        return { ...prev, [metricId]: targetMDE };
      } else {
        const newOverrides = { ...prev };
        delete newOverrides[metricId];
        return newOverrides;
      }
    });
  };

  return (
    <Modal
      open={true}
      header="Edit Target MDEs"
      submit={() => {
        const newOverrides = Object.entries(
          overrides
        ).map(([id, targetMDE]) => ({ id, targetMDE }));
        apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify({
            decisionFrameworkSettings: {
              ...experiment.decisionFrameworkSettings,
              goalMetricTargetMDEOverrides: newOverrides,
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
                          metric.computedTargetMDE
                        )
                      }
                      label={`Override metric default`}
                      weight="regular"
                    />
                  </Flex>
                </Flex>
                <Field
                  type="number"
                  value={(overrides[metric.id] ?? currentValue) * 100}
                  onChange={(e) =>
                    handleOverrideChange(
                      metric.id,
                      isOverridden,
                      parseFloat(e.target.value) / 100
                    )
                  }
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
