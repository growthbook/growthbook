import { useState } from "react";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import { StatsEngineSettings } from "shared/power";
import Collapsible from "react-collapsible";
import { PiCaretRightFill } from "react-icons/pi";
import useOrgSettings from "@/hooks/useOrgSettings";
import Modal from "@/components/Modal";
import RadioGroup from "@/ui/RadioGroup";
import Field from "@/components/Forms/Field";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import usePValueThreshold from "@/hooks/usePValueThreshold";

type StatsEngineWithSequential = "bayesian" | "frequentist" | "sequential";

export type StatsEngineSettingsWithAlpha = StatsEngineSettings & {
  alpha: number;
};

export function alphaToChanceToWin(alpha: number): number {
  return parseFloat((100 * (1 - alpha)).toFixed(6));
}

export function chanceToWinToAlpha(chanceToWin: number): number {
  return parseFloat(((100 - chanceToWin) / 100).toFixed(6));
}

export type Props = {
  close: () => void;
  params: StatsEngineSettingsWithAlpha;
  onSubmit: (_: StatsEngineSettingsWithAlpha) => void;
};

export default function PowerCalculationStatsEngineSettingsModal({
  close,
  params,
  onSubmit,
}: Props) {
  const orgSettings = useOrgSettings();
  const pValueThresholdOrgDefault = usePValueThreshold();
  const { ciLower: ciLowerOrgDefault, ciUpper: ciUpperOrgDefault } =
    useConfidenceLevels();

  const sequentialTestingTuningParameter =
    orgSettings.sequentialTestingTuningParameter ||
    DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER;
  const [currentParams, setCurrentParams] = useState(params);
  // separate state to handle undefined value better and for formatting
  const [pValueThreshold, setPValueThreshold] = useState<number | undefined>(
    params.alpha,
  );
  const [ciUpperPercent, setCiUpperPercent] = useState<number | undefined>(
    alphaToChanceToWin(params.alpha),
  );

  const defaultAlpha =
    params.type === "frequentist"
      ? pValueThresholdOrgDefault
      : ciLowerOrgDefault;
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
            const unsetThreshold =
              (type === "bayesian" && currentParams.type === "frequentist") ||
              (type !== "bayesian" && currentParams.type === "bayesian");
            // reset threshold if changing engine
            if (unsetThreshold) {
              setCiUpperPercent(undefined);
              setPValueThreshold(undefined);
            }
            setCurrentParams({
              type: type === "sequential" ? "frequentist" : type,
              sequentialTesting:
                type === "sequential"
                  ? sequentialTestingTuningParameter
                  : false,
              alpha: unsetThreshold ? defaultAlpha : params.alpha,
            });
          }}
          mt="3"
        />
      </div>
      <Collapsible
        trigger={
          <div className="link-purple font-weight-bold mt-4 mb-2">
            <PiCaretRightFill className="chevron mr-1" />
            Advanced Settings
          </div>
        }
        transitionTime={100}
      >
        <div className="rounded px-3 pt-3 pb-1 bg-highlight">
          {currentParams.type === "frequentist" ? (
            <Field
              label="P-value threshold"
              type="number"
              step="0.001"
              max="0.5"
              min="0.001"
              className="ml-2"
              containerClassName="mb-3"
              value={pValueThreshold?.toString() || ""}
              placeholder={pValueThresholdOrgDefault.toString()}
              onChange={(e) => {
                const value =
                  e.target.value === ""
                    ? undefined
                    : parseFloat(e.target.value);
                setPValueThreshold(value);
                setCurrentParams({
                  ...currentParams,
                  alpha: value ?? defaultAlpha,
                });
              }}
              helpText={
                <span className="ml-2">
                  ({pValueThresholdOrgDefault} is your organization default)
                </span>
              }
            />
          ) : null}
          {currentParams.type === "bayesian" ? (
            <Field
              label="Chance to win threshold"
              type="number"
              step="any"
              min="70"
              max="99.999999"
              className="ml-2"
              containerClassName="mb-3"
              append="%"
              value={ciUpperPercent?.toString() || ""}
              placeholder={(100 * ciUpperOrgDefault).toString()}
              onChange={(e) => {
                const value =
                  e.target.value === ""
                    ? undefined
                    : parseFloat(e.target.value);
                setCiUpperPercent(value);
                setCurrentParams({
                  ...currentParams,
                  alpha: value ? chanceToWinToAlpha(value) : defaultAlpha,
                });
              }}
              helpText={
                <span className="ml-2">
                  ({100 * ciUpperOrgDefault}% is your organization default)
                </span>
              }
            />
          ) : null}
        </div>
      </Collapsible>
    </Modal>
  );
}
