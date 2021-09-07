import { FC, useState } from "react";
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
import TagsInput from "../TagsInput";
import { getDefaultConversionWindowHours } from "../../services/env";
import {
  defaultLoseRiskThreshold,
  defaultWinRiskThreshold,
} from "../../services/metrics";
import BooleanSelect from "../Forms/BooleanSelect";

const weekAgo = new Date();
weekAgo.setDate(weekAgo.getDate() - 7);

export type MetricFormProps = {
  initialStep?: number;
  current: Partial<MetricInterface>;
  edit: boolean;
  source: string;
  onClose: (refresh?: boolean) => void;
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
function validateBasicInfo(value: Partial<MetricInterface>) {
  if (value.name.length < 1) {
    throw new Error("Metric name cannot be empty");
  }
}
function validateQuerySettings(
  datasourceSettingsSupport: boolean,
  sqlInput: boolean,
  value: Partial<MetricInterface>
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

const MetricForm: FC<MetricFormProps> = ({
  current,
  edit,
  onClose,
  source,
  initialStep = 0,
}) => {
  const { datasources, getDatasourceById } = useDefinitions();
  const [step, setStep] = useState(initialStep);
  const [sqlInput, setSqlInput] = useState(
    current?.sql || !current?.table ? true : false
  );

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
      earlyStart: !!current.earlyStart,
      inverse: !!current.inverse,
      ignoreNulls: !!current.ignoreNulls,
      cap: current.cap || 0,
      conversionWindowHours:
        current.conversionWindowHours || getDefaultConversionWindowHours(),
      sql: current.sql || "",
      conditions: current.conditions || [],
      userIdColumn: current.userIdColumn || "",
      anonymousIdColumn: current.anonymousIdColumn || "",
      userIdType: current.userIdType || "either",
      timestampColumn: current.timestampColumn || "",
      tags: current.tags || [],
      winRisk: (current.winRisk || defaultWinRiskThreshold) * 100,
      loseRisk: (current.loseRisk || defaultLoseRiskThreshold) * 100,
    },
  });

  const { apiCall } = useAuth();

  const currentDataSource = getDatasourceById(form.watch("datasource"));

  const datasourceType = currentDataSource?.type;

  const datasourceSettingsSupport =
    !!currentDataSource && !["google_analytics"].includes(datasourceType);

  const conditionsSupported = !["google_analytics"].includes(datasourceType);
  const capSupported =
    datasourceType && !["google_analytics"].includes(datasourceType);

  const ignoreNullsSupported = !["google_analytics"].includes(datasourceType);

  const conversionWindowSupported =
    !!currentDataSource && !["google_analytics"].includes(datasourceType);

  const supportsSQL =
    datasourceSettingsSupport && !["mixpanel"].includes(datasourceType);

  const customzeTimestamp = supportsSQL;
  const customizeUserIds = supportsSQL;

  let table = "Table";
  let column = "Column";
  if (datasourceType === "mixpanel") {
    table = "Event";
    column = "Property";
  }

  const conditions = useFieldArray({
    control: form.control,
    name: "conditions",
  });

  const onSubmit = form.handleSubmit(async (value) => {
    const { winRisk, loseRisk, sql, ...otherValues } = value;

    const sendValue: Partial<MetricInterface> = {
      ...otherValues,
      winRisk: winRisk / 100,
      loseRisk: loseRisk / 100,
      sql: sqlInput ? sql : "",
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

  const type = form.watch("type");
  const userIdType = form.watch("userIdType");

  const getSqlPreviewData = () => {
    const timestampColumn = form.watch("timestampColumn");
    const userIdColumn = form.watch("userIdColumn");
    const anonymousIdColumn = form.watch("anonymousIdColumn");
    const column = form.watch("column");

    const sqlPreviewData = {
      userIdCol: "",
      timestampCol: timestampColumn || "received_at",
      weekAgo: weekAgo.toISOString().substr(0, 10),
      column: "",
      where: conditions.fields
        .map((c: Condition) => {
          return (
            "  AND " +
            (c.column || "?") +
            " " +
            c.operator +
            " '" +
            c.value +
            "'"
          );
        })
        .join("\n"),
    };
    if (userIdType === "user") {
      sqlPreviewData.userIdCol = userIdColumn || "user_id";
    } else if (userIdType === "anonymous") {
      sqlPreviewData.userIdCol = anonymousIdColumn || "anonymous_id";
    } else {
      sqlPreviewData.userIdCol =
        (userIdColumn || "user_id") +
        " /*or " +
        (anonymousIdColumn || "anonymous_id") +
        "*/";
    }

    if (type === "count") {
      if (!column || column === "*") {
        sqlPreviewData.column = "COUNT(*) as count";
      } else {
        sqlPreviewData.column =
          "COUNT(\n    DISTINCT " + (column || "?") + "\n  ) as count";
      }
    } else if (type === "duration") {
      sqlPreviewData.column =
        "MAX(\n    " + (column || "?") + "\n  ) as duration";
    } else if (type === "revenue") {
      sqlPreviewData.column =
        "MAX(\n    " + (column || "?") + "\n  ) as revenue";
    }
    if (sqlPreviewData.column) {
      sqlPreviewData.column =
        ",\n  " + sqlPreviewData.column.replace(/\{\s*alias\s*\}\./g, "");
    }
    return sqlPreviewData;
  };

  const riskError =
    form.watch("loseRisk") < form.watch("winRisk")
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
        validate={async () => validateBasicInfo(form.getValues())}
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
          Tags
          <TagsInput
            value={form.watch("tags")}
            onChange={(tags) => form.setValue("tags", tags)}
          />
        </div>
        <div className="form-group">
          Data Source
          <select
            {...form.register("datasource")}
            name="datasource"
            className="form-control"
            disabled={!!current.id}
          >
            {(datasources || []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
            <option value="">Manual</option>
          </select>
        </div>
        <div className="form-group">
          Metric Type
          <RadioSelector
            name="type"
            value={form.watch("type")}
            setValue={(val: MetricType) => form.setValue("type", val)}
            options={metricTypeOptions}
          />
        </div>
        {datasourceType === "google_analytics" && (
          <GoogleAnalyticsMetrics
            inputProps={form.register("table")}
            type={type}
          />
        )}
      </Page>
      <Page
        display="Query Settings"
        enabled={datasourceSettingsSupport}
        validate={async () => {
          validateQuerySettings(
            datasourceSettingsSupport,
            supportsSQL && sqlInput,
            form.getValues()
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
                checked={sqlInput}
                onChange={(e) => setSqlInput(e.target.checked)}
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
                checked={!sqlInput}
                onChange={(e) => setSqlInput(!e.target.checked)}
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
            {supportsSQL && sqlInput ? (
              <div>
                <div className="form-group">
                  <div className="form-group">
                    <label>User Types Supported</label>
                    <select
                      className="form-control"
                      {...form.register("userIdType")}
                    >
                      <option value="anonymous">Anonymous Only</option>
                      <option value="user">Users Only</option>
                      <option value="either">Both Anonymous and Users</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label>SQL</label>
                  <textarea
                    {...form.register("sql")}
                    className="form-control"
                    rows={15}
                    placeholder="SELECT ..."
                    autoFocus
                    required
                    minLength={15}
                  />
                </div>
              </div>
            ) : (
              <>
                {["count", "duration", "revenue"].includes(type) && (
                  <div className="form-group ">
                    {type === "count"
                      ? `Distinct ${column} for Counting`
                      : column}
                    <input
                      type="text"
                      required={type !== "count"}
                      className="form-control"
                      {...form.register("column")}
                    />
                  </div>
                )}
                <div className="form-group">
                  {table} Name
                  <input
                    type="text"
                    required
                    className="form-control"
                    {...form.register("table")}
                  />
                </div>
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
                {userIdType !== "anonymous" && customizeUserIds && (
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
                {userIdType !== "user" && customizeUserIds && (
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
            <div className="col-lg bg-light border-left pt-2">
              {sqlInput ? (
                <div>
                  Example SQL
                  <Code
                    language="sql"
                    code={`SELECT
${userIdType !== "anonymous" ? `  ${"user_id"} as user_id,\n` : ""}${
                      userIdType !== "user"
                        ? `  ${"anonymous_id"} as anonymous_id,\n`
                        : ""
                    }${
                      type === "binomial"
                        ? ""
                        : type === "count"
                        ? "  1 as value,\n"
                        : type === "revenue"
                        ? "  amount as value,\n"
                        : "  duration as value,\n"
                    }  ${"received_at"} as timestamp
FROM
  ${
    type === "binomial" || type === "count"
      ? "downloads"
      : type === "revenue"
      ? "purchases"
      : "sessions"
  }`}
                  />
                  <p className="mt-3">
                    Your SELECT statement must return the following columns:
                  </p>
                  <ol>
                    {userIdType !== "anonymous" && (
                      <li>
                        <strong>user_id</strong> - The logged-in user id of the
                        person converting
                      </li>
                    )}
                    {userIdType !== "user" && (
                      <li>
                        <strong>anonymous_id</strong> - The anonymous id of the
                        person converting
                      </li>
                    )}
                    {type !== "binomial" && (
                      <li>
                        <strong>value</strong> -{" "}
                        {type === "count"
                          ? "The number of conversions (multiple rows for a user will be summed)"
                          : "The " +
                            type +
                            " amount (multiple rows for a user will be summed)"}
                      </li>
                    )}
                    <li>
                      <strong>timestamp</strong> - When the action was performed
                    </li>
                  </ol>
                </div>
              ) : (
                <>
                  Query Preview:
                  <Code
                    language="sql"
                    code={(() => {
                      const sqlPreviewData = getSqlPreviewData();
                      return `SELECT
  ${sqlPreviewData.userIdCol}${sqlPreviewData.column}
FROM
  ${form.watch("table") || "?"}
WHERE
  ${sqlPreviewData.timestampCol} > '${sqlPreviewData.weekAgo}'${
                        sqlPreviewData.where ? "\n" + sqlPreviewData.where : ""
                      }
GROUP BY
  ${sqlPreviewData.userIdCol}`;
                    })()}
                  />
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
              type === "binomial" ? "conversion rate" : type
            }`}
            trueLabel={`Decrease the ${
              type === "binomial" ? "conversion rate" : type
            }`}
          />
        </div>
        {capSupported && ["count", "duration", "revenue"].includes(type) && (
          <div className="form-group">
            Capped Value
            <input
              type="number"
              className="form-control"
              {...form.register("cap")}
            />
            <small className="text-muted">
              If greater than zero, any user who has more than this count will
              be capped at this value.
            </small>
          </div>
        )}
        {conversionWindowSupported && (
          <div className="form-group">
            Conversion Window (hours)
            <input
              type="number"
              step="1"
              min="1"
              className="form-control"
              placeholder={getDefaultConversionWindowHours() + ""}
              {...form.register("conversionWindowHours", {
                valueAsNumber: true,
              })}
            />
          </div>
        )}
        {ignoreNullsSupported && ["duration", "revenue"].includes(type) && (
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
        {capSupported && (
          <div className="form-group">
            In an Experiment,{" "}
            {type === "binomial"
              ? "only count if a conversion happens"
              : "start counting"}
            <BooleanSelect
              control={form.control}
              required
              name="earlyStart"
              falseLabel="After the user is assigned a variation"
              trueLabel={
                (type === "binomial"
                  ? "Any time during the"
                  : "At the start of the") + " user's session"
              }
            />
          </div>
        )}
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
                acceptable risk under {form.watch("winRisk")}%
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
                {...form.register("winRisk")}
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
                {...form.register("loseRisk")}
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
                too much risk over {form.watch("loseRisk")}%
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
            determining metric signigicance, highlighting the risk value as
            green, yellow, or red.
          </small>
        </div>
      </Page>
    </PagedModal>
  );
};

export default MetricForm;
