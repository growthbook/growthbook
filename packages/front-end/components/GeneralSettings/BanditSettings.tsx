import { useFormContext } from "react-hook-form";
import { ScopedSettings } from "shared/settings";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import Checkbox from "@/ui/Checkbox";
import HelperText from "@/ui/HelperText";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";

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
  const hasContextualBandits = hasCommercialFeature("contextual-bandits");

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
            <Heading size="md" as="h4">
              Bandit Settings
            </Heading>
          </Box>
        )}
        <Box
          width="100%"
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

          <Grid columns="2" width="auto" gap="1">
            <Box>
              <Text weight="semibold" as="label" mb="1">
                Exploratory stage
              </Text>
              <Text size="sm" color="text-mid" mb="2" as="p">
                Period before variation weights update:
              </Text>
              <Flex direction="row" align="center" gap="3">
                <Box>
                  <Field
                    size="legacy"
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
                </Box>
                <Box>
                  <SelectField
                    size="legacy"
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
                </Box>
              </Flex>
              {page === "experiment-settings" && (
                <Box mt="1">
                  <Text size="sm" color="text-low">
                    Default is{" "}
                    <Text size="sm" weight="semibold">
                      {settings?.banditBurnInValue?.value ?? 1}{" "}
                      {settings?.banditBurnInUnit?.value ?? "days"}
                    </Text>
                    .
                  </Text>
                </Box>
              )}
              {lockExploratoryStage && page === "experiment-settings" && (
                <HelperText status="info">
                  Exploratory stage has already ended
                </HelperText>
              )}
            </Box>

            <Box>
              <Text weight="semibold" as="label" mb="1">
                Update cadence
              </Text>
              <Text size="sm" color="text-mid" mb="2" as="p">
                Update variation weights every:
              </Text>
              <Flex direction="row" align="center" gap="3">
                <Box>
                  <Field
                    size="legacy"
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
                </Box>
                <Box>
                  <SelectField
                    size="legacy"
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
                </Box>
              </Flex>
              {page === "experiment-settings" && (
                <Box mt="1">
                  <Text size="sm" color="text-low">
                    Default is{" "}
                    <Text size="sm" weight="semibold">
                      {settings?.banditScheduleValue?.value ?? 1}{" "}
                      {settings?.banditScheduleUnit?.value ?? "days"}
                    </Text>
                    .
                  </Text>
                </Box>
              )}
              {scheduleWarning ? (
                <HelperText status="warning" size="sm" mt="1">
                  {scheduleWarning}
                </HelperText>
              ) : null}
            </Box>
          </Grid>

          {page === "org-settings" && (
            <Box mt="4">
              <Checkbox
                id="toggle-banditPeriodWeighting"
                align="start"
                weight="medium"
                label={
                  <Flex as="span" align="center" gap="1">
                    Weight results across update periods
                    <span
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      style={{ display: "inline-flex" }}
                    >
                      <Tooltip body="Each update period is weighted proportionally to traffic received. This reduces bias, but adds variance.">
                        <PiInfo color="var(--color-text-low)" />
                      </Tooltip>
                    </span>
                    <span
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      style={{ display: "inline-flex" }}
                    >
                      <PremiumTooltip commercialFeature="contextual-bandits" />
                    </span>
                  </Flex>
                }
                description="Reduce bias in Contextual Bandit decision metric estimates due to changing traffic over time."
                value={form.watch("banditPeriodWeighting") ?? true}
                setValue={(value) =>
                  form.setValue("banditPeriodWeighting", value, {
                    shouldDirty: true,
                  })
                }
                disabled={!hasContextualBandits}
              />
            </Box>
          )}
        </Box>
      </Flex>
    </Box>
  );
}
