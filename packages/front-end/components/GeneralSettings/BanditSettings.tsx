import { useFormContext } from "react-hook-form";
import clsx from "clsx";
import { ScopedSettings } from "shared/settings";
import { Box, Flex } from "@radix-ui/themes";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import HelperText from "@/ui/HelperText";
import Heading from "@/ui/Heading";

export default function BanditSettings({
  page = "org-settings",
  settings,
  lockExploratoryStage,
}: {
  page?: "org-settings" | "experiment-settings";
  settings?: ScopedSettings;
  lockExploratoryStage?: boolean;
}) {
  const { hasCommercialFeature } = useUser();
  const form = useFormContext();
  const hasBandits = hasCommercialFeature("multi-armed-bandits");

  const scheduleHours =
    parseFloat(form.watch("banditScheduleValue") ?? "0") *
    (form.watch("banditScheduleUnit") === "days" ? 24 : 1);

  const scheduleWarning =
    scheduleHours < 1
      ? "Update cadence should be at least 15 minutes longer than it takes to run your data warehouse query"
      : scheduleHours > 24 * 3
        ? "Update cadences longer than 3 days can result in slow learning"
        : null;

  return (
    <Box>
      <Flex gap="4">
        {page === "org-settings" && (
          <Box width="220px" flexShrink="0">
            <Heading size="medium" as="h4">
              Bandit Settings
            </Heading>
          </Box>
        )}
        <Box
          className={clsx({
            col: page === "experiment-settings",
          })}
          width={page === "org-settings" ? "100%" : undefined}
          mb={page === "org-settings" ? "4" : undefined}
          ml={page === "org-settings" ? "0" : undefined}
        >
          {page === "org-settings" && (
            <>
              <PremiumTooltip
                commercialFeature="multi-armed-bandits"
                premiumText="Bandits are a Pro feature"
              >
                <div className="d-inline-block h5 mb-0">Bandit Defaults</div>
              </PremiumTooltip>
              <p className="mt-2">
                These are organizational default values for configuring Bandits.
                You can always change these values on a per-experiment basis.
              </p>
            </>
          )}

          <div className="d-flex">
            <div className="col-6 pl-0">
              <label
                className={clsx("mb-0", {
                  "font-weight-bold": page === "experiment-settings",
                })}
              >
                Exploratory Stage
              </label>
              <div className="small text-muted mb-2">
                Period before variation weights update:
              </div>
              <div className="row align-items-center">
                <div className="col-auto">
                  <Field
                    {...form.register("banditBurnInValue", {
                      valueAsNumber: true,
                    })}
                    type="number"
                    min={0}
                    max={999}
                    step={"any"}
                    style={{ width: 70 }}
                    disabled={!hasBandits || lockExploratoryStage}
                  />
                </div>
                <div className="col-auto">
                  <SelectField
                    value={form.watch("banditBurnInUnit")}
                    onChange={(value) => {
                      form.setValue(
                        "banditBurnInUnit",
                        value as "hours" | "days",
                      );
                    }}
                    sort={false}
                    options={[
                      {
                        label: "Hour(s)",
                        value: "hours",
                      },
                      {
                        label: "Day(s)",
                        value: "days",
                      },
                    ]}
                    disabled={!hasBandits || lockExploratoryStage}
                    style={{ width: 90, minWidth: 90 }}
                  />
                </div>
              </div>
              {page === "experiment-settings" && (
                <div className="text-muted small mt-1">
                  Default:{" "}
                  <strong>
                    {settings?.banditBurnInValue?.value ?? 1}{" "}
                    {settings?.banditBurnInUnit?.value ?? "days"}
                  </strong>
                </div>
              )}
              {lockExploratoryStage && page === "experiment-settings" && (
                <HelperText status="info">
                  Exploratory stage has already ended
                </HelperText>
              )}
            </div>

            <div className="col-6 pr-0">
              <label
                className={clsx("mb-0", {
                  "font-weight-bold": page === "experiment-settings",
                })}
              >
                Update Cadence
              </label>
              <div className="small text-muted mb-2">
                Update variation weights every:
              </div>
              <div className="row align-items-center">
                <div className="col-auto">
                  <Field
                    {...form.register("banditScheduleValue", {
                      valueAsNumber: true,
                    })}
                    type="number"
                    min={0}
                    max={999}
                    step={"any"}
                    style={{ width: 70 }}
                    disabled={!hasBandits}
                  />
                </div>
                <div className="col-auto">
                  <SelectField
                    value={form.watch("banditScheduleUnit")}
                    onChange={(value) => {
                      form.setValue(
                        "banditScheduleUnit",
                        value as "hours" | "days",
                      );
                    }}
                    sort={false}
                    options={[
                      {
                        label: "Hour(s)",
                        value: "hours",
                      },
                      {
                        label: "Day(s)",
                        value: "days",
                      },
                    ]}
                    disabled={!hasBandits}
                    style={{ width: 90, minWidth: 90 }}
                  />
                </div>
              </div>
              {page === "experiment-settings" && (
                <div className="text-muted small mt-1">
                  Default:{" "}
                  <strong>
                    {settings?.banditScheduleValue?.value ?? 1}{" "}
                    {settings?.banditScheduleUnit?.value ?? "days"}
                  </strong>
                </div>
              )}
              {scheduleWarning ? (
                <HelperText status="warning" size="sm" mt="1">
                  {scheduleWarning}
                </HelperText>
              ) : null}
            </div>
          </div>
        </Box>
      </Flex>
    </Box>
  );
}
