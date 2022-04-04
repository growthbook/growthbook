import React, { FC, useState } from "react";
import { MetricInterface, Condition, MetricType } from "back-end/types/metric";
import { useAuth } from "../../services/auth";
import { useFieldArray, useForm } from "react-hook-form";
import GoogleAnalyticsMetrics from "./GoogleAnalyticsMetrics";
import RadioSelector from "../Forms/RadioSelector";
import PagedModal from "../Modal/PagedModal";
import Page from "../Modal/Page";
import track from "../../services/track";
import { useDefinitions } from "../../services/DefinitionsContext";
import { useEffect } from "react";
import Code from "../Code";
import TagsInput from "../Tags/TagsInput";
import { getDefaultConversionWindowHours } from "../../services/env";
import {
  defaultLoseRiskThreshold,
  defaultWinRiskThreshold,
  defaultMaxPercentChange,
  defaultMinPercentChange,
  defaultMinSampleSize,
  formatConversionRate,
} from "../../services/metrics";
import BooleanSelect from "../Forms/BooleanSelect";
import Field from "../Forms/Field";
import SelectField from "../Forms/SelectField";
import { getInitialMetricQuery } from "../../services/datasources";

const weekAgo = new Date();
weekAgo.setDate(weekAgo.getDate() - 7);

export type MetricFormProps = {
  initialStep?: number;
  current: Partial<MetricInterface>;
  edit: boolean;
  source: string;
  onClose: (refresh?: boolean) => void;
  advanced?: boolean;
};

function validateSQL(
  sql: string,
  type: MetricType,
  userIdType: "user" | "anonymous" | "either"
) {
  if (!sql.length) {
    throw new Error("SQL cannot be empty");
  }

  // require a SELECT statement
  if (!sql.match(/SELECT\s[\s\S]*\sFROM\s[\S\s]+/i)) {
    throw new Error("Invalid SQL. Expecting `SELECT ... FROM ...`");
  }
  if (!sql.match(/timestamp/i)) {
    throw new Error("Must select a `timestamp` column.");
  }
  if (type !== "binomial" && !sql.match(/value/i)) {
    throw new Error("Must select a `value` column.");
  }
  if (userIdType !== "user" && !sql.match(/anonymous_id/i)) {
    throw new Error("Must select an `anonymous_id` column.");
  }
  if (userIdType !== "anonymous" && !sql.match(/user_id/i)) {
    throw new Error("Must select a `user_id` column.");
  }
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
    userIdType: "user" | "anonymous" | "either";
    table: string;
  }
) {
  if (!datasourceSettingsSupport) {
    return;
  }
  if (sqlInput) {
    validateSQL(value.sql, value.type, value.userIdType);
  } else {
    if (value.table.length < 1) {
      throw new Error("Table name cannot be empty");
    }
  }
}
function getRawSQLPreview({
  userIdType,
  userIdColumn,
  anonymousIdColumn,
  timestampColumn,
  type,
  table,
  column,
  conditions,
}: Partial<MetricInterface>) {
  const cols: string[] = [];
  if (userIdType !== "user") {
    cols.push((anonymousIdColumn || "anonymous_id") + " as anonymous_id");
  }
  if (userIdType !== "anonymous") {
    cols.push((userIdColumn || "user_id") + " as user_id");
  }
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
  onClose,
  source,
  initialStep = 0,
  advanced = false,
}) => {
  const { datasources, getDatasourceById } = useDefinitions();
  const [step, setStep] = useState(initialStep);
  const [showAdvanced, setShowAdvanced] = useState(advanced);
  const [hideTags, setHideTags] = useState(true);

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
      type: current.type || "binomial",
      table: current.table || "",
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
      userIdColumn: current.userIdColumn || "",
      anonymousIdColumn: current.anonymousIdColumn || "",
      userIdType: current.userIdType || "either",
      timestampColumn: current.timestampColumn || "",
      tags: current.tags || [],
      winRisk: (current.winRisk || defaultWinRiskThreshold) * 100,
      loseRisk: (current.loseRisk || defaultLoseRiskThreshold) * 100,
      maxPercentChange:
        (current.maxPercentChange || defaultMaxPercentChange) * 100,
      minPercentChange:
        (current.minPercentChange || defaultMinPercentChange) * 100,
      minSampleSize: current.minSampleSize || defaultMinSampleSize,
    },
  });

  const { apiCall } = useAuth();

  const value = {
    name: form.watch("name"),
    queryFormat: form.watch("queryFormat"),
    datasource: form.watch("datasource"),
    timestampColumn: form.watch("timestampColumn"),
    userIdColumn: form.watch("userIdColumn"),
    anonymousIdColumn: form.watch("anonymousIdColumn"),
    userIdType: form.watch("userIdType"),
    column: form.watch("column"),
    table: form.watch("table"),
    type: form.watch("type"),
    winRisk: form.watch("winRisk"),
    loseRisk: form.watch("loseRisk"),
    tags: form.watch("tags"),
    sql: form.watch("sql"),
    conditions: form.watch("conditions"),
  };

  const currentDataSource = getDatasourceById(value.datasource);

  const datasourceType = currentDataSource?.type;

  const datasourceSettingsSupport =
    currentDataSource?.properties?.hasSettings || false;

  const capSupported = currentDataSource?.properties?.metricCaps || false;
  // TODO: eventually make each of these their own independent properties
  const conditionsSupported = capSupported;
  const ignoreNullsSupported = capSupported;
  const conversionWindowSupported = capSupported;

  const supportsSQL = currentDataSource?.properties?.queryLanguage === "sql";

  const customzeTimestamp = supportsSQL;
  const customizeUserIds = supportsSQL;

  let table = "Table";
  let column = "Column";
  if (currentDataSource?.properties?.events) {
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
      userIdType: value.userIdType,
    });

    onClose(true);
  });

  const riskError =
    value.loseRisk < value.winRisk
      ? "The acceptable risk percentage cannot be higher than the too risky percentage"
      : "";

  return (
    <PagedModal
      header={edit ? "Edit Metric" : "New Metric"}
      close={() => onClose(false)}
      submit={onSubmit}
      cta="Save"
      closeCta="Cancel"
      size="lg"
      step={step}
      setStep={setStep}
    >
      <Page
        display="Basic Info"
        validate={async () => {
          validateBasicInfo(form.getValues());

          // Initial metric SQL based on the data source
          if (supportsSQL && currentDataSource && !value.sql) {
            const [userType, sql] = getInitialMetricQuery(
              currentDataSource,
              value.type,
              value.name
            );

            form.setValue("sql", sql);
            form.setValue("userIdType", userType);
            form.setValue("queryFormat", "sql");
          }
        }}
      >
        <div className="form-group">
          Metric Name
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
              Tags
              <TagsInput
                value={value.tags}
                onChange={(tags) => form.setValue("tags", tags)}
              />
            </>
          )}
        </div>
        <SelectField
          label="Data Source"
          value={value.datasource || ""}
          onChange={(v) => form.setValue("datasource", v)}
          options={(datasources || []).map((d) => ({
            value: d.id,
            label: d.name,
          }))}
          name="datasource"
          initialOption="Manual"
          disabled={!!current.id}
        />
        <div className="form-group">
          Metric Type
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
                <Field
                  label="User Types Supported"
                  {...form.register("userIdType")}
                  options={[
                    {
                      display: "Anonymous Only",
                      value: "anonymous",
                    },
                    {
                      display: "Users Only",
                      value: "user",
                    },
                    {
                      display: "Both Anonymous and Users",
                      value: "either",
                    },
                  ]}
                />
                <Field
                  label="SQL"
                  textarea
                  {...form.register("sql")}
                  minRows={8}
                  maxRows={20}
                  placeholder="SELECT ..."
                  autoFocus
                  required
                  minLength={15}
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
                    placeholder="values.reduce((sum,n)=>sum+n, 0)"
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
                          <select
                            className="form-control"
                            {...form.register(`conditions.${i}.operator`)}
                          >
                            <option value="=">=</option>
                            <option value="!=">!=</option>
                            <option value="~">~</option>
                            <option value="!~">!~</option>
                            <option value="<">&lt;</option>
                            <option value=">">&gt;</option>
                            <option value="<=">&lt;=</option>
                            <option value=">=">&gt;=</option>
                          </select>
                        </div>
                        <div className="col-auto">
                          <input
                            required
                            className="form-control"
                            placeholder="Value"
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
                  <div className="form-group">
                    User Types Supported
                    <select
                      className="form-control"
                      {...form.register("userIdType")}
                    >
                      <option value="anonymous">Anonymous Only</option>
                      <option value="user">Users Only</option>
                      <option value="either">Both Anonymous and Users</option>
                    </select>
                  </div>
                )}
                {value.userIdType !== "anonymous" && customizeUserIds && (
                  <div className="form-group ">
                    User Id Column
                    <input
                      type="text"
                      placeholder={"user_id"}
                      className="form-control"
                      {...form.register("userIdColumn")}
                    />
                  </div>
                )}
                {value.userIdType !== "user" && customizeUserIds && (
                  <div className="form-group ">
                    Anonymous Id Column
                    <input
                      type="text"
                      placeholder={"anonymous_id"}
                      className="form-control"
                      {...form.register("anonymousIdColumn")}
                    />
                  </div>
                )}
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
                    {value.userIdType !== "anonymous" && (
                      <li>
                        <strong>user_id</strong> - The logged-in user id of the
                        person converting
                      </li>
                    )}
                    {value.userIdType !== "user" && (
                      <li>
                        <strong>anonymous_id</strong> - The anonymous id of the
                        person converting
                      </li>
                    )}
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
                  <h4>Query Preview</h4>
                  SQL:
                  <Code
                    language="sql"
                    theme="dark"
                    code={getRawSQLPreview(value)}
                  />
                  {value.type !== "binomial" && (
                    <div className="mt-2">
                      User Value Aggregation:
                      <Code
                        language="sql"
                        theme="dark"
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
          What is the Goal?
          <BooleanSelect
            required
            control={form.control}
            name="inverse"
            falseLabel={`Increase the ${
              value.type === "binomial" ? "conversion rate" : value.type
            }`}
            trueLabel={`Decrease the ${
              value.type === "binomial" ? "conversion rate" : value.type
            }`}
          />
        </div>
        {capSupported && ["count", "duration", "revenue"].includes(value.type) && (
          <div className="form-group">
            Capped Value
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
            Conversion Delay (hours)
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
            Conversion Window (hours)
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
        {ignoreNullsSupported && value.type !== "binomial" && (
          <div className="form-group">
            Converted Users Only
            <BooleanSelect
              required
              control={form.control}
              name="ignoreNulls"
              falseLabel="No"
              trueLabel="Yes"
            />
            <small className="text-muted">
              If yes, exclude anyone with a metric value less than or equal to
              zero from analysis.
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
            <div className="form-group">
              Risk thresholds
              <div className="riskbar row align-items-center pt-3">
                <div className="col green-bar pr-0">
                  <span
                    style={{
                      position: "absolute",
                      top: "-20px",
                      color: "#009a6d",
                      fontSize: "0.75rem",
                    }}
                  >
                    acceptable risk under {value.winRisk}%
                  </span>
                  <div
                    style={{
                      height: "10px",
                      backgroundColor: "#009a6d",
                      borderRadius: "5px 0 0 5px",
                    }}
                  ></div>
                </div>
                <div className="col-2 px-0">
                  <span
                    style={{
                      position: "absolute",
                      right: "4px",
                      top: "6px",
                      color: "#888",
                    }}
                  >
                    %
                  </span>
                  <input
                    className="form-control winrisk text-center"
                    type="number"
                    step="any"
                    min="0"
                    max="100"
                    {...form.register("winRisk", { valueAsNumber: true })}
                  />
                </div>
                <div className="col yellow-bar px-0">
                  <div
                    style={{
                      height: "10px",
                      backgroundColor: "#dfd700",
                    }}
                  ></div>
                </div>
                <div className="col-2 px-0">
                  <span
                    style={{
                      position: "absolute",
                      right: "4px",
                      top: "6px",
                      color: "#888",
                    }}
                  >
                    %
                  </span>
                  <input
                    className="form-control loserisk text-center"
                    type="number"
                    step="any"
                    min="0"
                    max="100"
                    {...form.register("loseRisk", { valueAsNumber: true })}
                  />
                </div>
                <div className="col red-bar pl-0">
                  <span
                    style={{
                      position: "absolute",
                      top: "-20px",
                      right: "15px",
                      color: "#c50f0f",
                      fontSize: "0.75rem",
                    }}
                  >
                    too much risk over {value.loseRisk}%
                  </span>
                  <div
                    style={{
                      height: "10px",
                      backgroundColor: "#c50f0f",
                      borderRadius: "0 5px 5px 0",
                    }}
                  ></div>
                </div>
              </div>
              {riskError && <div className="text-danger">{riskError}</div>}
              <small className="text-muted">
                Set the threasholds for risk for this metric. This is used when
                determining metric significance, highlighting the risk value as
                green, yellow, or red.
              </small>
            </div>
            <div className="form-group">
              Minimum Sample Size
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
                  ? defaultMinSampleSize
                  : formatConversionRate(value.type, defaultMinSampleSize)}
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
              defaultMaxPercentChange * 100
            })`}
            />
            <Field
              label="Min Percent Change"
              type="number"
              step="any"
              append="%"
              {...form.register("minPercentChange", { valueAsNumber: true })}
              helpText={`An experiment that changes the metric by less than this percent will be
            considered a draw (default ${defaultMinPercentChange * 100})`}
            />
          </>
        )}
      </Page>
    </PagedModal>
  );
};

export default MetricForm;
