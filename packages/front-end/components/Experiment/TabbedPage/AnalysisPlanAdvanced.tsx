import { ReactNode, useEffect, useMemo, useState } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import {
  getExposureQueryIdentifierTypes,
  resolveAnalysisIdentifierType,
} from "shared/util";
import { getValidDate } from "shared/dates";
import {
  getUnsetAnalysisSettings,
  SETTLED_ANALYSIS_SETTINGS,
} from "shared/settings";
import {
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  MAX_PRECOMPUTED_UNIT_DIMENSIONS,
} from "shared/constants";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ExperimentAnalysisSettingsDraft } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getOverriddenMetricIds } from "@/services/metricOverrides";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import {
  datasourceHasWritableEphemeralPipeline,
  getIsExperimentIncludedInIncrementalRefresh,
} from "@/services/experiments";
import StatsEngineSelect from "@/components/Settings/forms/StatsEngineSelect";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import MetricSelector from "@/components/Experiment/MetricSelector";
import MetricAnalysisWindowSelector from "@/components/Experiment/MetricAnalysisWindowSelector";
import CustomMetricSlicesSelector from "@/components/Experiment/CustomMetricSlicesSelector";
import MultiSelectField from "@/ui/MultiSelectField";
import Collapse, { CollapseTrigger } from "@/ui/Collapse";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Checkbox from "@/ui/Checkbox";
import Link from "@/ui/Link";
import HelperText from "@/ui/HelperText";
import Tooltip from "@/ui/Tooltip";
import SetupFieldRow from "./SetupFieldRow";
import QuickEditButton, { clicksQuickEdit } from "./QuickEditButton";

function Card({
  title,
  reset,
  children,
}: {
  title: string;
  // Set while something here differs from its default.
  reset?: (() => void) | null;
  children: ReactNode;
}) {
  return (
    <Frame mb="3" px="5" py="4">
      <Heading as="h5" size="sm" color="text-high" mb="4">
        {title}
      </Heading>
      <Flex direction="column">{children}</Flex>
      {reset ? (
        <Flex justify="end" mt="2">
          <Link size="sm" onClick={reset}>
            Reset to defaults
          </Link>
        </Flex>
      ) : null}
    </Frame>
  );
}

/** The analysis plan's less common settings, staged with the rest of the plan. */
export default function AnalysisPlanAdvanced({
  open,
  setOpen,
  experiment,
  datasourceId,
  exposureQueryId,
  metrics,
  stage,
  manageOverrides,
  canEdit,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The experiment with the plan's staged settings applied. */
  experiment: ExperimentInterfaceStringDates;
  datasourceId: string;
  exposureQueryId: string;
  metrics: {
    goalMetrics: string[];
    secondaryMetrics: string[];
    guardrailMetrics: string[];
  };
  stage: (changes: ExperimentAnalysisSettingsDraft) => void;
  /** Opens the overrides editor on every metric; omitted where it can't open. */
  manageOverrides?: () => void;
  canEdit: boolean;
}) {
  const {
    getDatasourceById,
    getProjectById,
    getExperimentMetricById,
    segments,
    dimensions,
  } = useDefinitions();
  const { organization, hasCommercialFeature } = useUser();
  const orgSettings = useOrgSettings();

  // What the experiment leaves unset shows as what saving it will store.
  const project = getProjectById(experiment.project || "") ?? undefined;
  const settled = {
    ...experiment,
    ...getUnsetAnalysisSettings({ organization, project, experiment }),
  };
  // What the org and project would give it now.
  const defaults = getUnsetAnalysisSettings({
    organization,
    project,
    experiment: {},
  });
  const defaultAttributionModel =
    orgSettings.attributionModel || "firstExposure";
  // Each card's reset, while something in it differs from its default.
  const resetIf = (
    differs: boolean,
    changes: ExperimentAnalysisSettingsDraft,
  ) => (differs && canEdit ? () => stage(changes) : null);
  const resetStatistics = resetIf(
    SETTLED_ANALYSIS_SETTINGS.some((key) => settled[key] !== defaults[key]),
    defaults,
  );
  const resetExposures = resetIf(
    !!(
      experiment.activationMetric ||
      experiment.segment ||
      experiment.queryFilter
    ),
    { activationMetric: "", segment: "", queryFilter: "" },
  );
  const resetMetrics = resetIf(
    !!experiment.skipPartialData ||
      (experiment.attributionModel || defaultAttributionModel) !==
        defaultAttributionModel ||
      !!experiment.precomputedUnitDimensionIds?.length ||
      !!experiment.customMetricSlices?.length,
    {
      skipPartialData: false,
      attributionModel: defaultAttributionModel,
      precomputedUnitDimensionIds: [],
      customMetricSlices: [],
    },
  );

  const datasource = getDatasourceById(datasourceId);
  const properties = datasource?.properties;
  const exposureQuery = datasource?.settings?.queries?.exposure?.find(
    (q) => q.id === exposureQueryId,
  );
  const identifierType = exposureQuery
    ? resolveAnalysisIdentifierType(
        exposureQuery,
        experiment.exposureQueryIdentifierType,
      )
    : undefined;
  const incrementalRefresh = getIsExperimentIncludedInIncrementalRefresh(
    datasource ?? undefined,
    experiment.id,
    experiment.type,
  );

  const hasCuped = hasCommercialFeature("regression-adjustment");
  const hasPostStratification = hasCommercialFeature("post-stratification");
  const hasSequential = hasCommercialFeature("sequential-testing");
  const sequentialEnabled = !!settled.sequentialTestingEnabled;
  const tuningParameter =
    settled.sequentialTestingTuningParameter ??
    DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER;
  // Typed as text, so "0." can be on its way to a valid value.
  const [tuningText, setTuningText] = useState(String(tuningParameter));
  useEffect(() => {
    setTuningText((text) =>
      parseFloat(text) === tuningParameter ? text : String(tuningParameter),
    );
  }, [tuningParameter]);

  const unitDimensionOptions = useMemo(
    () =>
      datasourceHasWritableEphemeralPipeline(
        datasource,
        hasCommercialFeature("pipeline-mode"),
      )
        ? dimensions
            .filter(
              (d) =>
                d.datasource === datasourceId &&
                (!identifierType || d.userIdType === identifierType),
            )
            .map((d) => ({ label: d.name, value: d.id }))
        : [],
    [
      datasource,
      datasourceId,
      dimensions,
      identifierType,
      hasCommercialFeature,
    ],
  );
  const unitDimensionIds = experiment.precomputedUnitDimensionIds || [];
  const datasourceSegments = segments.filter(
    (s) => s.datasource === datasourceId,
  );
  const hasMetrics =
    metrics.goalMetrics.length +
      metrics.secondaryMetrics.length +
      metrics.guardrailMetrics.length >
    0;
  const disabled = !canEdit;
  const overriddenNames = [
    ...getOverriddenMetricIds(
      experiment.metricOverrides,
      experiment.decisionFrameworkSettings?.decisionFrameworkMetricOverrides,
    ),
  ].map((id) => getExperimentMetricById(id)?.name ?? id);

  return (
    <Box id="analysis-plan-advanced" mt="3">
      <Separator size="4" mb="4" />
      <CollapseTrigger open={open} onOpenChange={setOpen} caret="start">
        <Text weight="medium" color="text-high">
          Advanced
        </Text>
      </CollapseTrigger>
      <Collapse open={open}>
        <Box pt="3">
          <Card title="Statistics" reset={resetStatistics}>
            <SetupFieldRow label="Stats engine">
              <Box maxWidth="300px">
                <StatsEngineSelect
                  label={null}
                  labelClassName=""
                  containerClassName="mb-0"
                  className=""
                  value={settled.statsEngine}
                  onChange={(statsEngine) => stage({ statsEngine })}
                  allowUndefined={false}
                  disabled={disabled}
                />
              </Box>
            </SetupFieldRow>
            <SetupFieldRow label="Variance reduction" content="text">
              <Flex direction="column" gap="2">
                <Checkbox
                  label={
                    <PremiumTooltip commercialFeature="regression-adjustment">
                      CUPED
                    </PremiumTooltip>
                  }
                  weight="regular"
                  value={hasCuped && !!settled.regressionAdjustmentEnabled}
                  setValue={(value) =>
                    stage({ regressionAdjustmentEnabled: value })
                  }
                  disabled={disabled || !hasCuped}
                />
                {!orgSettings.disablePrecomputedDimensions ? (
                  <Checkbox
                    label={
                      <PremiumTooltip commercialFeature="post-stratification">
                        Post-stratification
                      </PremiumTooltip>
                    }
                    weight="regular"
                    value={
                      hasPostStratification &&
                      !!settled.postStratificationEnabled
                    }
                    setValue={(value) =>
                      stage({ postStratificationEnabled: value })
                    }
                    disabled={disabled || !hasPostStratification}
                  />
                ) : null}
              </Flex>
            </SetupFieldRow>
            {settled.statsEngine === "frequentist" ? (
              <SetupFieldRow label="Corrections" content="text">
                <Flex direction="column" gap="2">
                  <Checkbox
                    label={
                      <PremiumTooltip commercialFeature="sequential-testing">
                        Sequential testing
                      </PremiumTooltip>
                    }
                    weight="regular"
                    value={hasSequential && sequentialEnabled}
                    setValue={(value) =>
                      stage({
                        sequentialTestingEnabled: value,
                        sequentialTestingTuningParameter: tuningParameter,
                      })
                    }
                    disabled={disabled || !hasSequential}
                  />
                  {/* Under the checkbox it tunes, in line with its label. */}
                  {sequentialEnabled ? (
                    <Flex align="center" gap="3" pl="5">
                      <Text>Tuning parameter</Text>
                      <Box width="120px">
                        <Field
                          type="number"
                          min="0"
                          containerClassName="mb-0"
                          value={tuningText}
                          onChange={(e) => {
                            setTuningText(e.target.value);
                            const value = parseFloat(e.target.value);
                            if (value > 0) {
                              stage({
                                sequentialTestingTuningParameter: value,
                              });
                            }
                          }}
                          disabled={disabled || !hasSequential}
                        />
                      </Box>
                    </Flex>
                  ) : null}
                </Flex>
              </SetupFieldRow>
            ) : null}
          </Card>

          {datasource ? (
            <Card title="Exposures" reset={resetExposures}>
              <SetupFieldRow
                label="Activation metric"
                tooltip="Users must convert on this metric before being included."
              >
                <Tooltip
                  content="Activation Metrics are not yet supported with Incremental Refresh."
                  enabled={incrementalRefresh}
                >
                  <Box>
                    <MetricSelector
                      datasource={datasourceId}
                      exposureQueryId={exposureQueryId}
                      exposureQueryIdentifierType={identifierType}
                      project={experiment.project}
                      includeFacts
                      initialOption="None"
                      onlyBinomial
                      filterFactFunnelMetrics
                      value={experiment.activationMetric || ""}
                      onChange={(value) =>
                        stage({ activationMetric: value || "" })
                      }
                      disabled={disabled || incrementalRefresh}
                    />
                  </Box>
                </Tooltip>
              </SetupFieldRow>
              {properties?.experimentSegments &&
              datasourceSegments.length > 0 ? (
                <SetupFieldRow
                  label="Segment"
                  tooltip="Only users in this segment will be included."
                >
                  <SelectField
                    value={experiment.segment || ""}
                    onChange={(value) => stage({ segment: value || "" })}
                    initialOption="None (all users)"
                    options={datasourceSegments.map((s) => ({
                      label: s.name,
                      value: s.id,
                    }))}
                    disabled={disabled}
                  />
                </SetupFieldRow>
              ) : null}
              {properties?.queryLanguage === "sql" ? (
                <SetupFieldRow label="Custom SQL filter">
                  <Field
                    textarea
                    value={experiment.queryFilter || ""}
                    onChange={(e) => stage({ queryFilter: e.target.value })}
                    placeholder="e.g. user_id NOT IN ('123', '456')"
                    containerClassName="mb-0"
                    disabled={disabled}
                  />
                  <HelperText status="info" size="sm" mt="1">
                    A WHERE clause added to the experiment query. Columns:{" "}
                    {["timestamp", "variation_id"]
                      .concat(
                        exposureQuery
                          ? getExposureQueryIdentifierTypes(exposureQuery)
                          : [],
                      )
                      .concat(exposureQuery?.dimensions || [])
                      .map((column, i) => (
                        <span key={column}>
                          {i > 0 ? ", " : null}
                          <code>{column}</code>
                        </span>
                      ))}
                    .
                  </HelperText>
                </SetupFieldRow>
              ) : null}
            </Card>
          ) : null}

          {datasource ? (
            <Card title="Metrics" reset={resetMetrics}>
              {properties?.separateExperimentResultQueries ? (
                <>
                  <SetupFieldRow
                    label="Conversion windows"
                    tooltip="How to treat users not enrolled long enough to complete a conversion window."
                  >
                    <Tooltip
                      content="In-progress conversions can't be excluded with Incremental Refresh while in beta."
                      enabled={incrementalRefresh}
                    >
                      <Box>
                        <SelectField
                          value={
                            experiment.skipPartialData ? "strict" : "loose"
                          }
                          onChange={(value) =>
                            stage({ skipPartialData: value === "strict" })
                          }
                          options={[
                            {
                              label: "Include in-progress conversions",
                              value: "loose",
                            },
                            {
                              label: "Exclude in-progress conversions",
                              value: "strict",
                            },
                          ]}
                          isOptionDisabled={(option) =>
                            incrementalRefresh &&
                            "value" in option &&
                            option.value === "strict"
                          }
                          disabled={disabled}
                        />
                      </Box>
                    </Tooltip>
                  </SetupFieldRow>
                  <SetupFieldRow
                    label="Metric windows"
                    tooltip="Apply custom metric window behavior in this experiment."
                  >
                    <MetricAnalysisWindowSelector
                      bare
                      attributionModel={
                        experiment.attributionModel || defaultAttributionModel
                      }
                      lookbackOverride={experiment.lookbackOverride}
                      onAttributionModelChange={(value) =>
                        stage({ attributionModel: value })
                      }
                      onLookbackOverrideChange={(value) =>
                        stage({ lookbackOverride: value })
                      }
                      phaseEndDate={
                        experiment.status === "stopped"
                          ? getValidDate(
                              experiment.phases.at(-1)?.dateEnded ?? "",
                            )
                          : new Date()
                      }
                      disabled={disabled || incrementalRefresh}
                    />
                  </SetupFieldRow>
                </>
              ) : null}
              {unitDimensionOptions.length > 0 ? (
                <SetupFieldRow
                  label="Unit dimensions"
                  tooltip={`Always computed on every refresh, like precomputed dimensions. Up to ${MAX_PRECOMPUTED_UNIT_DIMENSIONS}.`}
                >
                  <MultiSelectField
                    value={unitDimensionIds}
                    options={unitDimensionOptions}
                    isOptionDisabled={(option) =>
                      "value" in option &&
                      unitDimensionIds.length >=
                        MAX_PRECOMPUTED_UNIT_DIMENSIONS &&
                      !unitDimensionIds.includes(option.value)
                    }
                    onChange={(value) =>
                      stage({
                        precomputedUnitDimensionIds: value.slice(
                          0,
                          MAX_PRECOMPUTED_UNIT_DIMENSIONS,
                        ),
                      })
                    }
                    disabled={disabled}
                  />
                </SetupFieldRow>
              ) : null}
              <CustomMetricSlicesSelector
                asRow
                goalMetrics={metrics.goalMetrics}
                secondaryMetrics={metrics.secondaryMetrics}
                guardrailMetrics={metrics.guardrailMetrics}
                customMetricSlices={experiment.customMetricSlices || []}
                setCustomMetricSlices={(slices) =>
                  stage({ customMetricSlices: slices })
                }
              />
              {hasMetrics ? (
                <SetupFieldRow
                  label="Metric overrides"
                  tooltip="Override metric behaviors within this experiment."
                  content="text"
                >
                  <Flex
                    align="start"
                    justify="between"
                    gap="3"
                    className={manageOverrides ? clicksQuickEdit : undefined}
                  >
                    <Text
                      color={overriddenNames.length ? "text-high" : "text-mid"}
                    >
                      {overriddenNames.length
                        ? overriddenNames.join(", ")
                        : "None"}
                    </Text>
                    {manageOverrides ? (
                      <QuickEditButton
                        label="Edit metric overrides"
                        onClick={manageOverrides}
                        labelTooltip={false}
                        fillsRow
                      />
                    ) : null}
                  </Flex>
                </SetupFieldRow>
              ) : null}
            </Card>
          ) : null}
        </Box>
      </Collapse>
    </Box>
  );
}
