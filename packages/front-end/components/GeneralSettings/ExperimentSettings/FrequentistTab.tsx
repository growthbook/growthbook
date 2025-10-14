import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import { FaExclamationTriangle } from "react-icons/fa";
import { PValueCorrection } from "back-end/types/stats";
import Field from "@/components/Forms/Field";
import Switch from "@/ui/Switch";
import SelectField from "@/components/Forms/SelectField";
import { GBSequential } from "@/components/Icons";
import { hasFileConfig } from "@/services/env";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { StatsEngineSettingsForm } from "./StatsEngineSettings";

export default function FrequentistTab({
  pHighlightColor,
  pWarningMsg,
  form,
}: {
  pHighlightColor: string;
  pWarningMsg: string;
  form: StatsEngineSettingsForm;
}) {
  const { hasCommercialFeature } = useUser();

  return (
    <>
      <h4 className="mb-4 text-purple">Frequentist Settings</h4>

      <div className="form-group mb-2 mr-2 form-inline">
        <Field
          label="P-value threshold"
          type="number"
          step="0.001"
          max="0.5"
          min="0.001"
          style={{
            borderColor: pHighlightColor,
            backgroundColor: pHighlightColor ? pHighlightColor + "15" : "",
          }}
          className={`ml-2`}
          containerClassName="mb-3"
          append=""
          disabled={hasFileConfig()}
          helpText={
            <>
              <span className="ml-2">(0.05 is default)</span>
              <div
                className="ml-2"
                style={{
                  color: pHighlightColor,
                  flexBasis: "100%",
                }}
              >
                {pWarningMsg}
              </div>
            </>
          }
          {...form.register("pValueThreshold", {
            valueAsNumber: true,
            min: 0,
            max: 1,
          })}
        />
      </div>
      <div className="mb-3  form-inline flex-column align-items-start">
        <SelectField
          label={"Multiple comparisons correction to use: "}
          className="ml-2"
          value={form.watch("pValueCorrection") ?? ""}
          onChange={(value) =>
            form.setValue("pValueCorrection", value as PValueCorrection)
          }
          sort={false}
          options={[
            {
              label: "None",
              value: "",
            },
            {
              label: "Holm-Bonferroni (Control FWER)",
              value: "holm-bonferroni",
            },
            {
              label: "Benjamini-Hochberg (Control FDR)",
              value: "benjamini-hochberg",
            },
          ]}
        />
      </div>

      <div className="p-3 my-3 border rounded">
        <h5 className="font-weight-bold mb-4">
          <PremiumTooltip commercialFeature="sequential-testing">
            <GBSequential /> Sequential Testing
          </PremiumTooltip>
        </h5>
        <div className="form-group mb-0 mr-2">
          <Switch
            id={"toggle-sequentialTestingEnabled"}
            value={form.watch("sequentialTestingEnabled")}
            label="Apply sequential testing by default"
            onChange={(value) => {
              form.setValue("sequentialTestingEnabled", value);
            }}
            disabled={
              !hasCommercialFeature("sequential-testing") || hasFileConfig()
            }
            mb="1"
          />
          {form.watch("sequentialTestingEnabled") &&
            form.watch("statsEngine") === "bayesian" && (
              <div className="d-flex">
                <small className="mb-1 text-warning-orange">
                  <FaExclamationTriangle /> Your organization uses Bayesian
                  statistics by default and sequential testing is not
                  implemented for the Bayesian engine.
                </small>
              </div>
            )}
        </div>
        <div
          className="form-group mt-3 mb-0 mr-2 form-inline"
          style={{
            opacity: form.watch("sequentialTestingEnabled") ? "1" : "0.5",
          }}
        >
          <Field
            label="Tuning parameter"
            type="number"
            className={`ml-2`}
            containerClassName="mb-0"
            min="0"
            disabled={
              !hasCommercialFeature("sequential-testing") || hasFileConfig()
            }
            helpText={
              <>
                <span className="ml-2">
                  ({DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER} is default)
                </span>
              </>
            }
            {...form.register("sequentialTestingTuningParameter", {
              valueAsNumber: true,
              validate: (v) => {
                return !(v <= 0);
              },
            })}
          />
        </div>
      </div>
    </>
  );
}
