import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { getScopedSettings } from "shared/settings";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import { Select, SelectItem } from "@/ui/Select";
import Checkbox from "@/ui/Checkbox";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import { SetupDraft } from "./setupDraft";

// The Statistics card in the Analysis Plan's Advanced section (set in
// review): labelled rows, "Stats Engine" as a
// select and "Variance Reduction" as two checkboxes with a reset. All
// @/ui/ components (Select, Checkbox, Link, TextField, Text); the legacy
// SelectField/Field/StatsEngineSelect it used before are gone from here.
//
// Same draft fields and save semantics as before. Where a setting can follow
// the org/project default (engine, post-stratification, sequential testing),
// choosing the default's value stores "follow the default" (""/null/
// "default"), as picking "Default (...)" used to; anything else is stored as
// an explicit choice. CUPED has no "follow the default" state in the draft,
// as before.

// A label above its control (set in review; it had been a label column on
// the left), styled like the other Advanced cards' field labels: 12px at
// weight 500, 4px above the control. labelGap overrides that 4px.
function Row({
  label,
  labelGap = 4,
  children,
}: {
  label: string;
  labelGap?: number;
  children: ReactNode;
}) {
  return (
    <Box>
      {/* The gap on a wrapper: @/ui/Text takes no style. */}
      <Box style={{ marginBottom: labelGap }}>
        <Text as="div" size="sm" weight="medium">
          {label}
        </Text>
      </Box>
      {children}
    </Box>
  );
}

const ENGINE_LABELS = { bayesian: "Bayesian", frequentist: "Frequentist" };

export default function StatsSettingsFields({
  experiment,
  draft,
  update,
  editable,
}: {
  experiment: ExperimentInterfaceStringDates;
  draft: SetupDraft;
  update: (patch: Partial<SetupDraft>) => void;
  editable: boolean;
}) {
  const { organization, hasCommercialFeature } = useUser();
  const { getProjectById } = useDefinitions();
  const orgSettings = useOrgSettings();

  const project = experiment.project
    ? getProjectById(experiment.project)
    : null;
  // Parent (org/project) settings: the defaults.
  const { settings: parent } = getScopedSettings({
    organization,
    project: project ?? undefined,
  });

  const hasCuped = hasCommercialFeature("regression-adjustment");
  const hasPostStrat = hasCommercialFeature("post-stratification");
  const hasSequential = hasCommercialFeature("sequential-testing");
  const showPostStrat = !orgSettings.disablePrecomputedDimensions;

  // Engine: the effective one is selected; the default's item says so.
  const defaultEngine = parent.statsEngine.value;
  const engine = draft.statsEngine || defaultEngine;

  // CUPED and post-stratification, checked as they'll apply.
  const cupedDefault = !!parent.regressionAdjustmentEnabled.value;
  const postStratDefault =
    hasPostStrat && !!parent.postStratificationEnabled.value;
  const cuped = hasCuped && draft.regressionAdjustmentEnabled;
  const postStrat =
    hasPostStrat &&
    (draft.postStratificationEnabled ??
      !!parent.postStratificationEnabled.value);
  const varianceIsDefault =
    (!hasCuped || draft.regressionAdjustmentEnabled === cupedDefault) &&
    (!showPostStrat || draft.postStratificationEnabled === null);

  // Sequential testing (frequentist only), as it'll apply.
  const sequentialDefault = !!orgSettings.sequentialTestingEnabled;
  const sequential =
    hasSequential &&
    (draft.sequentialMode === "default"
      ? sequentialDefault
      : draft.sequentialMode === "on");

  return (
    // 24px between the rows, set in review.
    <Flex direction="column" gap="5">
      <Row label="Stats Engine">
        <Select
          value={engine}
          setValue={(v) =>
            update({
              statsEngine: (v === defaultEngine
                ? ""
                : v) as SetupDraft["statsEngine"],
            })
          }
          disabled={!editable}
          // 300px, set in review (it had filled the card).
          style={{ width: 300, maxWidth: "100%" }}
        >
          {(["bayesian", "frequentist"] as const).map((e) => (
            <SelectItem key={e} value={e}>
              {ENGINE_LABELS[e]}
              {e === defaultEngine ? " (Default)" : ""}
            </SelectItem>
          ))}
        </Select>
      </Row>

      {/* 8px from the label to the checkboxes (set in review). */}
      <Row label="Variance Reduction" labelGap={8}>
        <Flex align="center" gap="5" wrap="wrap">
          <Checkbox
            label="CUPED"
            weight="regular"
            value={cuped}
            setValue={(v) => update({ regressionAdjustmentEnabled: v })}
            disabled={!editable || !hasCuped}
            disabledMessage={
              !hasCuped ? "CUPED is a premium feature." : undefined
            }
          />
          {showPostStrat ? (
            <Checkbox
              label="Post-Stratification"
              weight="regular"
              value={postStrat}
              setValue={(v) =>
                update({
                  postStratificationEnabled: v === postStratDefault ? null : v,
                })
              }
              disabled={!editable || !hasPostStrat}
              disabledMessage={
                !hasPostStrat
                  ? "Post-stratification is a premium feature."
                  : undefined
              }
            />
          ) : null}
          {/* Back to the org/project defaults for both, as a link button
            (@/ui/Link with onClick renders a <button>), 12px. Hidden while
            they're already at the defaults, or it can't be edited (all set in
            review). */}
          {editable && !varianceIsDefault ? (
            <Link
              size="sm"
              onClick={() =>
                update({
                  regressionAdjustmentEnabled: cupedDefault,
                  postStratificationEnabled: null,
                })
              }
            >
              Reset to Defaults
            </Link>
          ) : null}
        </Flex>
      </Row>

      {engine === "frequentist" ? (
        // 8px from the label to the checkbox (set in review): 2px of label
        // margin plus the ~6px above the checkbox's 20px line, centred in
        // the row's reserved 32px.
        <Row label="Corrections" labelGap={2}>
          {/* Always as tall as the tuning parameter's 32px field, so ticking
            the box and showing it doesn't move anything (fixed in review).
            24px between the checkbox and Tuning Parameter, the same as
            between CUPED and Post-Stratification (set in review). */}
          <Flex align="center" gap="5" wrap="wrap" style={{ minHeight: 32 }}>
            <Checkbox
              label="Sequential Testing"
              weight="regular"
              value={sequential}
              setValue={(v) =>
                update({
                  sequentialMode:
                    v === sequentialDefault ? "default" : v ? "on" : "off",
                })
              }
              disabled={!editable || !hasSequential}
              disabledMessage={
                !hasSequential
                  ? "Sequential testing is a premium feature."
                  : undefined
              }
            />
            {sequential ? (
              // Editing the tuning parameter makes the choice explicit, as
              // the org's value applies only while following the default.
              <Flex align="center" gap="2">
                {/* 12px in the page text colour, like the rows' labels, at
                  weight 400 (both set in review). Beside the field, so
                  showing it doesn't move anything. */}
                <Text size="sm" weight="regular">
                  Tuning Parameter
                </Text>
                <TextField
                  size="md"
                  type="number"
                  min={0}
                  value={String(draft.sequentialTuningParameter)}
                  onChange={(e) =>
                    update({
                      sequentialMode: "on",
                      sequentialTuningParameter: Number(e.target.value),
                    })
                  }
                  disabled={!editable || !hasSequential}
                  aria-label="Sequential testing tuning parameter"
                  style={{ width: 96 }}
                />
              </Flex>
            ) : null}
          </Flex>
        </Row>
      ) : null}
    </Flex>
  );
}
