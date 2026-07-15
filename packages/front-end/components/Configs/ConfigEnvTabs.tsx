import { useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import SelectField from "@/components/Forms/SelectField";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Tooltip from "@/ui/Tooltip";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import { LineageNode } from "@/components/Configs/fieldSchema";

type Props = {
  // The config currently open (from the URL) — a base or one of its flavors.
  currentKey: string;
  // The open config's id; used to attach a new flavor (create shows on the base only).
  currentConfigId: string;
  lineage: LineageNode[];
  configNames?: Record<string, string>;
  // An archived override still shows a (struck-through) tab so it can be opened
  // to unarchive, but no longer serves a value.
  archivedByKey?: Record<string, boolean>;
  canCreate: boolean;
  mutate: () => Promise<unknown>;
};

// Human label for a scopedOverride entry: its environment(s), else project(s),
// else a catch-all.
function scopeLabel(entry: {
  environments?: string[];
  projects?: string[];
}): string {
  if (entry.environments?.length) return entry.environments.join(", ");
  if (entry.projects?.length) return entry.projects.join(", ");
  return "Fallback";
}

// Opaque, collision-resistant key for a generated flavor — never shown to the
// user, so entropy matters more than readability (a bare `${base}_${env}` could
// clash with a hand-named config).
function newFlavorKey(baseKey: string, env: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${baseKey}_${env}_${rand}`;
}

// The environment-selector tab group atop the config value editor. "All
// environments" is the base config; each additional tab is a flavor (a child
// config selected for an env/project scope via the base's scopedOverrides). A
// flavor is a first-class config with its own revisions/approvals, so selecting
// a tab navigates to that config; the active tab is derived from the URL config.
// The group renders identically on the base and on any flavor — it locates the
// base in the lineage (self, or the parent that lists the open flavor).
export default function ConfigEnvTabs({
  currentKey,
  currentConfigId,
  lineage,
  configNames,
  archivedByKey,
  canCreate,
  mutate,
}: Props) {
  const router = useRouter();
  const { apiCall } = useAuth();
  const { mutateDefinitions } = useDefinitions();
  const environments = useEnvironments();

  // If the open config is a flavor, the base is the parent that lists it —
  // discovered from the lineage, with the config's own scopedConfig marker as
  // the fallback (a flavor attached without `parent` isn't in the base's spine).
  const flavorParent = useMemo(
    () =>
      lineage.find((n) =>
        (n.scopedOverrides ?? []).some((o) => o.config === currentKey),
      ),
    [lineage, currentKey],
  );
  const currentNode = useMemo(
    () => lineage.find((n) => n.key === currentKey),
    [lineage, currentKey],
  );
  const isFlavor = !!flavorParent || !!currentNode?.scopedConfig;
  const baseKey =
    flavorParent?.key ?? currentNode?.scopedConfig?.parent ?? currentKey;
  const baseNode = useMemo(
    () => lineage.find((n) => n.key === baseKey),
    [lineage, baseKey],
  );
  // Skip entries whose flavor config no longer exists (e.g. deleted out of band)
  // so a dangling reference can't render a dead tab. `configNames` is the full
  // set of live configs; when absent (not loaded) don't filter.
  const overrides = useMemo(() => {
    const all = baseNode?.scopedOverrides ?? [];
    if (!configNames) return all;
    return all.filter((o) => configNames[o.config] !== undefined);
  }, [baseNode, configNames]);
  const nameFor = (key: string) => configNames?.[key] ?? key;

  const [createOpen, setCreateOpen] = useState(false);
  const [createEnv, setCreateEnv] = useState("");

  const usedEnvs = useMemo(() => {
    const s = new Set<string>();
    for (const o of overrides) for (const e of o.environments ?? []) s.add(e);
    return s;
  }, [overrides]);
  const availableEnvs = environments.filter((e) => !usedEnvs.has(e.id));

  const tabs = [
    { key: baseKey, label: "All Environments" },
    ...overrides.map((o) => ({ key: o.config, label: scopeLabel(o) })),
  ];

  const createOverride = async () => {
    if (!createEnv || !availableEnvs.some((e) => e.id === createEnv)) {
      throw new Error("Select an environment");
    }
    const flavorKey = newFlavorKey(baseKey, createEnv);
    // Create the flavor (empty patch), then attach it to the base's selection
    // list — an immediate write (not revision-controlled) so the tab appears
    // everywhere; the flavor's value edits go through its own review.
    await apiCall(`/configs`, {
      method: "POST",
      body: JSON.stringify({
        key: flavorKey,
        name: `${nameFor(baseKey)} (${createEnv})`,
        parent: baseKey,
        value: "{}",
      }),
    });
    await apiCall(`/configs/${currentConfigId}/scoped-overrides`, {
      method: "PUT",
      body: JSON.stringify({
        scopedOverrides: [
          ...overrides,
          { config: flavorKey, environments: [createEnv] },
        ],
      }),
    });
    await mutate();
    await mutateDefinitions();
    setCreateOpen(false);
    await router.push(`/configs/${flavorKey}`);
  };

  const showCreate = canCreate && !isFlavor && availableEnvs.length > 0;
  if (overrides.length === 0 && !showCreate) return null;

  return (
    <>
      <Box mb="5">
        <Tabs
          value={currentKey}
          onValueChange={(v) => {
            if (v !== currentKey) router.push(`/configs/${v}`);
          }}
        >
          <TabsList>
            {tabs.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>
                {archivedByKey?.[t.key] ? (
                  <Tooltip content="Archived — this override no longer serves a value">
                    <span style={{ textDecoration: "line-through" }}>
                      {t.label}
                    </span>
                  </Tooltip>
                ) : (
                  t.label
                )}
              </TabsTrigger>
            ))}
            {showCreate && (
              <Flex
                align="center"
                ml="auto"
                pl="4"
                onKeyDown={(e) => e.stopPropagation()}
              >
                <Button
                  variant="ghost"
                  onClick={() => {
                    setCreateEnv("");
                    setCreateOpen(true);
                  }}
                >
                  <PiPlus /> Environment override
                </Button>
              </Flex>
            )}
          </TabsList>
        </Tabs>
      </Box>

      {createOpen && (
        <ModalStandard
          open={true}
          trackingEventModalType="config-env-override"
          header="New environment override"
          cta="Create"
          close={() => setCreateOpen(false)}
          submit={createOverride}
        >
          <Text as="p" color="text-low" mb="3">
            Creates a version of <strong>{nameFor(baseKey)}</strong> that
            overrides the base value in the selected environment only.
          </Text>
          <SelectField
            label="Environment"
            value={createEnv}
            onChange={setCreateEnv}
            options={availableEnvs.map((e) => ({ value: e.id, label: e.id }))}
            placeholder="Select an environment…"
          />
        </ModalStandard>
      )}
    </>
  );
}
