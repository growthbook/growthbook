import { MetricPriorSettings } from "shared/types/fact-table";
import { MetricDefaults } from "shared/types/organization";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Switch from "@/ui/Switch";
import Field from "@/components/Forms/Field";
import Checkbox from "@/ui/Checkbox";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export function MetricPriorSettingsForm({
  priorSettings,
  setPriorSettings,
  metricDefaults,
}: {
  priorSettings: MetricPriorSettings;
  setPriorSettings: (value: MetricPriorSettings) => void;
  metricDefaults: MetricDefaults;
}) {
  const [mean, setMean] = useState<string>(String(priorSettings.mean));
  const [stddev, setStddev] = useState<string>(String(priorSettings.stddev));

  return (
    <div className="form-group">
      <label className="mb-1">Metric Priors</label>
      <small className="d-block mb-1 text-muted">
        Only applicable to Bayesian analyses
      </small>
      <div className="px-3 py-2 pb-0 mb-2 border rounded">
        <Box mt="1">
          <Checkbox
            label="Override organization-level settings"
            value={priorSettings.override}
            setValue={(v) =>
              setPriorSettings({ ...priorSettings, override: v })
            }
          />
        </Box>
        <div
          style={{
            display: priorSettings.override ? "block" : "none",
          }}
        >
          <div className="d-flex my-2 border-bottom"></div>
          <Flex direction="column" className="form-group mt-3 mb-0 mr-2">
            <Switch
              id={"toggle-properPrior"}
              label="Use proper prior for this metric"
              value={!!priorSettings.proper}
              onChange={(value) => {
                setPriorSettings({ ...priorSettings, proper: value });
              }}
            />
            <small className="form-text text-muted">
              (organization default:{" "}
              {metricDefaults.priorSettings?.proper ? "On" : "Off"})
            </small>
          </Flex>

          {(metricDefaults.priorSettings?.proper && !priorSettings.override) ||
          priorSettings.proper ? (
            <>
              <div className="row">
                <div className="col">
                  <Field
                    label="Prior Mean"
                    type="number"
                    step="any"
                    containerClassName="mb-0 mt-3"
                    required
                    helpText={`Organization default: ${
                      metricDefaults.priorSettings?.mean ?? 0
                    }`}
                    value={mean}
                    onChange={(e) => {
                      const value = e.target.value;
                      setMean(value);
                      if (value !== "") {
                        setPriorSettings({
                          ...priorSettings,
                          mean: Number(value),
                        });
                      }
                    }}
                  />
                </div>
                <div className="col">
                  <Field
                    label="Prior Standard Deviation"
                    type="number"
                    step="any"
                    containerClassName="mb-0 mt-3"
                    required
                    helpText={`Organization default: ${
                      metricDefaults.priorSettings?.stddev ??
                      DEFAULT_PROPER_PRIOR_STDDEV
                    }`}
                    value={stddev}
                    onChange={(e) => {
                      const value = e.target.value;
                      setStddev(value);
                      const input = e.target;
                      if (Number(value) <= 0) {
                        input.setCustomValidity("Value must be greater than 0");
                      } else {
                        input.setCustomValidity("");
                      }
                      if (value !== "") {
                        setPriorSettings({
                          ...priorSettings,
                          stddev: Number(value),
                        });
                      }
                    }}
                  />
                </div>
              </div>
              <div>
                <small className="text-muted mt-1">
                  {`Your prior distribution specifies that the average lift is ${percentFormatter.format(
                    priorSettings.mean,
                  )}, and that ~68% of experiment lifts lie between ${percentFormatter.format(
                    -1 * priorSettings.stddev + priorSettings.mean,
                  )} and ${percentFormatter.format(
                    priorSettings.stddev + priorSettings.mean,
                  )}`}
                </small>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
