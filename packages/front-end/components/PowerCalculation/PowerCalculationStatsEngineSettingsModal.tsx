import { useState } from "react";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import { StatsEngineSettings } from "shared/power";
import useOrgSettings from "@/hooks/useOrgSettings";
import Modal from "@/components/Modal";
import RadioGroup from "@/components/Radix/RadioGroup";

type StatsEngineWithSequential = "bayesian" | "frequentist" | "sequential";

export type Props = {
  close: () => void;
  params: StatsEngineSettings;
  onSubmit: (_: StatsEngineSettings) => void;
};

export default function PowerCalculationStatsEngineSettingsModal({
  close,
  params,
  onSubmit,
}: Props) {
  const orgSettings = useOrgSettings();
  const sequentialTestingTuningParameter =
    orgSettings.sequentialTestingTuningParameter ||
    DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER;
  const [currentParams, setCurrentParams] = useState(params);
  const currentEngine =
    currentParams.type === "bayesian"
      ? "bayesian"
      : currentParams.sequentialTesting
        ? "sequential"
        : "frequentist";

  return (
    <Modal
      trackingEventModalType=""
      open
      size="lg"
      header="Choose Statistics Engine"
      close={close}
      includeCloseCta={false}
      cta="Update"
      secondaryCTA={
        <button className="btn btn-link" onClick={close}>
          Cancel
        </button>
      }
      tertiaryCTA={
        <button
          className="btn btn-primary"
          onClick={() => onSubmit(currentParams)}
        >
          Update
        </button>
      }
    >
      <div>
        <RadioGroup
          value={currentEngine}
          options={[
            {
              value: "bayesian",
              label: `Bayesian${
                orgSettings.statsEngine === "bayesian" ? " (Org default)" : ""
              }`,
            },
            {
              value: "frequentist",
              label: `Frequentist${
                orgSettings.statsEngine === "frequentist" &&
                !orgSettings.sequentialTestingEnabled
                  ? " (Org default)"
                  : ""
              }`,
            },
            {
              value: "sequential",
              label: `Frequentist, with Sequential Testing${
                orgSettings.statsEngine === "frequentist" &&
                orgSettings.sequentialTestingEnabled
                  ? " (Org default)"
                  : ""
              }`,
              description: `Sequential Testing enables safe peeking at results but makes confidence intervals wider.`,
            },
          ]}
          setValue={(type: StatsEngineWithSequential) => {
            setCurrentParams({
              type: type === "sequential" ? "frequentist" : type,
              sequentialTesting:
                type === "sequential"
                  ? sequentialTestingTuningParameter
                  : false,
            });
          }}
          mt="3"
        />
      </div>
    </Modal>
  );
}
