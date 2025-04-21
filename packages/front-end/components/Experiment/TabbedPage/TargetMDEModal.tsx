import { FC, useState } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { DEFAULT_TARGET_MDE } from "shared/constants";
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
    "id" | "metricTargetMDEOverrides"
  >;
}

const TargetMDEModal: FC<TargetMDEModalProps> = ({
  goalsWithTargetMDE,
  onSubmit,
  onClose,
  experiment,
}) => {
  const [overrides, setOverrides] = useState<Record<string, number>>(
    experiment.metricTargetMDEOverrides?.reduce((acc, metric) => {
      acc[metric.id] = metric.targetMDE;
      return acc;
    }, {}) ?? {}
  );
  const [values, setValues] = useState<Record<string, number>>(
    goalsWithTargetMDE.reduce((acc, metric) => {
      const override = overrides[metric.id];
      acc[metric.id] = override ?? metric.metricTargetMDE;
      return acc;
    }, {})
  );

  const { apiCall } = useAuth();

  const handleOverrideChange = (metricId: string, checked: boolean) => {
    setOverrides((prev) => {
      if (checked) {
        return { ...prev, [metricId]: values[metricId] ?? DEFAULT_TARGET_MDE };
      } else {
        const newOverrides = { ...prev };
        delete newOverrides[metricId];
        return newOverrides;
      }
    });
  };

  const handleValueChange = (metricId: string, value: string) => {
    const numValue = parseFloat(value);
    if (!isNaN(numValue)) {
      setValues((prev) => ({ ...prev, [metricId]: numValue / 100 }));
    }
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
          body: JSON.stringify({ metricTargetMDEOverrides: newOverrides }),
        }).then(() => {
          onSubmit();
        });
      }}
      close={onClose}
      size="md"
      trackingEventModalType="target-mde"
    >
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
                        handleOverrideChange(metric.id, checked as boolean)
                      }
                      label={`Override metric default`}
                      weight="regular"
                    />
                  </Flex>
                </Flex>
                <Field
                  type="number"
                  value={((values[metric.id] ?? currentValue) * 100).toFixed(2)}
                  onChange={(e) => handleValueChange(metric.id, e.target.value)}
                  append="%"
                  min={0}
                  step={0.000001}
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
