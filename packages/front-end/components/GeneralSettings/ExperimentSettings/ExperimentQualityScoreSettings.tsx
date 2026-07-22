import React, { useState } from "react";
import { useFormContext } from "react-hook-form";
import { Box, Flex } from "@radix-ui/themes";
import {
  DEFAULT_EXPERIMENT_QUALITY_CHECKS,
  ExperimentQualityScoreSettings as ExperimentQualityScoreSettingsType,
  experimentQualityCheckKeys,
  resolveExperimentQualityScoreSettings,
} from "shared/enterprise";
import Checkbox from "@/ui/Checkbox";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Field from "@/components/Forms/Field";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";

// Expands stored (possibly partial) settings into fully-populated form
// values so every check has explicit enabled/weight inputs
export function getExperimentQualityScoreFormValues(
  settings?: ExperimentQualityScoreSettingsType,
): ExperimentQualityScoreSettingsType {
  const resolved = resolveExperimentQualityScoreSettings(settings);
  return {
    enabled: resolved.enabled,
    aiChecksEnabled: resolved.aiChecksEnabled,
    aiContext: resolved.aiContext,
    checks: Object.fromEntries(
      experimentQualityCheckKeys.map((key) => [
        key,
        {
          enabled: resolved.checks[key].enabled,
          weight: resolved.checks[key].weight,
        },
      ]),
    ),
  };
}

const ExperimentQualityScoreSettings = () => {
  const { hasCommercialFeature } = useUser();
  const form = useFormContext();
  const { apiCall } = useAuth();

  const hasFeature = hasCommercialFeature("experiment-quality-score");
  const enabled = form.watch("experimentQualityScoreSettings.enabled");
  const aiChecksEnabled = form.watch(
    "experimentQualityScoreSettings.aiChecksEnabled",
  );
  const orgAIEnabled = form.watch("aiEnabled");

  const [recalculateStatus, setRecalculateStatus] = useState("");

  const aiCheckKeys = experimentQualityCheckKeys.filter(
    (key) => DEFAULT_EXPERIMENT_QUALITY_CHECKS[key].type === "ai",
  );
  const deterministicCheckKeys = experimentQualityCheckKeys.filter(
    (key) => DEFAULT_EXPERIMENT_QUALITY_CHECKS[key].type === "deterministic",
  );

  const renderCheckRow = (key: string, disabled: boolean) => (
    <Flex key={key} align="center" gap="3" mb="2">
      <Checkbox
        mb="0"
        value={
          !disabled &&
          form.watch(`experimentQualityScoreSettings.checks.${key}.enabled`)
        }
        setValue={(v) =>
          form.setValue(
            `experimentQualityScoreSettings.checks.${key}.enabled`,
            v,
          )
        }
        id={`toggle-quality-check-${key}`}
        disabled={disabled}
      />
      <Box flexGrow="1">
        <label htmlFor={`toggle-quality-check-${key}`} className="mb-0">
          {DEFAULT_EXPERIMENT_QUALITY_CHECKS[key].label}
        </label>
      </Box>
      <Flex align="center" gap="2">
        <Text size="small" color="text-mid">
          Weight
        </Text>
        <Box width="70px">
          <Field
            type="number"
            step="0.5"
            min="0"
            disabled={disabled}
            {...form.register(
              `experimentQualityScoreSettings.checks.${key}.weight`,
              { valueAsNumber: true, min: 0 },
            )}
          />
        </Box>
      </Flex>
    </Flex>
  );

  return (
    <Box className="appbox p-3">
      <Heading as="h4" size="small" mb="4">
        Experiment Quality Scoring
        <PremiumTooltip
          commercialFeature="experiment-quality-score"
          style={{ display: "inline-flex" }}
        />
      </Heading>
      <Box mb="4">
        <Text size="medium" color="text-mid">
          Score experiments 0&ndash;100 on completeness and trustworthiness
          &mdash; hypothesis, screenshots, documented decisions and learnings,
          health checks, and optional AI review. Scores appear on the Learnings
          page.
        </Text>
      </Box>
      <Flex display="inline-flex" gap="3" mb="4" align="center">
        <Checkbox
          mb="0"
          value={
            hasFeature && form.watch("experimentQualityScoreSettings.enabled")
          }
          setValue={(v) =>
            form.setValue("experimentQualityScoreSettings.enabled", v)
          }
          id="toggle-experimentQualityScoreEnabled"
          disabled={!hasFeature}
        />
        <Box>
          <label
            htmlFor="toggle-experimentQualityScoreEnabled"
            className="font-weight-semibold mb-0"
          >
            Enable experiment quality scoring
          </label>
        </Box>
      </Flex>
      {hasFeature && enabled && (
        <>
          <Box mb="4">
            <Heading as="h5" size="x-small" mb="2">
              Completeness Checks
            </Heading>
            {deterministicCheckKeys.map((key) => renderCheckRow(key, false))}
          </Box>
          <Box mb="4">
            <Flex display="inline-flex" gap="3" mb="2" align="center">
              <Checkbox
                mb="0"
                value={!!orgAIEnabled && aiChecksEnabled}
                setValue={(v) =>
                  form.setValue(
                    "experimentQualityScoreSettings.aiChecksEnabled",
                    v,
                  )
                }
                id="toggle-experimentQualityScoreAIChecks"
                disabled={!orgAIEnabled}
              />
              <Box>
                <label
                  htmlFor="toggle-experimentQualityScoreAIChecks"
                  className="font-weight-semibold mb-0"
                >
                  Include AI checks
                </label>
              </Box>
            </Flex>
            {!orgAIEnabled && (
              <HelperText status="info" size="sm" mb="2">
                Enable AI in the AI Settings tab to include AI checks in the
                score.
              </HelperText>
            )}
            {orgAIEnabled && aiChecksEnabled && (
              <>
                <Box mb="3">
                  {aiCheckKeys.map((key) => renderCheckRow(key, false))}
                </Box>
                <Box mb="2">
                  <label
                    htmlFor="experimentQualityScoreAIContext"
                    className="font-weight-semibold mb-1"
                  >
                    AI context
                  </label>
                  <Field
                    id="experimentQualityScoreAIContext"
                    textarea
                    minRows={3}
                    placeholder="Company or team context to help the AI judge hypotheses, metric alignment, and learnings (e.g. what your product does, naming conventions for metrics)..."
                    {...form.register(
                      "experimentQualityScoreSettings.aiContext",
                    )}
                  />
                </Box>
              </>
            )}
          </Box>
          <Box>
            <Button
              variant="soft"
              onClick={async () => {
                setRecalculateStatus("");
                const res = await apiCall<{ status: number; queued: number }>(
                  "/experiment-quality-score/recalculate",
                  { method: "POST" },
                );
                setRecalculateStatus(
                  `Queued ${res.queued} experiment${
                    res.queued === 1 ? "" : "s"
                  } for AI re-scoring. Scores update in the background.`,
                );
              }}
            >
              Recalculate all experiment scores
            </Button>
            <HelperText status="info" size="sm" mt="1">
              Re-runs AI checks for all stopped experiments using the saved
              settings. Save your changes first. Completeness checks always
              reflect the latest settings automatically.
            </HelperText>
            {recalculateStatus && (
              <HelperText status="success" size="sm" mt="1">
                {recalculateStatus}
              </HelperText>
            )}
          </Box>
        </>
      )}
    </Box>
  );
};

export default ExperimentQualityScoreSettings;
