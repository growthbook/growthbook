import React, { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { ResolvedQualityScope } from "shared/enterprise";
import { ExperimentationHealthQualitySettings } from "shared/validators";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
import QualityConfigEditor from "@/components/Settings/ExperimentQuality/QualityConfigEditor";
import { QualityConfigDraft } from "@/components/Settings/ExperimentQuality/qualityConfigDraft";
import { OrgDefaultLink, OverrideDot } from "./OverrideMarker";

export default function QualityScoreTab({
  isOrgScope,
  orgQuality,
  qualityDraft,
  setQualityDraft,
  effective,
  configDraft,
  setConfigDraft,
  checksCustomized,
  resetChecks,
  anyDirty,
  canRecalculate,
  aiAvailable,
  hypothesisDefinition,
  experimentCount,
}: {
  isOrgScope: boolean;
  orgQuality: ExperimentationHealthQualitySettings;
  qualityDraft: ExperimentationHealthQualitySettings;
  setQualityDraft: (q: ExperimentationHealthQualitySettings) => void;
  effective: ResolvedQualityScope;
  configDraft: QualityConfigDraft;
  setConfigDraft: (d: QualityConfigDraft) => void;
  // A Project's own checks, saved or being edited
  checksCustomized: boolean;
  resetChecks: () => void;
  anyDirty: boolean;
  canRecalculate: boolean;
  aiAvailable: boolean;
  hypothesisDefinition: string;
  // Non-archived experiments, for the re-score note
  experimentCount?: number;
}) {
  const { apiCall } = useAuth();
  const [recalculateStatus, setRecalculateStatus] = useState("");
  const [confirmRecalculate, setConfirmRecalculate] = useState(false);
  const recalculateBlocked = anyDirty
    ? "Save your changes first. Recalculating uses the saved settings."
    : !effective.enabled
      ? "Turn on quality scoring to recalculate AI verdicts."
      : "";

  return (
    <Box>
      {confirmRecalculate && (
        <ConfirmDialog
          title="Recalculate AI Verdicts"
          content={`This re-runs the AI checks for ${experimentCount ?? "every"} non-archived experiments and uses AI tokens. Verdicts update in the background.`}
          yesText="Recalculate"
          onCancel={() => setConfirmRecalculate(false)}
          onConfirm={async () => {
            const res = await apiCall<{ queued: number }>(
              "/experiment-quality-score/recalculate",
              { method: "POST" },
            );
            setConfirmRecalculate(false);
            setRecalculateStatus(
              `Queued ${res.queued} experiment${res.queued === 1 ? "" : "s"} for AI re-scoring.`,
            );
          }}
        />
      )}
      {/* Header row */}
      <Flex justify="between" align="start" gap="4" mt="4" mb="3">
        <Box style={{ maxWidth: 520 }}>
          <Text size="md" color="text-mid">
            Score every experiment 0–100 on completeness and trustworthiness.
            Shown on each experiment and the Learnings page.
          </Text>
        </Box>
        <Flex direction="column" align="end" gap="1" flexShrink="0">
          <Flex align="center" gap="2">
            {effective.overridden.enabled && !isOrgScope && <OverrideDot />}
            <Switch
              label="Enabled"
              value={effective.enabled}
              onChange={(v) => setQualityDraft({ ...qualityDraft, enabled: v })}
            />
          </Flex>
          {!isOrgScope && effective.overridden.enabled && (
            <OrgDefaultLink
              value={orgQuality.enabled ? "On" : "Off"}
              onReset={() =>
                setQualityDraft({ ...qualityDraft, enabled: undefined })
              }
            />
          )}
        </Flex>
      </Flex>

      {!effective.enabled && (
        <Callout status="info" size="sm" mb="3">
          Quality scoring is off for{" "}
          {isOrgScope ? "the organization default" : "this Project"}. You can
          set up the checks now — they apply once it&apos;s turned on.{" "}
          <Link
            onClick={() => setQualityDraft({ ...qualityDraft, enabled: true })}
          >
            Turn on
          </Link>
        </Callout>
      )}

      {!isOrgScope && (
        <Flex align="center" gap="2" mb="3">
          {checksCustomized && <OverrideDot />}
          <HelperText status="info" size="sm">
            {checksCustomized ? (
              <>
                This Project uses its own checks.{" "}
                <Link onClick={resetChecks}>
                  Use the organization default&apos;s checks
                </Link>
              </>
            ) : (
              "This Project uses the organization default's checks. Changing them here makes a copy for just this Project."
            )}
          </HelperText>
        </Flex>
      )}

      <QualityConfigEditor
        draft={configDraft}
        setDraft={setConfigDraft}
        aiAvailable={aiAvailable}
        hypothesisDefinition={hypothesisDefinition}
        aiSectionFooter={
          canRecalculate && (
            <Box
              pt="3"
              mt="1"
              mb="1"
              style={{ borderTop: "1px solid var(--border-color-100)" }}
            >
              <Flex align="center" justify="between" gap="3">
                <Text size="sm" color="text-mid">
                  AI changes apply to new verdicts only. Re-score existing
                  experiments —{" "}
                  <Text weight="semibold" color="text-high">
                    {experimentCount ?? "…"} experiments
                  </Text>{" "}
                  · uses AI tokens.
                </Text>
                <Button
                  variant="outline"
                  disabled={!!recalculateBlocked}
                  onClick={() => {
                    setRecalculateStatus("");
                    setConfirmRecalculate(true);
                  }}
                >
                  Recalculate AI verdicts
                </Button>
              </Flex>
              {recalculateBlocked ? (
                <HelperText status="info" size="sm" mt="2">
                  {recalculateBlocked}
                </HelperText>
              ) : (
                recalculateStatus && (
                  <HelperText status="success" size="sm" mt="2">
                    {recalculateStatus}
                  </HelperText>
                )
              )}
            </Box>
          )
        }
      />

      {effective.enabled && (
        <Callout status="info" size="sm">
          Saving changes to the checks or weights re-scores every non-archived
          experiment in this scope.
        </Callout>
      )}
    </Box>
  );
}
