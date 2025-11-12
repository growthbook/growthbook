import React, { FC, ReactElement, useEffect, useMemo, useState } from "react";
import { Flex } from "@radix-ui/themes";
import {
  Condition,
  ManagedBy,
  MetricInterface,
  MetricType,
  Operator,
} from "back-end/types/metric";
import { useFieldArray, useForm } from "react-hook-form";
import { FaArrowRight, FaExternalLinkAlt, FaTimes } from "react-icons/fa";
import {
  DEFAULT_LOSE_RISK_THRESHOLD,
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
  DEFAULT_WIN_RISK_THRESHOLD,
} from "shared/constants";
import { isDemoDatasourceProject } from "shared/demo-datasource";
import { isProjectListValidForProject } from "shared/util";
import Link from "next/link";
import { isBinomialMetric } from "shared/experiments";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import { getInitialMetricQuery, validateSQL } from "@/services/datasources";
import { useDefinitions } from "@/services/DefinitionsContext";
import track from "@/services/track";
import { getMetricFormatter } from "@/services/metrics";
import { useAuth } from "@/services/auth";
import PagedModal from "@/components/Modal/PagedModal";
import Page from "@/components/Modal/Page";
import Code from "@/components/SyntaxHighlighting/Code";
import TagsInput from "@/components/Tags/TagsInput";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import SQLInputField from "@/components/SQLInputField";
import GoogleAnalyticsMetrics from "@/components/Metrics/GoogleAnalyticsMetrics";
import RiskThresholds from "@/components/Metrics/MetricForm/RiskThresholds";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Switch from "@/ui/Switch";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import EditSqlModal from "@/components/SchemaBrowser/EditSqlModal";
import useSchemaFormOptions from "@/hooks/useSchemaFormOptions";
import { GBCuped } from "@/components/Icons";
import { useCurrency } from "@/hooks/useCurrency";
import ConfirmModal from "@/components/ConfirmModal";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { MetricPriorSettingsForm } from "@/components/Metrics/MetricForm/MetricPriorSettingsForm";
import useProjectOptions from "@/hooks/useProjectOptions";
import Tooltip from "@/components/Tooltip/Tooltip";
import RadioGroup from "@/ui/RadioGroup";
import Callout from "@/ui/Callout";
import { MetricWindowSettingsForm } from "./MetricWindowSettingsForm";
import { MetricCappingSettingsForm } from "./MetricCappingSettingsForm";
import { MetricDelaySettings } from "./MetricDelaySettings";

const weekAgo = new Date();
weekAgo.setDate(weekAgo.getDate() - 7);

// ManagedBy constants to avoid type assertions
export const MANAGED_BY_ADMIN: ManagedBy = "admin";
const MANAGED_BY_EMPTY: ManagedBy = "";

export type MetricFormProps = {
  initialStep?: number;
  current: Partial<MetricInterface>;
  edit: boolean;
  duplicate?: boolean;
  source: string;
  onClose?: () => void;
  advanced?: boolean;
  inline?: boolean;
  cta?: string;
  onSuccess?: () => void;
  secondaryCTA?: ReactElement;
  switchToFact?: () => void;
};

export function usesValueColumn(sql: string) {
  return !!sql.match(/\{\{[^}]*valueColumn/g);
}

export function usesEventName(sql: string) {
  return !!sql.match(/\{\{[^}]*eventName/g);
}

function validateMetricSQL(
  sql: string,
  type: MetricType,
  userIdTypes: string[],
  templateVariables?: {
    valueColumn?: string;
    eventName?: string;
  },
) {
  // Require specific columns to be selected
  const requiredCols = ["timestamp", ...userIdTypes];
  if (type !== "binomial") {
    requiredCols.push("value");
    if (usesValueColumn(sql) && !templateVariables?.valueColumn) {
      throw new Error("Value column is required");
    }
  }
  if (usesEventName(sql) && !templateVariables?.eventName) {
    throw new Error("Event name is required");
  }

  validateSQL(sql, requiredCols);
}

function validateBasicInfo(value: { name: string }) {
  if (value.name.length < 1) {
    throw new Error("Metric name cannot be empty");
  }
}

function validateQuerySettings(
  datasourceSettingsSupport: boolean,
  sqlInput: boolean,
  value: {
    sql: string;
    type: MetricType;
    userIdTypes: string[];
    table: string;
    templateVariables?: {
      valueColumn?: string;
      eventName?: string;
    };
  },
) {
  if (!datasourceSettingsSupport) {
    return;
  }
  if (sqlInput) {
    validateMetricSQL(
      value.sql,
      value.type,
      value.userIdTypes,
      value.templateVariables,
    );
  } else {
    if (value.table.length < 1) {
      throw new Error("Table name cannot be empty");
    }
  }
}
function getRawSQLPreview({
  userIdTypes,
  userIdColumns,
  timestampColumn,
  type,
  table,
  column,
  conditions,
}: Partial<MetricInterface>) {
  const cols: string[] = [];
  // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
  userIdTypes.forEach((type) => {
    // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
    if (userIdColumns[type] !== type) {
      // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      cols.push(userIdColumns[type] + " as " + type);
    } else {
      // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      cols.push(userIdColumns[type]);
    }
  });

  if (timestampColumn !== "timestamp") {
    cols.push((timestampColumn || "received_at") + " as timestamp");
  } else {
    cols.push(timestampColumn);
  }
  if (type !== "binomial") {
    cols.push((column || "1") + " as value");
  }

  let where = "";
  // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
  if (conditions.length) {
    where =
      "\nWHERE\n  " +
      // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      conditions
        .map((c: Condition) => {
          return (c.column || "_") + " " + c.operator + " '" + c.value + "'";
        })
        .join("\n  AND ");
  }

  return `SELECT\n  ${cols.join(",\n  ")}\nFROM ${table || "_"}${where}`;
}
function getAggregateSQLPreview({ type, column }: Partial<MetricInterface>) {
  if (type === "binomial") {
    return "";
  } else if (type === "count") {
    return `COUNT(${column ? "DISTINCT value" : "*"})`;
  }
  return `MAX(value)`;
}

const MetricForm: FC<MetricFormProps> = ({
  current,
  edit,
  duplicate = false,
  onClose,
  source,
  initialStep = 0,
  advanced = false,
  inline,
  cta = "Save",
  onSuccess,
  secondaryCTA,
  switchToFact,
}) => {
  const {
    datasources,
    getDatasourceById,
    metrics,
    projects,
    project,
    factTables,
    mutateDefinitions,
  } = useDefinitions();
  const settings = useOrgSettings();
  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();

  const [step, setStep] = useState(initialStep);
  const [showAdvanced, setShowAdvanced] = useState(advanced);
  const [hideTags, setHideTags] = useState(!current?.tags?.length);
  const [sqlOpen, setSqlOpen] = useState(false);

  const currentDatasource = current?.datasource
    ? getDatasourceById(current?.datasource)
    : null;

  const currentDefaultSql =
    currentDatasource && current.type && current.name
      ? getInitialMetricQuery(currentDatasource, current.type)[1]
      : null;

  // Only set the default to true for new metrics with no sql or an edited or
  // duplicated one where the sql matches the default.
  const [allowAutomaticSqlReset, setAllowAutomaticSqlReset] = useState(
    !current || !current?.sql || current?.sql === currentDefaultSql,
  );

  // Keeps track if the queryFormat is "builder" because it is the default, or
  // if it is "builder" because the user manually changed it to that.
  const [usingDefaultQueryFormat, setUsingDefaultQueryFormat] = useState(
    !current?.queryFormat && !current?.sql,
  );

  const [showSqlResetConfirmationModal, setShowSqlResetConfirmationModal] =
    useState(false);

  const displayCurrency = useCurrency();

  const {
    getMinSampleSizeForMetric,
    getMinPercentageChangeForMetric,
    getMaxPercentageChangeForMetric,
    getTargetMDEForMetric,
    metricDefaults,
  } = useOrganizationMetricDefaults();

  const validDatasources = datasources.filter(
    (d) =>
      d.id === current.datasource ||
      isProjectListValidForProject(d.projects, project),
  );

  useEffect(() => {
    track("View Metric Form", {
      source,
    });
  }, [source]);

  const metricTypeOptions = [
    {
      value: "binomial",
      label: "Binomial",
      description: "Percent of users who do something (click, view, etc.)",
    },
    {
      value: "count",
      label: "Count",
      description: "Number of actions per user (clicks, views, etc.)",
    },
    {
      value: "duration",
      label: "Duration",
      description:
        "How long something takes (time on site, loading speed, etc.)",
    },
    {
      value: "revenue",
      label: "Revenue",
      description: `How much money a user pays in ${displayCurrency} (revenue per visitor, average order value, etc.)`,
    },
  ];

  const initialDatasourceId =
    current?.datasource || settings?.defaultDataSource;
  const initialDatasource =
    validDatasources.find((d) => d.id === initialDatasourceId) ||
    validDatasources[0];

  const form = useForm({
    defaultValues: {
      datasource: initialDatasource?.id || "",
      name: current.name || "",
      description: current.description || "",
      type: current.type || "binomial",
      table: current.table || "",
      denominator: current.denominator || "",
      column: current.column || "",
      inverse: !!current.inverse,
      ignoreNulls: !!current.ignoreNulls,
      queryFormat: current.queryFormat || (current.sql ? "sql" : "builder"),
      cappingSettings:
        current.cappingSettings || metricDefaults.cappingSettings,
      windowSettings: current.windowSettings || metricDefaults.windowSettings,
      sql: current.sql || "",
      eventName: current.templateVariables?.eventName || "",
      valueColumn: current.templateVariables?.valueColumn || "",
      aggregation: current.aggregation || "",
      conditions: current.conditions || [],
      userIdTypes: current.userIdTypes || [],
      userIdColumns: current.userIdColumns || {},
      timestampColumn: current.timestampColumn || "",
      tags: current.tags || [],
      projects:
        source === "datasource-detail" || edit || duplicate
          ? current.projects || []
          : project
            ? [project]
            : [],
      winRisk: (current.winRisk || DEFAULT_WIN_RISK_THRESHOLD) * 100,
      loseRisk: (current.loseRisk || DEFAULT_LOSE_RISK_THRESHOLD) * 100,
      maxPercentChange: getMaxPercentageChangeForMetric(current) * 100,
      minPercentChange: getMinPercentageChangeForMetric(current) * 100,
      targetMDE: getTargetMDEForMetric(current) * 100,
      minSampleSize: getMinSampleSizeForMetric(current),
      regressionAdjustmentOverride:
        current.regressionAdjustmentOverride ?? false,
      regressionAdjustmentEnabled:
        current.regressionAdjustmentEnabled ??
        DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
      regressionAdjustmentDays:
        current.regressionAdjustmentDays ??
        settings.regressionAdjustmentDays ??
        DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
      priorSettings:
        current.priorSettings ||
        (metricDefaults.priorSettings ?? {
          override: false,
          proper: false,
          mean: 0,
          stddev: DEFAULT_PROPER_PRIOR_STDDEV,
        }),
      managedBy: current.managedBy || MANAGED_BY_EMPTY,
    },
  });

  const { apiCall, orgId } = useAuth();

  const type = form.watch("type");

  const value = {
    name: form.watch("name"),
    queryFormat: form.watch("queryFormat"),
    datasource: form.watch("datasource"),
    timestampColumn: form.watch("timestampColumn"),
    userIdColumns: form.watch("userIdColumns"),
    userIdTypes: form.watch("userIdTypes"),
    denominator: form.watch("denominator"),
    aggregation: form.watch("aggregation"),
    column: form.watch("column"),
    table: form.watch("table"),
    type,
    winRisk: form.watch("winRisk"),
    loseRisk: form.watch("loseRisk"),
    tags: form.watch("tags"),
    projects: form.watch("projects"),
    sql: form.watch("sql"),
    templateVariables: {
      eventName: form.watch("eventName"),
      valueColumn: form.watch("valueColumn"),
    },
    conditions: form.watch("conditions"),
    regressionAdjustmentOverride: form.watch("regressionAdjustmentOverride"),
    regressionAdjustmentEnabled: form.watch("regressionAdjustmentEnabled"),
    regressionAdjustmentDays: form.watch("regressionAdjustmentDays"),
    priorSettings: form.watch("priorSettings"),
  };

  // We want to show a warning when someone tries to create a metric for just the demo project
  const isExclusivelyForDemoDatasourceProject = useMemo(() => {
    const projects = value.projects || [];

    if (projects.length !== 1) return false;

    return isDemoDatasourceProject({
      projectId: projects[0],
      organizationId: orgId || "",
    });
  }, [orgId, value.projects]);

  const { demoDataSourceId } = useDemoDataSourceProject();

  const denominatorOptions = useMemo(() => {
    return metrics
      .filter((m) => m.id !== current?.id)
      .filter((m) => m.datasource === value.datasource)
      .filter((m) => {
        // Binomial metrics can always be a denominator
        // That just makes it act like a funnel (or activation) metric
        if (m.type === "binomial") return true;

        // If the numerator has a value (not binomial),
        // then count metrics can be used as the denominator as well (as long as they don't have their own denominator)
        // This makes it act like a true ratio metric
        return value.type !== "binomial" && !m.denominator;
      })
      .map((m) => {
        return {
          value: m.id,
          label: m.name,
        };
      });
  }, [metrics, value.type, value.datasource, current?.id]);

  const selectedDataSource = getDatasourceById(value.datasource);

  const datasourceType = selectedDataSource?.type;

  const datasourceSettingsSupport =
    selectedDataSource?.properties?.hasSettings || false;

  const capSupported = selectedDataSource?.properties?.metricCaps || false;

  // TODO: eventually make each of these their own independent properties
  const conditionsSupported = capSupported;
  const ignoreNullsSupported = capSupported;
  const conversionWindowSupported = capSupported;

  const hasSQLDataSources = datasources.some(
    (d) => d.properties?.queryLanguage === "sql",
  );

  const supportsSQL = selectedDataSource?.properties?.queryLanguage === "sql";
  const supportsJS =
    selectedDataSource?.properties?.queryLanguage === "javascript";

  const customzeTimestamp = supportsSQL;
  const customizeUserIds = supportsSQL;

  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment",
  );
  let regressionAdjustmentAvailableForMetric = true;
  let regressionAdjustmentAvailableForMetricReason = <></>;

  if (form.watch("denominator")) {
    const denominator = metrics.find((m) => m.id === form.watch("denominator"));
    if (denominator && !isBinomialMetric(denominator)) {
      regressionAdjustmentAvailableForMetric = false;
      regressionAdjustmentAvailableForMetricReason = (
        <>
          Not available for ratio metrics with <em>{denominator.type}</em>{" "}
          denominators, unless you use Fact Tables.
        </>
      );
    }
  }

  let table = "Table";
  let column = "Column";
  if (selectedDataSource?.properties?.events) {
    table = "Event";
    column = "Property";
  }

  const conditions = useFieldArray({
    control: form.control,
    name: "conditions",
  });

  const defaultSqlTemplate = selectedDataSource
    ? getInitialMetricQuery(selectedDataSource, value.type)[1]
    : "";

  const resetSqlToDefault = (datasource, type) => {
    if (datasource && datasource.properties?.queryLanguage === "sql") {
      const [userTypes, sql] = getInitialMetricQuery(datasource, type);
      if (usingDefaultQueryFormat) {
        // The default queryFormat for new sql queries should be "sql", but we
        // won't change it later if they manually change it to "builder".
        form.setValue("queryFormat", "sql");
        setUsingDefaultQueryFormat(false);
      }
      form.setValue("sql", sql);
      form.setValue("userIdTypes", userTypes);

      // Now that sql is updated again to the default, we'll allow it to be
      // automatically reset again upon datasource/type/name change until
      // they make a new manual edit.
      setAllowAutomaticSqlReset(true);
    }
  };

  const onSubmit = form.handleSubmit(async (value) => {
    const {
      winRisk,
      loseRisk,
      maxPercentChange,
      minPercentChange,
      targetMDE,
      eventName,
      valueColumn,
      ...otherValues
    } = value;

    const sendValue: Partial<MetricInterface> = {
      ...otherValues,
      templateVariables: { eventName, valueColumn },
      winRisk: winRisk / 100,
      loseRisk: loseRisk / 100,
      maxPercentChange: maxPercentChange / 100,
      minPercentChange: minPercentChange / 100,
      targetMDE: targetMDE / 100,
    };

    if (value.loseRisk < value.winRisk) return;

    const body = JSON.stringify(sendValue);

    if (edit) {
      await apiCall(`/metric/${current.id}`, {
        method: "PUT",
        body,
      });
    } else {
      await apiCall(`/metrics`, {
        method: "POST",
        body,
      });
    }

    mutateDefinitions();

    track("Submit Metric Form", {
      type: value.type,
      source,
      userIdType: value.userIdTypes.join(", "),
    });

    onSuccess && onSuccess();
  });

  const riskError =
    value.loseRisk < value.winRisk
      ? "The acceptable risk percentage cannot be higher than the too risky percentage"
      : "";

  const regressionAdjustmentDaysHighlightColor =
    value.regressionAdjustmentDays > 28 || value.regressionAdjustmentDays < 7
      ? "#e27202"
      : "";

  const regressionAdjustmentDaysWarningMsg =
    value.regressionAdjustmentDays > 28
      ? "Longer lookback periods can sometimes be useful, but also will reduce query performance and may incorporate less useful data"
      : value.regressionAdjustmentDays < 7
        ? "Lookback periods under 7 days tend not to capture enough metric data to reduce variance and may be subject to weekly seasonality"
        : "";

  const customAggregationWarningMsg = value.aggregation
    ? "When using a custom aggregation, it is safest to COALESCE values in your SQL so that the `value` column has no NULL values."
    : "";

  const requiredColumns = useMemo(() => {
    const set = new Set(["timestamp", ...value.userIdTypes]);
    if (type !== "binomial") {
      set.add("value");
    }
    return set;
  }, [value.userIdTypes, type]);

  useEffect(() => {
    if (type === "binomial") {
      form.setValue("ignoreNulls", false);
    }
  }, [type, form]);

  const { setTableId, tableOptions, columnOptions } = useSchemaFormOptions(
    // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'DataSourceInterfaceWithParams | ... Remove this comment to see the full error message
    selectedDataSource,
  );

  let ctaEnabled = true;
  let disabledMessage: string | null = null;

  if (riskError) {
    ctaEnabled = false;
    disabledMessage = riskError;
  } else if (!permissionsUtil.canCreateMetric({ projects: value.projects })) {
    ctaEnabled = false;
    disabledMessage = "You don't have permission to create metrics.";
  }

  const projectOptions = useProjectOptions(
    (project) => permissionsUtil.canCreateMetric({ projects: [project] }),
    form.watch("projects") || [],
  );

  const trackingEventModalType = edit ? "edit-metric" : "new-metric";

  return (
    <>
      {supportsSQL && sqlOpen && (
        <EditSqlModal
          close={() => setSqlOpen(false)}
          sqlObjectInfo={{ objectType: "Metric", objectName: value.name }}
          datasourceId={value.datasource}
          placeholder={
            "SELECT\n      user_id as user_id, timestamp as timestamp\nFROM\n      test"
          }
          requiredColumns={requiredColumns}
          value={value.sql}
          save={async (sql) => {
            form.setValue("sql", sql);
            // If they manually edit the sql back to the default, we'll allow it to be
            // automatically updated again upon datasource/type/name change.  If they
            // have editted it to something else, we'll make sure not to overwrite any
            // of their changes automatically.
            setAllowAutomaticSqlReset(sql == defaultSqlTemplate);
          }}
          templateVariables={{
            eventName: form.watch("eventName"),
            valueColumn: form.watch("valueColumn"),
          }}
        />
      )}
      <PagedModal
        trackingEventModalType={trackingEventModalType}
        inline={inline}
        header={edit ? "Edit Metric" : "New Metric"}
        close={onClose}
        // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'null' is not assignable to type 'string | un... Remove this comment to see the full error message
        disabledMessage={disabledMessage}
        ctaEnabled={ctaEnabled}
        submit={onSubmit}
        cta={cta}
        // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'false | "Cancel"' is not assignable to type ... Remove this comment to see the full error message
        closeCta={!inline && "Cancel"}
        size="lg"
        docSection="metrics"
        step={step}
        setStep={setStep}
        secondaryCTA={secondaryCTA}
      >
        <Page
          display="Basic Info"
          enabled
          validate={async () => {
            validateBasicInfo(form.getValues());
            if (allowAutomaticSqlReset) {
              resetSqlToDefault(selectedDataSource, value.type);
            }
          }}
        >
          {isExclusivelyForDemoDatasourceProject ? (
            <Callout status="warning">
              You are creating a metric under the demo datasource project.
            </Callout>
          ) : switchToFact && factTables.length > 0 ? (
            <Callout status="info" mb="3">
              You are creating a legacy SQL metric.{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  switchToFact();
                }}
              >
                Switch to use Fact Tables <FaArrowRight />
              </a>
            </Callout>
          ) : switchToFact && hasSQLDataSources ? (
            <Callout status="info" mb="3">
              Use Fact Tables for an easier and faster way to create metrics.{" "}
              <Link href="/fact-tables">
                Learn More <FaArrowRight />
              </Link>
            </Callout>
          ) : null}
          <div className="form-group">
            <label>Metric Name</label>
            <input
              type="text"
              required
              className="form-control"
              {...form.register("name")}
            />
          </div>
          <div className="form-group">
            {hideTags ? (
              <a
                href="#"
                style={{ fontSize: "0.8rem" }}
                onClick={(e) => {
                  e.preventDefault();
                  setHideTags(false);
                }}
              >
                Add tags{" "}
              </a>
            ) : (
              <>
                <label>Tags</label>
                <TagsInput
                  value={value.tags}
                  onChange={(tags) => form.setValue("tags", tags)}
                />
              </>
            )}
          </div>
          {projects?.length > 0 && (
            <div className="form-group">
              <MultiSelectField
                label={
                  <>
                    Projects{" "}
                    <Tooltip
                      body={`The dropdown below has been filtered to only include projects where you have permission to ${
                        edit ? "update" : "create"
                      } Metrics.`}
                    />
                  </>
                }
                placeholder="All projects"
                value={value.projects || []}
                options={projectOptions}
                onChange={(v) => form.setValue("projects", v)}
                customClassName="label-overflow-ellipsis"
                helpText="Assign this metric to specific projects"
                disabled={isExclusivelyForDemoDatasourceProject}
              />
            </div>
          )}
          <SelectField
            label="Data Source"
            value={
              isExclusivelyForDemoDatasourceProject && demoDataSourceId
                ? demoDataSourceId
                : value.datasource || ""
            }
            onChange={(v) => {
              form.setValue("datasource", v);
              if (allowAutomaticSqlReset) {
                resetSqlToDefault(getDatasourceById(v), value.type);
              }
            }}
            options={validDatasources.map((d) => {
              const defaultDatasource = d.id === settings.defaultDataSource;
              return {
                value: d.id,
                label: `${d.name}${
                  d.description ? ` — ${d.description}` : ""
                } ${defaultDatasource ? " (default)" : ""}`,
              };
            })}
            className="portal-overflow-ellipsis"
            name="datasource"
            required={!edit}
            disabled={
              isExclusivelyForDemoDatasourceProject ||
              edit ||
              source === "datasource-detail"
            }
          />
          <div>
            <label>Metric Type</label>
            <RadioGroup
              value={value.type}
              setValue={(val: MetricType) => {
                form.setValue("type", val);

                if (allowAutomaticSqlReset) {
                  resetSqlToDefault(selectedDataSource, val);
                }

                if (val === "count") {
                  form.setValue("valueColumn", "1");
                } else if (value.templateVariables?.valueColumn === "1") {
                  // 1 only makes sense for count type, but keep it if it's already set to something else
                  form.setValue("valueColumn", "");
                }
              }}
              options={metricTypeOptions}
            />
          </div>
        </Page>
        <Page
          display="Query Settings"
          enabled
          validate={async () => {
            validateQuerySettings(
              datasourceSettingsSupport,
              supportsSQL && value.queryFormat === "sql",
              value,
            );
          }}
        >
          {supportsSQL && (
            <div className="form-group bg-light border px-3 py-2">
              <div className="form-check form-check-inline">
                <input
                  className="form-check-input"
                  type="radio"
                  name="input-mode"
                  value="sql"
                  id="sql-input-mode"
                  checked={value.queryFormat === "sql"}
                  onChange={(e) =>
                    form.setValue(
                      "queryFormat",
                      e.target.checked ? "sql" : "builder",
                    )
                  }
                />
                <label className="form-check-label" htmlFor="sql-input-mode">
                  SQL
                </label>
              </div>
              <div className="form-check form-check-inline">
                <input
                  className="form-check-input"
                  type="radio"
                  name="input-mode"
                  value="builder"
                  id="query-builder-input-mode"
                  checked={value.queryFormat === "builder"}
                  onChange={(e) =>
                    form.setValue(
                      "queryFormat",
                      e.target.checked ? "builder" : "sql",
                    )
                  }
                />
                <label
                  className="form-check-label"
                  htmlFor="query-builder-input-mode"
                >
                  Query Builder
                </label>
              </div>
            </div>
          )}
          <div className="row">
            <div className="col-lg">
              {supportsSQL && value.queryFormat === "sql" ? (
                <div>
                  <MultiSelectField
                    value={value.userIdTypes}
                    onChange={(types) => {
                      form.setValue("userIdTypes", types);
                    }}
                    options={(
                      selectedDataSource.settings.userIdTypes || []
                    ).map(({ userIdType }) => ({
                      value: userIdType,
                      label: userIdType,
                    }))}
                    label="Identifier Types Supported"
                  />
                  {value.sql && usesEventName(value.sql) && (
                    <div className="form-group">
                      <Field
                        label="Event Name"
                        placeholder={value.name}
                        helpText="The event name associated with this metric.  This can then be referenced in your sql template as {{eventName}}."
                        {...form.register("eventName")}
                      />
                    </div>
                  )}
                  {value.sql &&
                    usesValueColumn(value.sql) &&
                    value.type != "binomial" && (
                      <div className="form-group">
                        <Field
                          label="Value Column"
                          helpText={
                            value.type === "count"
                              ? "Use 1 to count the number of rows (most common). This can then be referenced in your sql template as {{valueColumn}}."
                              : "The column in your datawarehouse table with the metric data.  This can then be referenced in your sql template as {{valueColumn}}."
                          }
                          {...form.register("valueColumn")}
                        ></Field>
                      </div>
                    )}
                  <div className="form-group">
                    <label>Query</label>
                    {value.sql && (
                      <Code language="sql" code={value.sql} expandable={true} />
                    )}
                    <div>
                      <button
                        className="btn btn-outline-primary"
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          setSqlOpen(true);
                        }}
                      >
                        {value.sql ? "Edit" : "Add"} SQL <FaExternalLinkAlt />
                      </button>
                      {value.sql != defaultSqlTemplate && (
                        <button
                          className="btn btn-outline-primary ml-2"
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            setShowSqlResetConfirmationModal(true);
                          }}
                        >
                          Reset to default SQL
                        </button>
                      )}
                      {showSqlResetConfirmationModal && (
                        <ConfirmModal
                          title={"Reset to default SQL"}
                          subtitle="This will reset both your SQL and identifier types to the default template for your datasource and type."
                          yesText="Reset"
                          noText="Cancel"
                          modalState={showSqlResetConfirmationModal}
                          setModalState={(state) =>
                            setShowSqlResetConfirmationModal(state)
                          }
                          onConfirm={async () => {
                            resetSqlToDefault(selectedDataSource, value.type);
                            setShowSqlResetConfirmationModal(false);
                          }}
                        />
                      )}
                    </div>
                  </div>
                  {value.type !== "binomial" && (
                    <div className="mb-2">
                      <Field
                        label="User Value Aggregation"
                        placeholder="SUM(value)"
                        textarea
                        minRows={1}
                        containerClassName="mb-0"
                        {...form.register("aggregation")}
                        helpText="When there are multiple metric rows for a user"
                      />
                      {customAggregationWarningMsg && (
                        <small>{customAggregationWarningMsg}</small>
                      )}
                    </div>
                  )}
                  <SelectField
                    label="Denominator"
                    options={denominatorOptions}
                    initialOption="All Experiment Users"
                    value={value.denominator}
                    onChange={(denominator) => {
                      form.setValue("denominator", denominator);
                    }}
                    helpText="Use this to define ratio or funnel metrics"
                  />
                </div>
              ) : datasourceType === "google_analytics" ? (
                <GoogleAnalyticsMetrics
                  inputProps={form.register("table")}
                  type={value.type}
                />
              ) : (
                <>
                  <SelectField
                    label={`${table} Name`}
                    createable
                    placeholder={`${table} name...`}
                    value={form.watch("table")}
                    onChange={(value) => {
                      form.setValue("table", value);
                      setTableId(value);
                    }}
                    options={tableOptions}
                    required
                  />
                  {value.type !== "binomial" && (
                    <SelectField
                      placeholder={column}
                      label={supportsSQL ? "Column" : "Event Value"}
                      options={columnOptions}
                      createable
                      value={form.watch("column")}
                      onChange={(value) => form.setValue("column", value)}
                      required={value.type !== "count"}
                      helpText={
                        !supportsSQL &&
                        "Javascript expression to extract a value from each event."
                      }
                    />
                  )}
                  {value.type !== "binomial" && !supportsSQL && (
                    <Field
                      label="User Value Aggregation"
                      placeholder="sum(values)"
                      textarea
                      minRows={1}
                      {...form.register("aggregation")}
                      helpText="Javascript expression to aggregate multiple event values for a user."
                    />
                  )}
                  {conditionsSupported && (
                    <div className="mb-3">
                      {conditions.fields.length > 0 && <h6>Conditions</h6>}
                      {conditions.fields.map((cond: Condition, i) => (
                        <div
                          className="form-row border py-2 mb-2 align-items-center"
                          key={i}
                        >
                          {i > 0 && <div className="col-auto">AND</div>}
                          <div className="col-auto mb-1">
                            <SelectField
                              createable
                              placeholder={column}
                              options={columnOptions}
                              value={form.watch(`conditions.${i}.column`)}
                              onChange={(value) =>
                                form.setValue(`conditions.${i}.column`, value)
                              }
                              required
                            />
                          </div>
                          <div className="col-auto mb-1">
                            <SelectField
                              value={form.watch(`conditions.${i}.operator`)}
                              onChange={(v) =>
                                form.setValue(
                                  `conditions.${i}.operator`,
                                  v as Operator,
                                )
                              }
                              options={(() => {
                                const ret = [
                                  { value: "=", label: "equals" },
                                  { value: "!=", label: "does not equal" },
                                  { value: "~", label: "matches the regex" },
                                  {
                                    value: "!~",
                                    label: "does not match the regex",
                                  },
                                  { value: "<", label: "is less than" },
                                  { value: ">", label: "is greater than" },
                                  {
                                    value: "<=",
                                    label: "is less than or equal to",
                                  },
                                  {
                                    value: ">=",
                                    label: "is greater than or equal to",
                                  },
                                ];
                                if (supportsJS)
                                  ret.push({
                                    value: "=>",
                                    label: "custom javascript",
                                  });
                                return ret;
                              })()}
                              sort={false}
                            />
                          </div>
                          <div className="col-auto mb-1">
                            <Field
                              required
                              placeholder="Value"
                              textarea={
                                form.watch(`conditions.${i}.operator`) === "=>"
                              }
                              minRows={1}
                              {...form.register(`conditions.${i}.value`)}
                            />
                          </div>
                          <div className="col-auto mb-1">
                            <button
                              className="btn btn-danger"
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                conditions.remove(i);
                              }}
                            >
                              &times;
                            </button>
                          </div>
                        </div>
                      ))}
                      <button
                        className="btn btn-outline-success"
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();

                          conditions.append({
                            column: "",
                            operator: "=",
                            value: "",
                          });
                        }}
                      >
                        Add Condition
                      </button>
                    </div>
                  )}
                  {customzeTimestamp && (
                    <SelectField
                      label="Timestamp Column"
                      createable
                      options={columnOptions}
                      value={form.watch("timestampColumn")}
                      onChange={(value) =>
                        form.setValue("timestampColumn", value)
                      }
                      placeholder={"received_at"}
                    />
                  )}
                  {customizeUserIds && (
                    <MultiSelectField
                      value={value.userIdTypes}
                      onChange={(types) => {
                        form.setValue("userIdTypes", types);
                      }}
                      options={(
                        selectedDataSource.settings.userIdTypes || []
                      ).map(({ userIdType }) => ({
                        value: userIdType,
                        label: userIdType,
                      }))}
                      label="Identifier Types Supported"
                    />
                  )}
                  {customizeUserIds &&
                    value.userIdTypes.map((type) => {
                      return (
                        <div key={type}>
                          <SelectField
                            label={type + " Column"}
                            createable
                            options={columnOptions}
                            value={value.userIdColumns[type] || ""}
                            placeholder={type}
                            onChange={(columnName) => {
                              form.setValue("userIdColumns", {
                                ...value.userIdColumns,
                                [type]: columnName,
                              });
                            }}
                          />
                        </div>
                      );
                    })}
                </>
              )}
            </div>
            {supportsSQL && value.queryFormat !== "sql" && (
              <div className="col-lg pt-2">
                <SQLInputField
                  userEnteredQuery={getRawSQLPreview(value)}
                  datasourceId={value.datasource}
                  form={form}
                  requiredColumns={requiredColumns}
                  showPreview
                  queryType="metric"
                />
                {value.type !== "binomial" && (
                  <div className="mt-2">
                    <label>User Value Aggregation:</label>
                    <Code language="sql" code={getAggregateSQLPreview(value)} />
                    <small className="text-muted">
                      When there are multiple metric rows for a user
                    </small>
                  </div>
                )}
              </div>
            )}
          </div>
        </Page>
        <Page display="Behavior">
          <div className="form-group">
            <label>What is the Goal?</label>
            <SelectField
              value={form.watch("inverse") ? "1" : "0"}
              onChange={(v) => {
                form.setValue("inverse", v === "1");
              }}
              options={[
                {
                  value: "0",
                  label: `Increase the ${
                    value.type === "binomial" ? "conversion rate" : value.type
                  }`,
                },
                {
                  value: "1",
                  label: `Decrease the ${
                    value.type === "binomial" ? "conversion rate" : value.type
                  }`,
                },
              ]}
            />
          </div>

          {capSupported &&
            ["count", "duration", "revenue"].includes(value.type) && (
              <MetricCappingSettingsForm
                form={form}
                datasourceType={datasourceType}
                metricType={value.type}
              />
            )}

          {conversionWindowSupported && (
            <MetricWindowSettingsForm form={form} type={""} />
          )}

          {!showAdvanced ? (
            <a
              href="#"
              style={{ fontSize: "0.8rem" }}
              onClick={(e) => {
                e.preventDefault();
                setShowAdvanced(true);
              }}
            >
              Show advanced options{" "}
            </a>
          ) : (
            <>
              <MetricDelaySettings form={form} />

              <MetricPriorSettingsForm
                priorSettings={form.watch("priorSettings")}
                setPriorSettings={(priorSettings) =>
                  form.setValue("priorSettings", priorSettings)
                }
                metricDefaults={metricDefaults}
              />

              {ignoreNullsSupported && value.type !== "binomial" && (
                <div className="form-group">
                  <SelectField
                    label="Converted Users Only"
                    required
                    value={form.watch("ignoreNulls") ? "1" : "0"}
                    onChange={(v) => {
                      form.setValue("ignoreNulls", v === "1");
                    }}
                    containerClassName="mb-0"
                    options={[
                      {
                        value: "0",
                        label: "No",
                      },
                      {
                        value: "1",
                        label: "Yes",
                      },
                    ]}
                  />
                  <small className="text-muted">
                    If yes, exclude anyone with a metric value less than or
                    equal to zero from analysis.
                  </small>
                </div>
              )}

              <RiskThresholds
                winRisk={value.winRisk}
                loseRisk={value.loseRisk}
                winRiskRegisterField={form.register("winRisk")}
                loseRiskRegisterField={form.register("loseRisk")}
                riskError={riskError}
              />

              <div className="form-group">
                <label>Minimum Metric Total</label>
                <input
                  type="number"
                  className="form-control"
                  {...form.register("minSampleSize", { valueAsNumber: true })}
                />
                <small className="text-muted">
                  The{" "}
                  {value.type === "binomial"
                    ? "number of conversions"
                    : `total ${value.type}`}{" "}
                  required in an experiment variation before showing results
                  (default{" "}
                  {value.type === "binomial"
                    ? metricDefaults.minimumSampleSize
                    : getMetricFormatter(value.type)(
                        metricDefaults.minimumSampleSize,
                        {
                          currency: displayCurrency,
                        },
                      )}
                  )
                </small>
              </div>
              <Field
                label="Max Percent Change"
                type="number"
                step="any"
                append="%"
                {...form.register("maxPercentChange", { valueAsNumber: true })}
                helpText={`An experiment that changes the metric by more than this percent will
            be flagged as suspicious (default ${
              metricDefaults.maxPercentageChange * 100
            }%)`}
              />
              <Field
                label="Min Percent Change"
                type="number"
                step="any"
                append="%"
                {...form.register("minPercentChange", { valueAsNumber: true })}
                helpText={`An experiment that changes the metric by less than this percent will be
            considered a draw (default ${
              metricDefaults.minPercentageChange * 100
            }%)`}
              />
              <Field
                label="Target MDE"
                type="number"
                step="any"
                append="%"
                {...form.register("targetMDE", { valueAsNumber: true })}
                helpText={`The percentage change that you want to reliably detect before ending your experiment. This is used to estimate the "Days Left" for running experiments. (default ${
                  metricDefaults.targetMDE * 100
                }%)`}
              />

              <PremiumTooltip commercialFeature="regression-adjustment">
                <label className="mb-1">
                  <GBCuped /> Regression Adjustment (CUPED)
                </label>
              </PremiumTooltip>
              <div className="px-3 py-2 pb-0 mb-2 border rounded">
                {regressionAdjustmentAvailableForMetric ? (
                  <>
                    <div className="form-group mb-0 mr-0 form-inline">
                      <div className="form-inline my-1">
                        <input
                          type="checkbox"
                          className="form-check-input"
                          {...form.register("regressionAdjustmentOverride")}
                          id={"toggle-regressionAdjustmentOverride"}
                          disabled={!hasRegressionAdjustmentFeature}
                        />
                        <label
                          className="mr-1 cursor-pointer"
                          htmlFor="toggle-regressionAdjustmentOverride"
                        >
                          Override organization-level settings
                        </label>
                      </div>
                    </div>
                    <div
                      style={{
                        display: form.watch("regressionAdjustmentOverride")
                          ? "block"
                          : "none",
                      }}
                    >
                      <div className="d-flex my-2 border-bottom"></div>
                      <Flex
                        direction="column"
                        className="form-group mt-3 mb-0 mr-2"
                      >
                        <Switch
                          id={"toggle-regressionAdjustmentEnabled"}
                          label="Apply regression adjustment for this metric"
                          value={!!form.watch("regressionAdjustmentEnabled")}
                          onChange={(value) => {
                            form.setValue("regressionAdjustmentEnabled", value);
                          }}
                          disabled={!hasRegressionAdjustmentFeature}
                        />
                        <small className="form-text text-muted">
                          (organization default:{" "}
                          {settings.regressionAdjustmentEnabled ? "On" : "Off"})
                        </small>
                      </Flex>

                      <div
                        className="form-group mt-3 mb-1 mr-2"
                        style={{
                          opacity: form.watch("regressionAdjustmentEnabled")
                            ? "1"
                            : "0.5",
                        }}
                      >
                        <Field
                          label="Pre-exposure lookback period (days)"
                          type="number"
                          style={{
                            borderColor: regressionAdjustmentDaysHighlightColor,
                            backgroundColor:
                              regressionAdjustmentDaysHighlightColor
                                ? regressionAdjustmentDaysHighlightColor + "15"
                                : "",
                          }}
                          className="ml-2"
                          containerClassName="mb-0 form-inline"
                          inputGroupClassName="d-inline-flex w-150px"
                          append="days"
                          min="0"
                          max="100"
                          disabled={!hasRegressionAdjustmentFeature}
                          helpText={
                            <>
                              <span className="ml-2">
                                (organization default:{" "}
                                {settings.regressionAdjustmentDays ??
                                  DEFAULT_REGRESSION_ADJUSTMENT_DAYS}
                                )
                              </span>
                            </>
                          }
                          {...form.register("regressionAdjustmentDays", {
                            valueAsNumber: true,
                            validate: (v) => {
                              return !(v <= 0 || v > 100);
                            },
                          })}
                        />
                        {regressionAdjustmentDaysWarningMsg && (
                          <small
                            style={{
                              color: regressionAdjustmentDaysHighlightColor,
                            }}
                          >
                            {regressionAdjustmentDaysWarningMsg}
                          </small>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-muted">
                    <FaTimes className="text-danger" />{" "}
                    {regressionAdjustmentAvailableForMetricReason}
                  </div>
                )}
              </div>
            </>
          )}
        </Page>
      </PagedModal>
    </>
  );
};

export default MetricForm;
