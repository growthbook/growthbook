import { KeyboardEvent, PointerEvent, useRef } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { EXPERIMENT_QUALITY_SECTIONS } from "shared/enterprise";
import {
  ExperimentQualitySectionKey,
  experimentQualitySectionKeys,
} from "shared/validators";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { SECTION_COLORS } from "@/components/Experiment/Quality/qualityDisplay";
import { ChangedDot } from "./ChangeMarkers";
import {
  QualityConfigDraft,
  getEnabledSectionKeys,
  moveSectionDivider,
  setSectionWeight,
} from "./qualityConfigDraft";
import PercentInput from "./PercentInput";
import styles from "./ExperimentQuality.module.scss";

export default function SectionWeights({
  draft,
  setDraft,
  // Sections that can't take a share, like AI checks while AI is off
  unavailable = [],
  base,
  disabled = false,
}: {
  draft: QualityConfigDraft;
  setDraft: (draft: QualityConfigDraft) => void;
  unavailable?: ExperimentQualitySectionKey[];
  // The organization default, on a Project's page
  base?: QualityConfigDraft;
  disabled?: boolean;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const enabled = getEnabledSectionKeys(draft).filter(
    (k) => !unavailable.includes(k),
  );
  const weightOf = (k: ExperimentQualitySectionKey) =>
    enabled.includes(k) ? draft.sections[k].weight : 0;
  const total = enabled.reduce((sum, k) => sum + weightOf(k), 0) || 1;
  const boundaries = enabled
    .slice(0, -1)
    .map((_, i) =>
      enabled.slice(0, i + 1).reduce((sum, k) => sum + weightOf(k), 0),
    );

  const positionAt = (clientX: number) => {
    const box = barRef.current?.getBoundingClientRect();
    if (!box?.width) return null;
    return ((clientX - box.left) / box.width) * total;
  };

  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const drag = (index: number) => (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const position = positionAt(e.clientX);
    if (position !== null) {
      setDraft(moveSectionDivider(draft, index, position, enabled));
    }
  };
  const nudge = (index: number) => (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 5 : 1;
    const delta =
      e.key === "ArrowLeft" || e.key === "ArrowDown"
        ? -step
        : e.key === "ArrowRight" || e.key === "ArrowUp"
          ? step
          : 0;
    if (!delta || disabled) return;
    e.preventDefault();
    setDraft(
      moveSectionDivider(draft, index, boundaries[index] + delta, enabled),
    );
  };

  return (
    <Box mb="4">
      <Heading as="h3" size="sm" mb="3">
        Section Weights
      </Heading>
      <div className={styles.weightBar} ref={barRef}>
        {enabled.map((k) => (
          <span
            key={k}
            style={{
              width: `${(weightOf(k) / total) * 100}%`,
              background: SECTION_COLORS[k].bar,
            }}
          />
        ))}
        {boundaries.map((position, i) => (
          <div
            key={enabled[i]}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label={`Divider between ${EXPERIMENT_QUALITY_SECTIONS[enabled[i]].label} and ${EXPERIMENT_QUALITY_SECTIONS[enabled[i + 1]].label}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={position}
            aria-valuetext={`${EXPERIMENT_QUALITY_SECTIONS[enabled[i]].label} ${weightOf(enabled[i])}%, ${EXPERIMENT_QUALITY_SECTIONS[enabled[i + 1]].label} ${weightOf(enabled[i + 1])}%`}
            aria-disabled={disabled}
            className={styles.weightHandle}
            style={{ left: `${(position / total) * 100}%` }}
            onPointerDown={startDrag}
            onPointerMove={drag(i)}
            onKeyDown={nudge(i)}
          />
        ))}
      </div>
      <Flex justify="center" gap="5" wrap="wrap" mt="3">
        {experimentQualitySectionKeys.map((k) => {
          const on = enabled.includes(k);
          const changed =
            !!base && base.sections[k].weight !== draft.sections[k].weight;
          return (
            <Flex key={k} align="center" gap="2">
              {changed ? <ChangedDot /> : null}
              <span
                className={styles.swatch}
                style={{ background: SECTION_COLORS[k].bar }}
              />
              <Text color={on ? "text-high" : "text-low"}>
                {EXPERIMENT_QUALITY_SECTIONS[k].label}
              </Text>
              <PercentInput
                value={weightOf(k)}
                disabled={!on || disabled}
                ariaLabel={`${EXPERIMENT_QUALITY_SECTIONS[k].label} weight`}
                onChange={(v) =>
                  setDraft(setSectionWeight(draft, k, v, enabled))
                }
              />
            </Flex>
          );
        })}
      </Flex>
    </Box>
  );
}
