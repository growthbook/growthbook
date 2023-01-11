import React, { FC, ReactElement, useState, useEffect, useMemo } from "react";
import {
  MetricInterface,
  Condition,
  MetricType,
  Operator,
} from "back-end/types/metric";
import { useFieldArray, useForm } from "react-hook-form";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import useOrgSettings from "@/hooks/useOrgSettings";
import { getInitialMetricQuery, validateSQL } from "@/services/datasources";
import { useDefinitions } from "@/services/DefinitionsContext";
import track from "@/services/track";
import { getDefaultConversionWindowHours } from "@/services/env";
import {
  defaultLoseRiskThreshold,
  defaultWinRiskThreshold,
  formatConversionRate,
} from "@/services/metrics";
import { useAuth } from "@/services/auth";
import RadioSelector from "@/components/Forms/RadioSelector";
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
};

function validateMetricSQL(
  sql: string,
  type: MetricType,
  userIdTypes: string[]
) {
  // Require specific columns to be selected
  const requiredCols = ["timestamp", ...userIdTypes];
  if (type !== "binomial") {
    requiredCols.push("value");
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
  }
) {
  if (!datasourceSettingsSupport) {
    return;
  }
  if (sqlInput) {
    validateMetricSQL(value.sql, value.type, value.userIdTypes);
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
  userIdTypes.forEach((type) => {
    cols.push(userIdColumns[type] || type + " as " + type);
  });

  cols.push((timestampColumn || "received_at") + " as timestamp");
  if (type !== "binomial") {
    cols.push((column || "1") + " as value");
  }

  let where = "";
  if (conditions.length) {
    where =
      "\nWHERE\n  " +
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
}) => {
  const {
    datasources,
    getDatasourceById,
    metrics,
    projects,
    project,
  } = useDefinitions();
  const [step, setStep] = useState(initialStep);
  const [showAdvanced, setShowAdvanced] = useState(advanced);
  const [hideTags, setHideTags] = useState(!current?.tags?.length);
  const settings = useOrgSettings();

  const {
    getMinSampleSizeForMetric,
    getMinPercentageChangeForMetric,
    getMaxPercentageChangeForMetric,
    metricDefaults,
  } = useOrganizationMetricDefaults();

  useEffect(() => {
    track("View Metric Form", {
      source,
    });
  }, [source]);

  const metricTypeOptions = [
    {
      key: "binomial",
      display: "Binomial",
      description: "Percent of users who do something",
      sub: "click, view, download, bounce, etc.",
    },
    {
      key: "count",
      display: "Count",
      description: "Number of actions per user",
      sub: "clicks, views, downloads, etc.",
    },
    {
      key: "duration",
      display: "Duration",
      description: "How long something takes",
      sub: "time on site, loading speed, etc.",
    },
    {
      key: "revenue",
      display: "Revenue",
      description: "How much money a user pays (in USD)",
      sub: "revenue per visitor, average order value, etc.",
    },
  ];

  const form = useForm({
    defaultValues: {
      datasource:
        ("datasource" in current ? current.datasource : datasources[0]?.id) ||
        "",
      name: current.name || "",
      description: current.description || "",
      type: current.type || "binomial",
      table: current.table || "",
      denominator: current.denominator || "",
      column: current.column || "",
      inverse: !!current.inverse,
      ignoreNulls: !!current.ignoreNulls,
      queryFormat: current.queryFormat || (current.sql ? "sql" : "builder"),
      cap: current.cap || 0,
      conversionWindowHours:
        current.conversionWindowHours || getDefaultConversionWindowHours(),
      conversionDelayHours: current.conversionDelayHours || 0,
      sql: current.sql || "",
      aggregation: current.aggregation || "",
      conditions: current.conditions || [],
      userIdTypes: current.userIdTypes || [],
      userIdColumns: current.userIdColumns || {
        user_id: current.userIdColumn || "user_id",
        anonymous_id: current.anonymousIdColumn || "anonymous_id",
      },
      timestampColumn: current.timestampColumn || "",
      tags: current.tags || [],
      projects:
        edit || duplicate ? current.projects || [] : project ? [project] : [],
      winRisk: (current.winRisk || defaultWinRiskThreshold) * 100,
      loseRisk: (current.loseRisk || defaultLoseRiskThreshold) * 100,
      maxPercentChange: getMaxPercentageChangeForMetric(current) * 100,
      minPercentChange: getMinPercentageChangeForMetric(current) * 100,
      minSampleSize: getMinSampleSizeForMetric(current),
    },
  });

  const { apiCall } = useAuth();

  const type = form.watch("type");

  const value = {
    name: form.watch("name"),
    queryFormat: form.watch("queryFormat"),
    datasource: form.watch("datasource"),
    timestampColumn: form.watch("timestampColumn"),
    userIdColumns: form.watch("userIdColumns"),
    userIdTypes: form.watch("userIdTypes"),
    denominator: form.watch("denominator"),
    column: form.watch("column"),
    table: form.watch("table"),
    type,
    winRisk: form.watch("winRisk"),
    loseRisk: form.watch("loseRisk"),
    tags: form.watch("tags"),
    projects: form.watch("projects"),
    sql: form.watch("sql"),
    conditions: form.watch("conditions"),
  };

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
        return (
          value.type !== "binomial" && m.type === "count" && !m.denominator
        );
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

  const supportsSQL = selectedDataSource?.properties?.queryLanguage === "sql";
  const supportsJS =
    selectedDataSource?.properties?.queryLanguage === "javascript";

  const customzeTimestamp = supportsSQL;
  const customizeUserIds = supportsSQL;

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

  const onSubmit = form.handleSubmit(async (value) => {
    const {
      winRisk,
      loseRisk,
      maxPercentChange,
      minPercentChange,
      ...otherValues
    } = value;

    const sendValue: Partial<MetricInterface> = {
      ...otherValues,
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

  const requiredColumns = useMemo(() => {
    return new Set(["timestamp", ...value.userIdTypes]);
  }, [value.userIdTypes]);

  useEffect(() => {
    if (type === "binomial") {
      form.setValue("ignoreNulls", false);
    }
  }, [type, form]);

  return (
    <PagedModal
      inline={inline}
      header={edit ? "Edit Metric" : "New Metric"}
      close={onClose}
      submit={onSubmit}
      cta={cta}
      closeCta={!inline && "Cancel"}
      ctaEnabled={!riskError}
      size="lg"
      docSection="metrics"
      step={step}
      setStep={setStep}
      secondaryCTA={secondaryCTA}
    >
      <Page
        display="Basic Info"
        validate={async () => {
          validateBasicInfo(form.getValues());

          // Initial metric SQL based on the data source
          if (supportsSQL && selectedDataSource && !value.sql) {
            const [userTypes, sql] = getInitialMetricQuery(
              selectedDataSource,
              value.type,
              value.name
            );

            form.setValue("sql", sql);
            form.setValue("userIdTypes", userTypes);
            form.setValue("queryFormat", "sql");
          }
        }}
      >
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
              label="Projects"
              placeholder="All projects"
              value={value.projects || []}
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
              onChange={(v) => form.setValue("projects", v)}
              customClassName="label-overflow-ellipsis"
              helpText="Assign this metric to specific projects"
            />
          </div>
        )}
        <SelectField
          label="Data Source"
          value={value.datasource || ""}
          onChange={(v) => form.setValue("datasource", v)}
          options={(datasources || []).map((d) => ({
            value: d.id,
            label: `${d.name}${d.description ? ` — ${d.description}` : ""}`,
          }))}
          className="portal-overflow-ellipsis"
          name="datasource"
          initialOption="Manual"
          disabled={edit}
        />
        <div className="form-group">
          <label>Metric Type</label>
          <RadioSelector
            name="type"
            value={value.type}
            setValue={(val: MetricType) => form.setValue("type", val)}
            options={metricTypeOptions}
          />
        </div>
      </Page>
      <Page
        display="Query Settings"
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
                  options={(selectedDataSource.settings.userIdTypes || []).map(
                    ({ userIdType }) => ({
                      value: userIdType,
                      label: userIdType,
                    })
                  )}
                  label="Identifier Types Supported"
                />
                <SQLInputField
                  className="mb-2"
                  userEnteredQuery={value.sql}
                  datasourceId={value.datasource}
                  form={form}
                  requiredColumns={requiredColumns}
                  placeholder={
                    "SELECT\n      user_id as user_id, timestamp as timestamp\nFROM\n      test"
                  }
                  queryType="metric"
                />
                {value.type !== "binomial" && (
                  <Field
                    label="User Value Aggregation"
                    placeholder="SUM(value)"
                    textarea
                    minRows={1}
                    {...form.register("aggregation")}
                    helpText="When there are multiple metric rows for a user"
                  />
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
                <div className="form-group">
                  {table} Name
                  <input
                    type="text"
                    required
                    className="form-control"
                    {...form.register("table")}
                  />
                </div>
                {value.type !== "binomial" && (
                  <div className="form-group ">
                    {supportsSQL ? "Column" : "Event Value"}
                    <input
                      type="text"
                      required={value.type !== "count"}
                      placeholder={supportsSQL ? "" : "1"}
                      className="form-control"
                      {...form.register("column")}
                    />
                    {!supportsSQL && (
                      <small className="form-text text-muted">
                        Javascript expression to extract a value from each
                        event.
                      </small>
                    )}
                  </div>
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
                        <div className="col-auto">
                          <input
                            required
                            className="form-control mb-1"
                            placeholder={column}
                            {...form.register(`conditions.${i}.column`)}
                          />
                        </div>
                        <div className="col-auto">
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
                        <div className="col-auto">
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
                        <div className="col-auto">
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
                  <div className="form-group ">
                    Timestamp Column
                    <input
                      type="text"
                      placeholder={"received_at"}
                      className="form-control"
                      {...form.register("timestampColumn")}
                    />
                  </div>
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
                      <Field
                        key={type}
                        label={type + " Column"}
                        placeholder={type}
                        value={value.userIdColumns[type] || ""}
                        onChange={(e) => {
                          form.setValue("userIdColumns", {
                            ...value.userIdColumns,
                            [type]: e.target.value,
                          });
                        }}
                      />
                    );
                  })}
              </>
            )}
          </div>
          {supportsSQL && (
            <div className="col-lg pt-2">
              {value.queryFormat === "sql" ? (
                <div>
                  <h4>SQL Query Instructions</h4>
                  <p className="mt-3">
                    Your SELECT statement must return the following column
                    names:
                  </p>
                  <ol>
                    {value.userIdTypes.map((id) => (
                      <li key={id}>
                        <strong>{id}</strong>
                      </li>
                    ))}
                    {value.type !== "binomial" && (
                      <li>
                        <strong>value</strong> -{" "}
                        {value.type === "count"
                          ? "The numeric value to be counted"
                          : "The " + value.type + " amount"}
                      </li>
                    )}
                    <li>
                      <strong>timestamp</strong> - When the action was performed
                    </li>
                  </ol>
                </div>
              ) : (
                <>
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
                      <Code
                        language="sql"
                        code={getAggregateSQLPreview(value)}
                      />
                      <small className="text-muted">
                        When there are multiple metric rows for a user
                      </small>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </Page>
      <Page display="Behavior">
        <div className="form-group ">
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
        {capSupported && ["count", "duration", "revenue"].includes(value.type) && (
          <div className="form-group">
            <label>Capped Value</label>
            <input
              type="number"
              className="form-control"
              {...form.register("cap", { valueAsNumber: true })}
            />
            <small className="text-muted">
              If greater than zero, any user who has more than this count will
              be capped at this value.
            </small>
          </div>
        )}
        {conversionWindowSupported && (
          <div className="form-group">
            <label>Conversion Delay (hours)</label>
            <input
              type="number"
              step="any"
              className="form-control"
              placeholder={"0"}
              {...form.register("conversionDelayHours", {
                valueAsNumber: true,
              })}
            />
            <small className="text-muted">
              Ignore all conversions within the first X hours of being put into
              an experiment.
            </small>
          </div>
        )}
        {conversionWindowSupported && (
          <div className="form-group">
            <label>Conversion Window (hours)</label>
            <input
              type="number"
              step="any"
              min="1"
              className="form-control"
              placeholder={getDefaultConversionWindowHours() + ""}
              {...form.register("conversionWindowHours", {
                valueAsNumber: true,
              })}
            />
            <small className="text-muted">
              After the conversion delay (if any), wait this many hours for a
              conversion event.
            </small>
          </div>
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
            {ignoreNullsSupported && value.type !== "binomial" && (
              <div className="form-group">
                <SelectField
                  label="Converted Users Only"
                  required
                  value={form.watch("ignoreNulls") ? "1" : "0"}
                  onChange={(v) => {
                    form.setValue("ignoreNulls", v === "1");
                  }}
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
                  If yes, exclude anyone with a metric value less than or equal
                  to zero from analysis.
                </small>
              </div>
            )}
            {settings.statsEngine !== "frequentist" && (
              <RiskThresholds
                winRisk={value.winRisk}
                loseRisk={value.loseRisk}
                winRiskRegisterField={form.register("winRisk")}
                loseRiskRegisterField={form.register("loseRisk")}
                riskError={riskError}
              />
            )}
            <div className="form-group">
              <label>Minimum Sample Size</label>
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
                  : formatConversionRate(
                      value.type,
                      metricDefaults.minimumSampleSize
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
            })`}
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
            })`}
            />
          </>
        )}
      </Page>
    </PagedModal>
  );
};

export default MetricForm;
