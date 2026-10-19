import {
  EXPERIMENTATION_HEALTH_METRICS,
  ExperimentationHealthArea,
} from "shared/enterprise";
import {
  ExperimentationHealthMetricKey,
  ExperimentationHealthTarget,
} from "shared/validators";
import { scaleColors } from "@/components/Experiment/Quality/qualityDisplay";

export const AREA_COLORS: Record<
  ExperimentationHealthArea,
  { bar: string; text: string }
> = {
  velocity: scaleColors("indigo"),
  quality: scaleColors("teal"),
  winRate: scaleColors("green"),
  ideas: { bar: "var(--slate-9)", text: "var(--color-text-high)" },
};

export function getUnitLabel(key: ExperimentationHealthMetricKey): string {
  return EXPERIMENTATION_HEALTH_METRICS[key].unit === "percent" ? "%" : "/ mo";
}

export function formatHealthValue(
  key: ExperimentationHealthMetricKey,
  value: number,
): string {
  return EXPERIMENTATION_HEALTH_METRICS[key].unit === "percent"
    ? `${Math.round(value)}%`
    : `${value.toFixed(1)} / mo`;
}

export function formatTarget(target: ExperimentationHealthTarget): string {
  if (target.min !== null && target.max !== null) {
    return `${target.min}–${target.max}`;
  }
  if (target.min !== null) return `${target.min}`;
  if (target.max !== null) return `≤ ${target.max}`;
  return "none";
}
