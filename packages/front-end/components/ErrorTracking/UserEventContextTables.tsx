import React, { useMemo } from "react";
import stringify from "json-stringify-pretty-compact";
import { datetime } from "shared/dates";
import { truncateString } from "shared/util";
import Tooltip from "@/ui/Tooltip";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";

const MAX_VALUE_CHARS = 100;

type FeatureEvaluationRow = {
  feature?: unknown;
  value?: unknown;
  evaluations?: unknown;
  lastSeen?: unknown;
};

type ExperimentMembershipRow = {
  experiment_id?: unknown;
  variation_id?: unknown;
  views?: unknown;
  lastSeen?: unknown;
};

function formatFeatureValue(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return stringify(JSON.parse(trimmed));
      } catch {
        return value;
      }
    }
    return value;
  }
  try {
    return stringify(value);
  } catch {
    return String(value);
  }
}

function TruncatedValueCell({ value }: { value: unknown }) {
  const full = formatFeatureValue(value);
  if (!full) {
    return <span>—</span>;
  }

  const short = truncateString(full, MAX_VALUE_CHARS);
  const needsTooltip = full.length > short.length;

  if (!needsTooltip) {
    return <code>{full}</code>;
  }

  return (
    <Tooltip
      content={
        <pre
          className="mb-0 small"
          style={{ maxWidth: 420, whiteSpace: "pre-wrap" }}
        >
          {full}
        </pre>
      }
    >
      <OverflowText maxWidth={320} title={full}>
        <code>{short}</code>
      </OverflowText>
    </Tooltip>
  );
}

function formatCount(value: unknown): string {
  const count = Number(value);
  return Number.isFinite(count) ? String(count) : "0";
}

function formatTimestamp(value: unknown): string {
  if (!value) {
    return "—";
  }
  const date = new Date(
    String(value).endsWith("Z") ? String(value) : `${value}Z`,
  );
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return datetime(date);
}

export default function UserEventContextTables({
  featureEvaluations,
  experimentMemberships,
}: {
  featureEvaluations: FeatureEvaluationRow[];
  experimentMemberships: ExperimentMembershipRow[];
}) {
  const featureRows = useMemo(
    () =>
      featureEvaluations.map((row, index) => ({
        key: `${String(row.feature || "")}:${String(row.value || "")}:${index}`,
        feature: String(row.feature || ""),
        value: row.value,
        evaluations: formatCount(row.evaluations),
        lastSeen: formatTimestamp(row.lastSeen),
      })),
    [featureEvaluations],
  );

  const experimentRows = useMemo(
    () =>
      experimentMemberships.map((row, index) => ({
        key: `${String(row.experiment_id || "")}:${String(row.variation_id || "")}:${index}`,
        experimentId: String(row.experiment_id || ""),
        variationId: String(row.variation_id || ""),
        views: formatCount(row.views),
        lastSeen: formatTimestamp(row.lastSeen),
      })),
    [experimentMemberships],
  );

  return (
    <>
      <h4 className="h6 mt-3">Feature evaluations for user</h4>
      {featureRows.length ? (
        <div className="table-responsive">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Value</th>
                <th>Evaluations</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {featureRows.map((row) => (
                <tr key={row.key}>
                  <td>{row.feature || "—"}</td>
                  <td style={{ maxWidth: 360 }}>
                    <TruncatedValueCell value={row.value} />
                  </td>
                  <td>{row.evaluations}</td>
                  <td>{row.lastSeen}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="small text-muted mb-0">
          No feature evaluations for this user in the last 7 days.
        </p>
      )}

      <h4 className="h6 mt-3">Experiments user is in</h4>
      {experimentRows.length ? (
        <div className="table-responsive">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Experiment</th>
                <th>Variation</th>
                <th>Views</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {experimentRows.map((row) => (
                <tr key={row.key}>
                  <td>{row.experimentId || "—"}</td>
                  <td>{row.variationId || "—"}</td>
                  <td>{row.views}</td>
                  <td>{row.lastSeen}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="small text-muted mb-0">
          No experiment views for this user in the last 7 days.
        </p>
      )}
    </>
  );
}
