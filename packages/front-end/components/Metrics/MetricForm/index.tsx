import React, { FC, ReactElement, useEffect, useMemo, useState } from "react";
import {
  Condition,
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
import Toggle from "@/components/Forms/Toggle";
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
import RadioGroup from "@/components/Radix/RadioGroup";
import Callout from "@/components/Radix/Callout";
import { MetricWindowSettingsForm } from "./MetricWindowSettingsForm";
import { MetricCappingSettingsForm } from "./MetricCappingSettingsForm";
import { MetricDelayHours } from "./MetricDelayHours";

const weekAgo = new Date();
weekAgo.setDate(weekAgo.getDate() - 7);

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
  }
) {
  // Require specific columns to be selected
  const requiredCols = ["timestamp", ...userIdTypes];
  if (type !== "binomial") {
    requiredCols.push("value");
    if (usesValueColumn(sql) && !templateVariables?.valueColumn) {
      throw new Error("需要值列");
    }
  }
  if (usesEventName(sql) && !templateVariables?.eventName) {
    throw new Error("需要事件名");
  }

  validateSQL(sql, requiredCols);
}

function validateBasicInfo(value: { name: string }) {
  if (value.name.length < 1) {
    throw new Error("指标名称不能为空");
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
  }
) {
  if (!datasourceSettingsSupport) {
    return;
  }
  if (sqlInput) {
    validateMetricSQL(
      value.sql,
      value.type,
      value.userIdTypes,
      value.templateVariables
    );
  } else {
    if (value.table.length < 1) {
      throw new Error("表名不能为空");
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
  cta = "保存",
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
    !current || !current?.sql || current?.sql === currentDefaultSql
  );

  // Keeps track if the queryFormat is "builder" because it is the default, or
  // if it is "builder" because the user manually changed it to that.
  const [usingDefaultQueryFormat, setUsingDefaultQueryFormat] = useState(
    !current?.queryFormat && !current?.sql
  );

  const [
    showSqlResetConfirmationModal,
    setShowSqlResetConfirmationModal,
  ] = useState(false);

  const displayCurrency = useCurrency();

  const {
    getMinSampleSizeForMetric,
    getMinPercentageChangeForMetric,
    getMaxPercentageChangeForMetric,
    metricDefaults,
  } = useOrganizationMetricDefaults();

  const validDatasources = datasources.filter(
    (d) =>
      d.id === current.datasource ||
      isProjectListValidForProject(d.projects, project)
  );

  useEffect(() => {
    track("查看指标表单", {
      source,
    });
  }, [source]);

  const metricTypeOptions = [
    {
      value: "binomial",
      label: "二项式",
      description: "执行某项操作（点击、查看等）的用户百分比",
    },
    {
      value: "count",
      label: "计数",
      description: "每个用户的操作次数（点击、查看等）",
    },
    {
      value: "duration",
      label: "时长",
      description: "某事花费的时间（在网站上的时间、加载速度等）",
    },
    {
      value: "revenue",
      label: "收入",
      description: `用户以${displayCurrency}支付的金额（每位访客的收入、平均订单价值等）`,
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
    (d) => d.properties?.queryLanguage === "sql"
  );

  const supportsSQL = selectedDataSource?.properties?.queryLanguage === "sql";
  const supportsJS =
    selectedDataSource?.properties?.queryLanguage === "javascript";

  const customzeTimestamp = supportsSQL;
  const customizeUserIds = supportsSQL;

  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment"
  );
  let regressionAdjustmentAvailableForMetric = true;
  let regressionAdjustmentAvailableForMetricReason = <></>;

  if (form.watch("denominator")) {
    const denominator = metrics.find((m) => m.id === form.watch("denominator"));
    if (denominator?.type === "count") {
      regressionAdjustmentAvailableForMetric = false;
      regressionAdjustmentAvailableForMetricReason = (
        <>
          对于分母为<em>计数</em>的比率指标，不可进行回归调整。
        </>
      );
    }
  }

  let table = "表";
  let column = "列";
  if (selectedDataSource?.properties?.events) {
    table = "事件";
    column = "属性";
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

    track("提交指标表单", {
      type: value.type,
      source,
      userIdType: value.userIdTypes.join(", "),
    });

    onSuccess && onSuccess();
  });

  const riskError =
    value.loseRisk < value.winRisk
      ? "可接受的风险百分比不能高于风险过高的百分比"
      : "";

  const regressionAdjustmentDaysHighlightColor =
    value.regressionAdjustmentDays > 28 || value.regressionAdjustmentDays < 7
      ? "#e27202"
      : "";

  const regressionAdjustmentDaysWarningMsg =
    value.regressionAdjustmentDays > 28
      ? "较长的回溯期有时可能有用，但也会降低查询性能，并且可能包含不太有用的数据"
      : value.regressionAdjustmentDays < 7
        ? "7天以下的回溯期往往无法捕获足够的指标数据以降低方差，并且可能受到每周季节性的影响"
        : "";

  const customAggregationWarningMsg = value.aggregation
    ? "当使用自定义聚合时，在SQL中使用COALESCE函数处理值以确保`value`列没有NULL值是最安全的做法。"
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
    selectedDataSource
  );

  let ctaEnabled = true;
  let disabledMessage: string | null = null;

  if (riskError) {
    ctaEnabled = false;
    disabledMessage = riskError;
  } else if (!permissionsUtil.canCreateMetric({ projects: value.projects })) {
    ctaEnabled = false;
    disabledMessage = "您没有创建指标的权限。";
  }

  const projectOptions = useProjectOptions(
    (project) => permissionsUtil.canCreateMetric({ projects: [project] }),
    form.watch("projects") || []
  );

  const trackingEventModalType = edit ? "edit-metric" : "new-metric";

  return (
    <>
      {supportsSQL && sqlOpen && (
        <EditSqlModal
          close={() => setSqlOpen(false)}
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
        header={edit ? "编辑指标" : "新建指标"}
        close={onClose}
        // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'null' is not assignable to type 'string | un... Remove this comment to see the full error message
        disabledMessage={disabledMessage}
        ctaEnabled={ctaEnabled}
        submit={onSubmit}
        cta={cta}
        // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'false | "取消"' is not assignable to type ... Remove this comment to see the full error message
        closeCta={!inline && "取消"}
        size="lg"
        docSection="metrics"
        step={step}
        setStep={setStep}
        secondaryCTA={secondaryCTA}
      >
        <Page
          display="基本信息"
          validate={async () => {
            validateBasicInfo(form.getValues());
            if (allowAutomaticSqlReset) {
              resetSqlToDefault(selectedDataSource, value.type);
            }
          }}
        >
          {isExclusivelyForDemoDatasourceProject ? (
            <Callout status="warning">
              您正在演示数据源项目下创建指标。
            </Callout>
          ) : switchToFact && factTables.length > 0 ? (
            <Callout status="info" mb="3">
              您正在创建一个旧版SQL指标。{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  switchToFact();
                }}
              >
                切换到使用事实表<FaArrowRight />
              </a>
            </Callout>
          ) : switchToFact && hasSQLDataSources ? (
            <Callout status="info" mb="3">
              使用事实表可以更轻松、更快速地创建指标。{" "}
              {/* <Link href="/fact-tables">
                了解更多 <FaArrowRight />
              </Link> */}
            </Callout>
          ) : null}
          <div className="form-group">
            <label>指标名称</label>
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
                添加标签{" "}
              </a>
            ) : (
              <>
                <label>标签</label>
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
                    项目{" "}
                    <Tooltip
                      body={`下拉列表已过滤，仅包含您有权限${edit ? "更新" : "创建"}指标的项目。`}
                    />
                  </>
                }
                placeholder="所有项目"
                value={value.projects || []}
                options={projectOptions}
                onChange={(v) => form.setValue("projects", v)}
                customClassName="label-overflow-ellipsis"
                helpText="将此指标分配给特定项目"
                disabled={isExclusivelyForDemoDatasourceProject}
              />
            </div>
          )}
          <SelectField
            label="数据源"
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
                label: `${d.name}${d.description ? ` — ${d.description}` : ""
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
            <label>指标类型</label>
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
          display="查询设置"
          validate={async () => {
            validateQuerySettings(
              datasourceSettingsSupport,
              supportsSQL && value.queryFormat === "sql",
              value
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
                      e.target.checked ? "sql" : "builder"
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
                      e.target.checked ? "builder" : "sql"
                    )
                  }
                />
                <label
                  className="form-check-label"
                  htmlFor="query-builder-input-mode"
                >
                  查询构建器
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
                    label="支持的标识符类型"
                  />
                  {value.sql && usesEventName(value.sql) && (
                    <div className="form-group">
                      <Field
                        label="事件名称"
                        placeholder={value.name}
                        helpText="与该指标相关联的事件名称。之后可在您的SQL模板中以{{eventName}}的形式引用。"
                        {...form.register("eventName")}
                      />
                    </div>
                  )}
                  {value.sql &&
                    usesValueColumn(value.sql) &&
                    value.type != "binomial" && (
                      <div className="form-group">
                        <Field
                          label="值列"
                          helpText={
                            value.type === "count"
                              ? "使用1来统计行数（最常见情况）。之后可在您的SQL模板中以{{valueColumn}}的形式引用。"
                              : "数据仓库表中包含指标数据的列。之后可在您的SQL模板中以{{valueColumn}}的形式引用。"
                          }
                          {...form.register("valueColumn")}
                        ></Field>
                      </div>
                    )}
                  <div className="form-group">
                    <label>查询语句</label>
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
                        {value.sql ? "编辑" : "添加"} SQL<FaExternalLinkAlt />
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
                          重置为默认SQL
                        </button>
                      )}
                      {showSqlResetConfirmationModal && (
                        <ConfirmModal
                          title={"重置为默认SQL"}
                          subtitle="这将把您的SQL（和标识符类型都重置为您的数据源和类型的默认模板。"
                          yesText="重置"
                          noText="取消"
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
                        label="用户值聚合"
                        placeholder="SUM(value)"
                        textarea
                        minRows={1}
                        containerClassName="mb-0"
                        {...form.register("aggregation")}
                        helpText="当一个用户存在多条指标记录时"
                      />
                      {customAggregationWarningMsg && (
                        <small>{customAggregationWarningMsg}</small>
                      )}
                    </div>
                  )}
                  <SelectField
                    label="分母"
                    options={denominatorOptions}
                    initialOption="所有实验用户"
                    value={value.denominator}
                    onChange={(denominator) => {
                      form.setValue("denominator", denominator);
                    }}
                    helpText="用于定义比率或漏斗指标"
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
                    label={`${table} 名称`}
                    createable
                    placeholder={`${table} 名称...`}
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
                      label={supportsSQL ? "列" : "事件值"}
                      options={columnOptions}
                      createable
                      value={form.watch("column")}
                      onChange={(value) => form.setValue("column", value)}
                      required={value.type !== "count"}
                      helpText={
                        !supportsSQL &&
                        "用于从每个事件中提取值的Javascript表达式。"
                      }
                    />
                  )}
                  {value.type !== "binomial" && !supportsSQL && (
                    <Field
                      label="用户值聚合"
                      placeholder="sum(values)"
                      textarea
                      minRows={1}
                      {...form.register("aggregation")}
                      helpText="用于聚合一个用户的多个事件值的Javascript表达式。"
                    />
                  )}
                  {conditionsSupported && (
                    <div className="mb-3">
                      {conditions.fields.length > 0 && <h6>条件</h6>}
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
                                  v as Operator
                                )
                              }
                              options={(() => {
                                const ret = [
                                  { value: "=", label: "等于" },
                                  { value: "!=", label: "不等于" },
                                  { value: "~", label: "匹配正则表达式" },
                                  {
                                    value: "!~",
                                    label: "不匹配正则表达式",
                                  },
                                  { value: "<", label: "小于" },
                                  { value: ">", label: "大于" },
                                  {
                                    value: "<=",
                                    label: "小于等于"
                                  },
                                  {
                                    value: ">=",
                                    label: "大于等于"
                                  },
                                ];
                                if (supportsJS)
                                  ret.push({
                                    value: "=>",
                                    label: "自定义Javascript",
                                  });
                                return ret;
                              })()}
                              sort={false}
                            />
                          </div>
                          <div className="col-auto mb-1">
                            <Field
                              required
                              placeholder="值"
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
                        添加条件
                      </button>
                    </div>
                  )}
                  {customzeTimestamp && (
                    <SelectField
                      label="时间戳列"
                      createable
                      options={columnOptions}
                      value={form.watch("timestampColumn")}
                      onChange={(value) =>
                        form.setValue("timestampColumn", value)
                      }
                      placeholder={"接收时间"}
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
                      label="支持的标识符类型"
                    />
                  )}
                  {customizeUserIds &&
                    value.userIdTypes.map((type) => {
                      return (
                        <div key={type}>
                          <SelectField
                            label={type + " 列"}
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
                    <label>用户值聚合：</label>
                    <Code language="sql" code={getAggregateSQLPreview(value)} />
                    <small className="text-muted">
                      当一个用户存在多条指标记录时
                    </small>
                  </div>
                )}
              </div>
            )}
          </div>
        </Page>
        <Page display="行为">
          <div className="form-group">
            <label>目标是什么？</label>
            <SelectField
              value={form.watch("inverse") ? "1" : "0"}
              onChange={(v) => {
                form.setValue("inverse", v === "1");
              }}
              options={[
                {
                  value: "0",
                  label: `提高${value.type === "binomial" ? "转化率" : value.type}`,
                },
                {
                  value: "1",
                  label: `降低${value.type === "binomial" ? "转化率" : value.type}`,
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
            <MetricWindowSettingsForm form={form} />
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
              显示高级选项
            </a>
          ) : (
            <>
              <MetricDelayHours form={form} />

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
                    label="仅转换用户"
                    required
                    value={form.watch("ignoreNulls") ? "1" : "0"}
                    onChange={(v) => {
                      form.setValue("ignoreNulls", v === "1");
                    }}
                    containerClassName="mb-0"
                    options={[
                      {
                        value: "0",
                        label: "否",
                      },
                      {
                        value: "1",
                        label: "是",
                      },
                    ]}
                  />
                  <small className="text-muted">
                    若选择“是”，则在分析时排除指标值小于或等于零的任何用户。
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
                <label>最小样本量</label>
                <input
                  type="number"
                  className="form-control"
                  {...form.register("minSampleSize", { valueAsNumber: true })}
                />
                <small className="text-muted">
                  该{value.type === "binomial" ? "转化次数" : `总计${value.type}`}是在实验版本显示结果之前所需的数量（默认值为{value.type === "binomial" ? metricDefaults.minimumSampleSize : getMetricFormatter(value.type)(metricDefaults.minimumSampleSize)}）
                </small>
              </div>
              <Field
                label="最大百分比变化"
                type="number"
                step="any"
                append="%"
                {...form.register("maxPercentChange", { valueAsNumber: true })}
                helpText={`若实验使指标变化超过此百分比，将被标记为可疑（默认值为${metricDefaults.maxPercentageChange * 100}）`}
              />
              <Field
                label="最小百分比变化"
                type="number"
                step="any"
                append="%"
                {...form.register("minPercentChange", { valueAsNumber: true })}
                helpText={`若实验使指标变化小于此百分比，将被视为平局（默认值为${metricDefaults.minPercentageChange * 100}）`}
              />

              <PremiumTooltip commercialFeature="regression-adjustment">
                <label className="mb-1">
                  <GBCuped /> 回归调整（CUPED）
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
                          覆盖组织级别设置
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
                      <div className="form-group mt-3 mb-0 mr-2 form-inline">
                        <label
                          className="mr-1"
                          htmlFor="toggle-regressionAdjustmentEnabled"
                        >
                          对此指标应用回归调整
                        </label>
                        <Toggle
                          id={"toggle-regressionAdjustmentEnabled"}
                          value={!!form.watch("regressionAdjustmentEnabled")}
                          setValue={(value) => {
                            form.setValue("regressionAdjustmentEnabled", value);
                          }}
                          disabled={!hasRegressionAdjustmentFeature}
                        />
                        <small className="form-text text-muted">
                          （组织默认值：{settings.regressionAdjustmentEnabled ? "开启" : "关闭"}）
                        </small>
                      </div>
                      <div
                        className="form-group mt-3 mb-1 mr-2"
                        style={{
                          opacity: form.watch("regressionAdjustmentEnabled")
                            ? "1"
                            : "0.5",
                        }}
                      >
                        <Field
                          label="曝光前回溯期（天）"
                          type="number"
                          style={{
                            borderColor: regressionAdjustmentDaysHighlightColor,
                            backgroundColor: regressionAdjustmentDaysHighlightColor
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
                                （组织默认值：{settings.regressionAdjustmentDays ?? DEFAULT_REGRESSION_ADJUSTMENT_DAYS}）
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
