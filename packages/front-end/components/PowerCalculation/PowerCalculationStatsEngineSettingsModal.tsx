import { useState } from "react";
import { FaExternalLinkAlt } from "react-icons/fa";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import Tooltip from "@/components/Tooltip/Tooltip";
import RadioSelector from "@/components/Forms/RadioSelector";
import { DocLink } from "@/components/DocLink";
import Toggle from "@/components/Forms/Toggle";
import useOrgSettings from "@/hooks/useOrgSettings";
import Modal from "@/components/Modal";
import { StatsEngineSettings } from "./types";

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

  return (
    <Modal
      open
      size="lg"
      header="Analysis Settings"
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
      <div className="form-group">
        <label>
          <span className="mr-auto font-weight-bold">
            Choose Statistical Engine
          </span>{" "}
          <Tooltip
            popperClassName="text-left"
            body="The Beta version of the Power Calculator uses frequentist methods"
            tipPosition="right"
          />
        </label>
        <RadioSelector
          name="ruleType"
          value={currentParams.type}
          options={[
            {
              key: "bayesian",
              description: (
                <div className="container">
                  <div className="row">
                    <span className="text-muted mr-1">Bayesian</span>
                    {orgSettings.statsEngine === "bayesian"
                      ? "(Org default)"
                      : ""}
                  </div>
                </div>
              ),
            },
            {
              key: "frequentist",
              description: (
                <div className="container">
                  <div className="row">
                    <span className="mr-1 font-weight-bold">Frequentist</span>
                    {orgSettings.statsEngine === "frequentist"
                      ? "(Org default)"
                      : ""}
                  </div>
                  <div className="row mt-2">
                    <span>
                      Enable Sequential Testing to look at your experiment
                      results as many times as you like while preserving the
                      false positive rate.{" "}
                      <DocLink docSection="statisticsSequential">
                        Learn More <FaExternalLinkAlt />
                      </DocLink>
                    </span>
                    <div className="mt-3 form-group">
                      <div className="row align-items-start">
                        <div className="col-auto">
                          <Toggle
                            id="sequentialTestingToggle"
                            value={!!currentParams.sequentialTesting}
                            setValue={(value) =>
                              setCurrentParams({
                                ...currentParams,
                                ...(value
                                  ? {
                                      sequentialTesting: sequentialTestingTuningParameter,
                                    }
                                  : { sequentialTesting: false }),
                              })
                            }
                          />
                        </div>
                        <div>
                          <div>
                            <span className="font-weight-bold">
                              Sequential Testing
                            </span>{" "}
                            (Org default:{" "}
                            {orgSettings.sequentialTestingEnabled
                              ? "ON"
                              : "OFF"}
                            )
                          </div>
                          <div className="mt-2">
                            Results will be calculated with the org’s default
                            tuning parameter: {sequentialTestingTuningParameter}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ),
            },
          ]}
          setValue={(type: typeof currentParams.type) =>
            setCurrentParams({ ...currentParams, type })
          }
        />
      </div>
    </Modal>
  );
}
