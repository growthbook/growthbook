import { UseFormReturn } from "react-hook-form";
import { DEFAULT_REGRESSION_ADJUSTMENT_DAYS } from "shared/constants";
import { Flex, Grid } from "@radix-ui/themes";
import { PiCaretDown } from "react-icons/pi";
import { MetricCappingSettings } from "shared/types/fact-table";
import { getCappingTailState } from "shared/validators";
import { CreateFactMetricFormProps } from "@/services/metrics";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Checkbox from "@/ui/Checkbox";
import Switch from "@/ui/Switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import { DataListItem } from "@/ui/DataList";
import Field from "@/components/Forms/Field";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { MetricCappingSettingsForm } from "@/components/Metrics/MetricForm/MetricCappingSettingsForm";
import { MetricDelaySettings } from "@/components/Metrics/MetricForm/MetricDelaySettings";
import { MetricPriorSettingsForm } from "@/components/Metrics/MetricForm/MetricPriorSettingsForm";
import {
  cappingOk,
  FormMetricType,
  windowOk,
} from "@/components/FactTables/MetricEditor/metricFormTranslation";
import styles from "./AdvancedSettings.module.scss";

// One row per active tail, upper first (same order as the metric page).
function cappingSummary(
  upper: MetricCappingSettings,
  lower: MetricCappingSettings | null | undefined,
): DataListItem[] {
  const tails = getCappingTailState(upper, lower);
  const row = (
    cs: MetricCappingSettings,
    tail: "upper" | "lower",
  ): DataListItem =>
    cs.type === "percentile"
      ? {
          label: `Percentile capping (${tail === "upper" ? "ceiling" : "floor"})`,
          value: `${cs.value} (${100 * cs.value} pctile${
            cs.ignoreZeros ? ", ignoring zeros" : ""
          })`,
        }
      : {
          label: tail === "upper" ? "Maximum user value" : "Minimum user value",
          value: `${cs.value}`,
        };
  return [
    ...(tails.upperPercentileCapped || tails.upperAbsoluteCapped
      ? [row(upper, "upper")]
      : []),
    ...(lower && (tails.lowerPercentileCapped || tails.lowerAbsoluteCapped)
      ? [row(lower, "lower")]
      : []),
  ];
}

function Summary({ subtitle }: { subtitle: string }) {
  return (
    <summary className={styles.summary}>
      <Flex direction="column" gap="1">
        <Heading as="h4" size="sm" mb="0">
          Advanced settings
        </Heading>
        <Text size="sm" color="text-mid">
          {subtitle}
        </Text>
      </Flex>
      <PiCaretDown className={styles.caret} size={16} />
    </summary>
  );
}

export default function AdvancedSettings({
  form,
  formType,
  canEdit,
}: {
  form: UseFormReturn<CreateFactMetricFormProps>;
  formType: FormMetricType;
  canEdit: boolean;
}) {
  const { getDatasourceById } = useDefinitions();
  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const orgSettings = useOrgSettings();
  const { metricDefaults } = useOrganizationMetricDefaults();

  const metricType = form.watch("metricType");
  const datasource = getDatasourceById(form.watch("datasource"));
  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment",
  );
  const priorSettings = form.watch("priorSettings");
  const cappingItems = cappingSummary(
    form.watch("cappingSettings"),
    form.watch("lowerCappingSettings"),
  );
  const windowSettings = form.watch("windowSettings");
  const minSampleSizeLabel =
    formType === "ratio" ? "Minimum numerator total" : "Minimum metric total";
  // A write gate around an edit control, not around the fact itself - the
  // fact itself is now an OfficialBadge next to the Name field in
  // MetricEditor's Basics card, matching how the rest of the app (FactMetricModal,
  // [fmid].tsx, fact table pages) always shows official status, not just when
  // Advanced Settings happens to be open.
  const canEditOfficial =
    canEdit &&
    permissionsUtil.canUpdateOfficialResources(
      { projects: form.watch("projects") },
      {},
    ) &&
    hasCommercialFeature("manage-official-resources");

  if (!canEdit) {
    const effectivePrior = priorSettings.override
      ? priorSettings
      : metricDefaults.priorSettings;
    const cupedOverride = form.watch("regressionAdjustmentOverride");
    const cupedEnabled = cupedOverride
      ? form.watch("regressionAdjustmentEnabled")
      : orgSettings.regressionAdjustmentEnabled;
    const cupedDays = cupedOverride
      ? form.watch("regressionAdjustmentDays")
      : orgSettings.regressionAdjustmentDays;
    const items: DataListItem[] = [
      {
        label: "Target MDE",
        value: `${form.watch("targetMDE") ?? metricDefaults.targetMDE * 100}%`,
      },
      ...(formType !== "quantile"
        ? [
            {
              label: "Regression adjustment (CUPED)",
              value: cupedEnabled
                ? `On · ${cupedDays ?? DEFAULT_REGRESSION_ADJUSTMENT_DAYS} days lookback${cupedOverride ? "" : " · Organization defaults"}`
                : `Disabled${cupedOverride ? "" : " · Organization defaults"}`,
            },
          ]
        : []),
      {
        label: minSampleSizeLabel,
        value: form.watch("minSampleSize") ?? metricDefaults.minimumSampleSize,
      },
      {
        label: "Use proper prior",
        value: `${effectivePrior.proper ? "On" : "Off"}${priorSettings.override ? "" : " · Organization defaults"}`,
      },
      {
        label: "Max percent change",
        value: `${form.watch("maxPercentChange") ?? metricDefaults.maxPercentageChange * 100}%`,
      },
      {
        label: "Min percent change",
        value: `${form.watch("minPercentChange") ?? metricDefaults.minPercentageChange * 100}%`,
      },
      ...(effectivePrior.proper
        ? [
            { label: "Prior mean", value: effectivePrior.mean },
            { label: "Prior standard deviation", value: effectivePrior.stddev },
          ]
        : []),
      ...(windowOk(formType) && windowSettings.delayValue
        ? [
            {
              label: "Metric delay",
              value: `${windowSettings.delayValue} ${windowSettings.delayUnit} after experiment exposure`,
            },
          ]
        : []),
      ...(cappingOk(formType) ? cappingItems : []),
      ...(formType === "ratio" || formType === "dailyParticipation"
        ? [
            {
              label: "Format variation value as a percentage",
              value: form.watch("displayAsPercentage") ? "Yes" : "No",
            },
          ]
        : []),
    ];

    return (
      <Frame px="5" py="5" mb="0">
        <details open>
          <Summary subtitle="Metric delay, decision framework, thresholds, priors, CUPED" />
          <Grid
            asChild
            columns={{ initial: "1", sm: "2" }}
            gapX="5"
            gapY="3"
            mt="3"
          >
            <dl style={{ marginBottom: 0 }}>
              {items.map(({ label, value }) => (
                <div key={label}>
                  <dt style={{ marginBottom: 4 }}>
                    <Text
                      size="sm"
                      weight="semibold"
                      color="text-mid"
                      textTransform="uppercase"
                    >
                      {label}
                    </Text>
                  </dt>
                  <dd style={{ margin: 0 }}>
                    <Text size="sm">{value}</Text>
                  </dd>
                </div>
              ))}
            </dl>
          </Grid>
        </details>
      </Frame>
    );
  }

  return (
    <Frame px="5" py="5" mb="0">
      <details>
        <Summary subtitle="Metric delay, decision framework, thresholds, priors, CUPED" />
        <Flex direction="column" gap="3" mt="4">
          <Tabs defaultValue="analysis">
            <TabsList mb="3" aria-label="Advanced settings">
              <TabsTrigger value="analysis">Analysis settings</TabsTrigger>
              <TabsTrigger value="display">Display settings</TabsTrigger>
            </TabsList>
            <TabsContent value="analysis" forceMount>
              <Flex direction="column" gap="3">
                {
                  <>
                    {windowOk(formType) && (
                      <div className={styles.setting}>
                        <MetricDelaySettings form={form} />
                      </div>
                    )}
                    {cappingOk(formType) && (
                      <div className={styles.setting}>
                        <MetricCappingSettingsForm
                          form={form}
                          datasourceType={datasource?.type}
                          metricType={metricType}
                          allowLowerTailCapping
                        />
                      </div>
                    )}
                    <div className={styles.setting}>
                      <Field
                        label={
                          <>
                            <Text as="div" weight="semibold" mb="2">
                              Target MDE
                            </Text>
                            <Text
                              as="div"
                              weight="regular"
                              color="text-mid"
                              mb="2"
                            >{`The percentage change that you want to reliably detect before ending your experiment. This is used to estimate the "Days Left" for running experiments. (default ${
                              metricDefaults.targetMDE * 100
                            }%)`}</Text>
                          </>
                        }
                        type="number"
                        step="any"
                        append="%"
                        {...form.register("targetMDE", { valueAsNumber: true })}
                      />
                    </div>
                    <div className={styles.setting}>
                      <MetricPriorSettingsForm
                        priorSettings={priorSettings}
                        setPriorSettings={(v) =>
                          form.setValue("priorSettings", v)
                        }
                        metricDefaults={metricDefaults}
                      />
                    </div>
                    {formType !== "quantile" && (
                      <div className={styles.setting}>
                        <PremiumTooltip commercialFeature="regression-adjustment">
                          <Text weight="semibold" as="div" mb="1">
                            Regression adjustment (CUPED)
                          </Text>
                        </PremiumTooltip>
                        <Switch
                          label="Override organization-level settings"
                          value={form.watch("regressionAdjustmentOverride")}
                          onChange={(v) =>
                            form.setValue("regressionAdjustmentOverride", v)
                          }
                          disabled={!hasRegressionAdjustmentFeature}
                        />
                        {form.watch("regressionAdjustmentOverride") && (
                          <Flex direction="column" gap="2" mt="2">
                            <Checkbox
                              label="Apply regression adjustment for this metric"
                              value={
                                !!form.watch("regressionAdjustmentEnabled")
                              }
                              setValue={(v) =>
                                form.setValue("regressionAdjustmentEnabled", v)
                              }
                              disabled={!hasRegressionAdjustmentFeature}
                            />
                            <Field
                              label="Pre-exposure lookback period (days)"
                              type="number"
                              append="days"
                              min="0"
                              disabled={!hasRegressionAdjustmentFeature}
                              {...form.register("regressionAdjustmentDays", {
                                valueAsNumber: true,
                              })}
                            />
                          </Flex>
                        )}
                      </div>
                    )}
                  </>
                }
              </Flex>
            </TabsContent>
            <TabsContent value="display" forceMount>
              <Flex direction="column" gap="3">
                {
                  <>
                    <div className={styles.setting}>
                      <Field
                        label={
                          <>
                            <Text as="div" weight="semibold" mb="2">
                              {minSampleSizeLabel}
                            </Text>
                            <Text
                              as="div"
                              weight="regular"
                              color="text-mid"
                              mb="2"
                            >{`Required in an experiment variation before showing results (default ${metricDefaults.minimumSampleSize})`}</Text>
                          </>
                        }
                        type="number"
                        {...form.register("minSampleSize", {
                          valueAsNumber: true,
                        })}
                      />
                    </div>
                    <div className={styles.setting}>
                      <Field
                        label={
                          <>
                            <Text as="div" weight="semibold" mb="2">
                              Max percent change
                            </Text>
                            <Text
                              as="div"
                              weight="regular"
                              color="text-mid"
                              mb="2"
                            >{`An experiment that changes the metric by more than this percent will be flagged as suspicious (default ${
                              metricDefaults.maxPercentageChange * 100
                            }%)`}</Text>
                          </>
                        }
                        type="number"
                        step="any"
                        append="%"
                        {...form.register("maxPercentChange", {
                          valueAsNumber: true,
                        })}
                      />
                    </div>
                    <div className={styles.setting}>
                      <Field
                        label={
                          <>
                            <Text as="div" weight="semibold" mb="2">
                              Min percent change
                            </Text>
                            <Text
                              as="div"
                              weight="regular"
                              color="text-mid"
                              mb="2"
                            >{`An experiment that changes the metric by less than this percent will be considered a draw (default ${
                              metricDefaults.minPercentageChange * 100
                            }%)`}</Text>
                          </>
                        }
                        type="number"
                        step="any"
                        append="%"
                        {...form.register("minPercentChange", {
                          valueAsNumber: true,
                        })}
                      />
                    </div>
                    {(formType === "ratio" ||
                      formType === "dailyParticipation") && (
                      <Checkbox
                        label="Format variation value as a percentage"
                        value={form.watch("displayAsPercentage") ?? false}
                        setValue={(v) =>
                          form.setValue("displayAsPercentage", v)
                        }
                        description="Will render variation values as a percentage rather than a proportion (e.g. 34% instead of 0.34)."
                      />
                    )}
                  </>
                }
                {canEditOfficial && (
                  <Checkbox
                    label="Mark as official metric"
                    disabled={form.watch("managedBy") === "api"}
                    disabledMessage="This Metric is managed by the API, so it can not be edited in the UI."
                    description="Official Metrics can only be modified by Admins or users with the ManageOfficialResources policy."
                    value={form.watch("managedBy") === "admin"}
                    setValue={(value) =>
                      form.setValue("managedBy", value ? "admin" : "")
                    }
                  />
                )}
              </Flex>
            </TabsContent>
          </Tabs>
        </Flex>
      </details>
    </Frame>
  );
}
