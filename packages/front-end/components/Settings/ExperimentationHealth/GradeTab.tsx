import React from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  EXPERIMENTATION_HEALTH_AREAS,
  EXPERIMENTATION_HEALTH_WINDOW_DAYS,
  ExperimentationHealthGrade,
  GRADE_BAND_LEGEND,
  MIN_COMPLETED_EXPERIMENTS_FOR_GRADE,
  reflowGradeWeights,
} from "shared/enterprise";
import {
  ExperimentationHealthGradeWeights,
  experimentationHealthGradedAreas,
} from "shared/validators";
import Text from "@/ui/Text";
import ShareBar from "@/components/Settings/ExperimentQuality/ShareBar";
import qualityStyles from "@/components/Settings/ExperimentQuality/ExperimentQuality.module.scss";
import { OrgDefaultLink, OverrideDot } from "./OverrideMarker";
import { AREA_COLORS } from "./healthDisplay";
import styles from "./ExperimentationHealth.module.scss";

function GradePreview({
  savedGrade,
  draftGrade,
  loading,
}: {
  savedGrade: ExperimentationHealthGrade | null;
  draftGrade: ExperimentationHealthGrade | null;
  loading: boolean;
}) {
  if (loading || !savedGrade || !draftGrade) {
    return (
      <Text size="md" color="text-mid">
        Calculating the grade…
      </Text>
    );
  }
  if (draftGrade.notEnoughData) {
    return (
      <Text size="md" color="text-mid">
        Not enough data for a grade. It needs at least{" "}
        {MIN_COMPLETED_EXPERIMENTS_FOR_GRADE} experiments completed in the last{" "}
        {EXPERIMENTATION_HEALTH_WINDOW_DAYS} days.
      </Text>
    );
  }
  if (!draftGrade.letter) {
    return (
      <Text size="md" color="text-mid">
        Set a target for at least one graded area to see a grade.
      </Text>
    );
  }
  const changed = savedGrade.letter !== draftGrade.letter;
  return (
    <Text size="md" color="text-mid">
      With these targets and weights:{" "}
      {changed && savedGrade.letter && (
        <>
          <Text weight="semibold" color="text-high">
            {savedGrade.letter}
          </Text>{" "}
          →{" "}
        </>
      )}
      <span
        style={{
          fontWeight: 600,
          color: changed ? "var(--green-11)" : "var(--color-text-high)",
        }}
      >
        {draftGrade.letter}
      </span>
    </Text>
  );
}

export default function GradeTab({
  isOrgScope,
  weights,
  orgWeights,
  overridden,
  setWeights,
  savedGrade,
  draftGrade,
  loading,
}: {
  isOrgScope: boolean;
  weights: ExperimentationHealthGradeWeights;
  orgWeights: ExperimentationHealthGradeWeights;
  overridden: boolean;
  // undefined resets a Project's weights to the organization default
  setWeights: (weights: ExperimentationHealthGradeWeights | undefined) => void;
  savedGrade: ExperimentationHealthGrade | null;
  draftGrade: ExperimentationHealthGrade | null;
  loading: boolean;
}) {
  const showOverrides = overridden && !isOrgScope;

  return (
    <Box mt="4">
      <Text as="p" size="md" color="text-mid" mb="3">
        Each graded area is scored 0–100 against its targets. These weights
        decide how much each area contributes to the letter grade.
      </Text>

      <div className={qualityStyles.distributionStrip}>
        {experimentationHealthGradedAreas.map((area) => (
          <span
            key={area}
            style={{
              width: `${weights[area]}%`,
              background: AREA_COLORS[area].bar,
            }}
          />
        ))}
      </div>

      <Box className={styles.card} mt="3">
        {experimentationHealthGradedAreas.map((area) => {
          const { label, gradeDetail } = EXPERIMENTATION_HEALTH_AREAS[area];
          return (
            <div key={area} className={styles.weightRow}>
              <Box>
                <Flex align="center" gap="2">
                  <span
                    style={{
                      color: AREA_COLORS[area].text,
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {label}
                  </span>
                  {showOverrides && weights[area] !== orgWeights[area] && (
                    <OverrideDot />
                  )}
                </Flex>
                <Text size="sm" color="text-low">
                  {gradeDetail}
                </Text>
              </Box>
              <ShareBar
                value={weights[area]}
                onChange={(v) =>
                  setWeights(reflowGradeWeights(weights, area, v))
                }
                color={AREA_COLORS[area].bar}
                variant="section"
                ariaLabel={`${label}, ${weights[area]}% of grade`}
              />
              <span
                style={{
                  textAlign: "right",
                  fontSize: 13,
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {weights[area]}%
              </span>
            </div>
          );
        })}
      </Box>
      {showOverrides && (
        <Flex justify="end" mt="1">
          <OrgDefaultLink
            value={experimentationHealthGradedAreas
              .map((a) => `${orgWeights[a]}%`)
              .join(" / ")}
            onReset={() => setWeights(undefined)}
          />
        </Flex>
      )}

      <Flex
        justify="between"
        align="center"
        gap="3"
        mt="3"
        px="4"
        py="3"
        style={{
          background: "var(--color-panel)",
          border: "1px solid var(--border-color-200)",
          borderRadius: 8,
        }}
      >
        <GradePreview
          savedGrade={savedGrade}
          draftGrade={draftGrade}
          loading={loading}
        />
        <span
          style={{
            fontSize: 12,
            whiteSpace: "nowrap",
            color: "var(--color-text-low)",
          }}
        >
          {GRADE_BAND_LEGEND}
        </span>
      </Flex>
    </Box>
  );
}
