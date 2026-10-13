import React from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  EXPERIMENTATION_HEALTH_AREAS,
  EXPERIMENTATION_HEALTH_METRICS,
  EXPERIMENTATION_HEALTH_WINDOW_DAYS,
  ExperimentationHealthArea,
  ExperimentationHealthValues,
  ResolvedHealthTarget,
  getHealthTargetError,
  isTargetSet,
  isValueInTarget,
} from "shared/enterprise";
import {
  ExperimentationHealthMetricKey,
  ExperimentationHealthTarget,
  experimentationHealthMetricKeys,
} from "shared/validators";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import { OrgDefaultLink, OverrideDot } from "./OverrideMarker";
import {
  AREA_COLORS,
  formatHealthValue,
  formatTarget,
  getUnitLabel,
} from "./healthDisplay";
import styles from "./ExperimentationHealth.module.scss";

function parseBound(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = parseFloat(raw);
  return Number.isNaN(n) ? null : n;
}

function TargetRow({
  metricKey,
  resolved,
  isOrgScope,
  value,
  loading,
  onChange,
  onReset,
  note,
}: {
  metricKey: ExperimentationHealthMetricKey;
  resolved: ResolvedHealthTarget;
  isOrgScope: boolean;
  value: number | null | undefined;
  loading: boolean;
  onChange: (target: ExperimentationHealthTarget) => void;
  onReset: () => void;
  // Shown under the current value
  note?: string;
}) {
  const def = EXPERIMENTATION_HEALTH_METRICS[metricKey];
  const { target } = resolved;
  const overridden = resolved.overridden && !isOrgScope;
  const error = getHealthTargetError(metricKey, target);

  let nowColor = "var(--color-text-mid)";
  if (value !== null && value !== undefined && isTargetSet(target)) {
    nowColor = isValueInTarget(value, target)
      ? "var(--green-11)"
      : "var(--red-11)";
  }

  return (
    <div className={styles.targetRow}>
      <Box>
        <Flex align="center" gap="2">
          <Text size="md">{def.label}</Text>
          {overridden && <OverrideDot />}
        </Flex>
        <Text as="p" size="sm" color="text-low" mt="1" mb="0">
          {def.hint}
        </Text>
      </Box>
      <Box>
        <Flex align="center" gap="1">
          <input
            type="number"
            min={0}
            className={styles.targetInput}
            data-overridden={overridden || undefined}
            style={{ width: 75 }}
            placeholder="no min"
            aria-label={`${def.label}, minimum`}
            value={target.min ?? ""}
            onChange={(e) =>
              onChange({ ...target, min: parseBound(e.target.value) })
            }
          />
          {!def.minOnly && (
            <>
              <Text size="sm" color="text-mid">
                –
              </Text>
              <input
                type="number"
                min={0}
                className={styles.targetInput}
                data-overridden={overridden || undefined}
                style={{ width: 75 }}
                placeholder="no max"
                aria-label={`${def.label}, maximum`}
                value={target.max ?? ""}
                onChange={(e) =>
                  onChange({ ...target, max: parseBound(e.target.value) })
                }
              />
            </>
          )}
          <Text size="sm" color="text-mid">
            {getUnitLabel(metricKey)}
          </Text>
        </Flex>
        {error && (
          <HelperText status="error" size="sm" mt="1">
            {error}
          </HelperText>
        )}
      </Box>
      <Flex direction="column" align="end" gap="1">
        <span
          style={{
            fontSize: 12,
            fontVariantNumeric: "tabular-nums",
            color: nowColor,
          }}
        >
          {loading
            ? "…"
            : value === null || value === undefined
              ? "—"
              : `Now ${formatHealthValue(metricKey, value)}`}
        </span>
        {note && (
          <Text size="sm" color="text-low">
            {note}
          </Text>
        )}
        {overridden && (
          <OrgDefaultLink
            value={formatTarget(resolved.orgTarget)}
            onReset={onReset}
          />
        )}
      </Flex>
    </div>
  );
}

export default function TargetsTab({
  isOrgScope,
  targets,
  setTarget,
  values,
  ideasInUse,
  processPending,
  loading,
}: {
  isOrgScope: boolean;
  targets: Record<ExperimentationHealthMetricKey, ResolvedHealthTarget>;
  // undefined resets a Project's target to the organization default
  setTarget: (
    key: ExperimentationHealthMetricKey,
    target: ExperimentationHealthTarget | undefined,
  ) => void;
  values?: ExperimentationHealthValues;
  ideasInUse: boolean;
  // Completed experiments whose process score is still being calculated
  processPending: number;
  loading: boolean;
}) {
  const areas = (
    Object.keys(EXPERIMENTATION_HEALTH_AREAS) as ExperimentationHealthArea[]
  ).filter((a) => a !== "ideas" || ideasInUse);

  return (
    <Box mt="4">
      <Text as="p" size="sm" color="text-mid" mb="3">
        Leave a target blank to hide it from the dashboard and the grade. Now
        values cover the last {EXPERIMENTATION_HEALTH_WINDOW_DAYS} days.
      </Text>
      {areas.map((area) => {
        const metricKeys = experimentationHealthMetricKeys.filter(
          (k) => EXPERIMENTATION_HEALTH_METRICS[k].area === area,
        );
        const { label, note } = EXPERIMENTATION_HEALTH_AREAS[area];
        return (
          <div key={area} className={styles.areaCard}>
            <Flex
              justify="between"
              align="baseline"
              className={styles.areaHeader}
            >
              <span
                style={{
                  color: AREA_COLORS[area].text,
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {label}
              </span>
              {note && (
                <Text size="sm" color="text-low">
                  {note}
                </Text>
              )}
            </Flex>
            {metricKeys.map((key) => (
              <TargetRow
                key={key}
                metricKey={key}
                resolved={targets[key]}
                isOrgScope={isOrgScope}
                value={values?.[key]}
                loading={loading}
                onChange={(target) => setTarget(key, target)}
                onReset={() => setTarget(key, undefined)}
                note={
                  key === "processScore" && processPending
                    ? `${processPending} still being scored`
                    : undefined
                }
              />
            ))}
          </div>
        );
      })}
    </Box>
  );
}
