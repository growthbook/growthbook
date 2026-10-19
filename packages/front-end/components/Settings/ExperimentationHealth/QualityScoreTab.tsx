import React, { ReactNode, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCheckCircleFill, PiDotsThreeVerticalBold } from "react-icons/pi";
import { ResolvedQualityScope } from "shared/enterprise";
import {
  ExperimentQualityConfigInterface,
  ExperimentationHealthQualitySettings,
  ORG_DEFAULT_SCOPE,
} from "shared/validators";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import { Select, SelectItem, SelectSeparator } from "@/ui/Select";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import QualityConfigEditor from "@/components/Settings/ExperimentQuality/QualityConfigEditor";
import { QualityConfigDraft } from "@/components/Settings/ExperimentQuality/qualityConfigDraft";
import { OrgDefaultLink, OverrideDot } from "./OverrideMarker";
import ConfigNameModal from "./ConfigNameModal";

export const GROWTHBOOK_DEFAULT_CONFIG_LABEL = "GrowthBook default";
const DEFAULT_CONFIG_VALUE = "__growthbook-default__";
const CREATE_CONFIG_VALUE = "__create__";

// e.g. "the organization default and 2 other Projects"
function describeOtherScopes(
  scopes: string[],
  viewingProject: boolean,
): string {
  const hasOrg = scopes.includes(ORG_DEFAULT_SCOPE);
  const projectCount = scopes.filter((s) => s !== ORG_DEFAULT_SCOPE).length;
  const other = viewingProject ? "other " : "";
  const parts = [
    ...(hasOrg ? ["the organization default"] : []),
    ...(projectCount
      ? [
          `${projectCount} ${other}${projectCount === 1 ? "Project" : "Projects"}`,
        ]
      : []),
  ];
  return parts.join(" and ");
}

export default function QualityScoreTab({
  scope,
  orgQuality,
  qualityDraft,
  setQualityDraft,
  effective,
  effectiveConfig,
  configDraft,
  setConfigDraft,
  configDirty,
  anyDirty,
  canEditConfig,
  canRecalculate,
  aiAvailable,
  hypothesisDefinition,
  stoppedExperiments,
  createConfig,
}: {
  // ORG_DEFAULT_SCOPE or a Project id
  scope: string;
  orgQuality: ExperimentationHealthQualitySettings;
  qualityDraft: ExperimentationHealthQualitySettings;
  setQualityDraft: (q: ExperimentationHealthQualitySettings) => void;
  effective: ResolvedQualityScope;
  effectiveConfig: ExperimentQualityConfigInterface | null;
  configDraft: QualityConfigDraft;
  setConfigDraft: (d: QualityConfigDraft) => void;
  configDirty: boolean;
  anyDirty: boolean;
  // Configurations can be created by anyone on this page; changing one
  // needs every scope using it to be editable
  canEditConfig: boolean;
  canRecalculate: boolean;
  aiAvailable: boolean;
  hypothesisDefinition: string;
  stoppedExperiments?: number;
  // Creates a configuration from the checks and weights being edited
  createConfig: (name: string) => Promise<string>;
}) {
  const { apiCall } = useAuth();
  const {
    experimentQualityConfigs,
    experimentationHealthSettings,
    getExperimentQualityConfigById,
    mutateDefinitions,
  } = useDefinitions();

  const [createOpen, setCreateOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [recalculateStatus, setRecalculateStatus] = useState("");

  const isOrgScope = scope === ORG_DEFAULT_SCOPE;
  const orgConfigName = orgQuality.configId
    ? (getExperimentQualityConfigById(orgQuality.configId)?.name ??
      GROWTHBOOK_DEFAULT_CONFIG_LABEL)
    : GROWTHBOOK_DEFAULT_CONFIG_LABEL;

  // A Project can't explicitly choose the built-in default while the
  // organization default uses a named configuration
  const offerGrowthBookDefault = isOrgScope || !orgQuality.configId;

  // Every scope whose saved record names this configuration
  const usedByScopes = effectiveConfig
    ? experimentationHealthSettings
        .filter((r) => r.quality?.configId === effectiveConfig.id)
        .map((r) => r.project)
    : [];
  // Shown when edits to these checks and weights also change them elsewhere
  const configName = effectiveConfig ? `“${effectiveConfig.name}”` : "";
  const otherScopes = usedByScopes.filter((s) => s !== scope);
  let sharedNote: ReactNode = null;
  if (effectiveConfig && !isOrgScope && !effective.overridden.configId) {
    sharedNote = (
      <>
        {canEditConfig
          ? `This Project uses ${configName} from the organization default, so changes here also change it for the organization and every Project using it.`
          : `This Project uses ${configName} from the organization default, which only organization admins can change.`}{" "}
        <Link onClick={() => setCreateOpen(true)}>
          Make a copy for just this Project
        </Link>
      </>
    );
  } else if (effectiveConfig && otherScopes.length) {
    const others = describeOtherScopes(otherScopes, !isOrgScope);
    sharedNote = canEditConfig ? (
      `${configName} is also used by ${others}, so changes here apply there too.`
    ) : (
      <>
        {configName} is also used by {others}, so only organization admins can
        change it.{" "}
        <Link onClick={() => setCreateOpen(true)}>
          Make a copy for just this Project
        </Link>
      </>
    );
  }

  return (
    <Box>
      {createOpen && (
        <ConfigNameModal
          header="Create Configuration"
          cta="Create"
          note={`Starts from the checks and weights shown below. Save the page to use it for ${isOrgScope ? "the organization default" : "this Project"}.`}
          close={() => setCreateOpen(false)}
          submit={async (name) => {
            const configId = await createConfig(name);
            setQualityDraft({ ...qualityDraft, configId });
          }}
        />
      )}

      {renameOpen && effectiveConfig && (
        <ConfigNameModal
          header="Rename Configuration"
          cta="Rename"
          initialName={effectiveConfig.name}
          close={() => setRenameOpen(false)}
          submit={async (name) => {
            await apiCall(
              `/experiment-quality-score/configs/${effectiveConfig.id}`,
              { method: "PUT", body: JSON.stringify({ name }) },
            );
            await mutateDefinitions();
          }}
        />
      )}

      {deleteOpen && effectiveConfig && (
        <ModalStandard
          open
          trackingEventModalType="delete-experiment-quality-config"
          header="Delete Configuration"
          cta="Delete"
          ctaColor="red"
          close={() => setDeleteOpen(false)}
          submit={async () => {
            await apiCall(
              `/experiment-quality-score/configs/${effectiveConfig.id}`,
              { method: "DELETE" },
            );
            await mutateDefinitions();
          }}
        >
          <Text as="p">
            Delete <Text weight="semibold">{effectiveConfig.name}</Text>? A
            configuration can only be deleted once no scope uses it. Pick a
            different configuration for each scope and save first.
          </Text>
        </ModalStandard>
      )}

      {/* Header row */}
      <Flex justify="between" align="start" gap="4" mt="4" mb="3">
        <Box style={{ maxWidth: 520 }}>
          <Text size="md" color="text-mid">
            Score every experiment 0–100 on completeness and trustworthiness.
            Shown on each experiment and the Learnings page.
          </Text>
        </Box>
        <Flex gap="4" align="start" flexShrink="0">
          <Flex direction="column" align="end" gap="1">
            <Flex align="center" gap="2">
              {effective.overridden.configId && !isOrgScope && <OverrideDot />}
              <Text size="sm" color="text-mid">
                Configuration:
              </Text>
              <Select
                size="sm"
                value={effective.configId ?? DEFAULT_CONFIG_VALUE}
                disabled={configDirty}
                setValue={(v) => {
                  if (v === CREATE_CONFIG_VALUE) {
                    setCreateOpen(true);
                    return;
                  }
                  setQualityDraft({
                    ...qualityDraft,
                    configId: v === DEFAULT_CONFIG_VALUE ? undefined : v,
                  });
                }}
              >
                {offerGrowthBookDefault && (
                  <SelectItem value={DEFAULT_CONFIG_VALUE}>
                    {GROWTHBOOK_DEFAULT_CONFIG_LABEL}
                  </SelectItem>
                )}
                {experimentQualityConfigs.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
                <SelectSeparator />
                <SelectItem value={CREATE_CONFIG_VALUE}>
                  Create new configuration…
                </SelectItem>
              </Select>
              {effectiveConfig && canEditConfig && (
                <DropdownMenu
                  trigger={
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Configuration actions"
                    >
                      <PiDotsThreeVerticalBold />
                    </Button>
                  }
                  menuPlacement="end"
                >
                  <DropdownMenuItem onClick={() => setRenameOpen(true)}>
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    color="red"
                    onClick={() => setDeleteOpen(true)}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenu>
              )}
            </Flex>
            {configDirty && (
              <Text size="sm" color="text-low">
                Save or cancel your edits to switch configurations
              </Text>
            )}
            {!isOrgScope && effective.overridden.configId && (
              <OrgDefaultLink
                value={orgConfigName}
                onReset={() =>
                  setQualityDraft({ ...qualityDraft, configId: undefined })
                }
              />
            )}
          </Flex>
          <Flex direction="column" align="end" gap="1">
            <Flex align="center" gap="2">
              {effective.overridden.enabled && !isOrgScope && <OverrideDot />}
              <Switch
                label="Enabled"
                value={effective.enabled}
                onChange={(v) =>
                  setQualityDraft({ ...qualityDraft, enabled: v })
                }
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

      {sharedNote && (
        <Box mb="3">
          <HelperText status="info" size="sm">
            {sharedNote}
          </HelperText>
        </Box>
      )}

      <Box>
        <QualityConfigEditor
          draft={configDraft}
          setDraft={setConfigDraft}
          aiAvailable={aiAvailable}
          // Edits to the built-in default are saved as a new configuration
          readOnly={!!effectiveConfig && !canEditConfig}
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
                      {stoppedExperiments ?? "…"} stopped
                    </Text>{" "}
                    · uses AI tokens.
                  </Text>
                  <Button
                    variant="outline"
                    disabled={anyDirty || !effective.enabled}
                    title={
                      anyDirty
                        ? "Save your changes first — recalculation uses the saved settings"
                        : !effective.enabled
                          ? "Turn on quality scoring to recalculate AI verdicts"
                          : undefined
                    }
                    onClick={async () => {
                      setRecalculateStatus("");
                      const res = await apiCall<{ queued: number }>(
                        "/experiment-quality-score/recalculate",
                        { method: "POST" },
                      );
                      setRecalculateStatus(
                        `Queued ${res.queued} experiment${res.queued === 1 ? "" : "s"} for AI re-scoring. Verdicts update in the background.`,
                      );
                    }}
                  >
                    Recalculate AI verdicts
                  </Button>
                </Flex>
                {recalculateStatus && (
                  <HelperText status="success" size="sm" mt="2">
                    {recalculateStatus}
                  </HelperText>
                )}
              </Box>
            )
          }
        />
      </Box>

      {effective.enabled && (
        <Flex
          align="center"
          gap="2"
          px="3"
          py="2"
          style={{
            borderRadius: 6,
            background: "var(--slate-2)",
            border: "1px solid var(--border-color-100)",
          }}
        >
          <PiCheckCircleFill size={14} color="var(--green-9)" />
          <Text size="sm" color="text-mid">
            Changes to the quality checks and weights will re-score all
            non-archived experiments
          </Text>
        </Flex>
      )}
    </Box>
  );
}
