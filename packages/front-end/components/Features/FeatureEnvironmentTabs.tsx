import { FeatureInterface } from "shared/types/feature";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PiFunnel, PiMagnifyingGlass } from "react-icons/pi";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { HoldoutInterface } from "shared/validators";
import { Environment } from "shared/types/organization";
import { Box, Flex, TextField } from "@radix-ui/themes";
import {
  getRules,
  isRuleInactive,
  FEATURE_RULES_ALL_ENVS,
} from "@/services/features";
import { isHoldoutEnabledAnyEnv } from "@/hooks/useHoldouts";
import Switch from "@/ui/Switch";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";

// The environment tab bar shared by the Default Value and Rules sections. The
// selected env (null = "All environments") is owned by the parent so both
// sections stay in sync — `useLocalStorage` is not reactive across instances,
// so the state can only live in one place. Rule counts and the "More" filter
// menu (inactive/orphaned toggles + tab overflow) are computed here.
export default function FeatureEnvironmentTabs({
  environments,
  feature,
  baseFeature,
  holdout,
  experimentsMap,
  value,
  setValue,
  hideInactive,
  setHideInactive,
  showOrphaned,
  setShowOrphaned,
}: {
  environments: Environment[];
  feature: FeatureInterface;
  baseFeature: FeatureInterface;
  holdout: HoldoutInterface | undefined;
  experimentsMap: Map<string, ExperimentInterfaceStringDates>;
  // null = "All environments" view. Already normalized by the parent.
  value: string | null;
  setValue: (v: string | null) => void;
  hideInactive: boolean;
  setHideInactive: (v: boolean) => void;
  showOrphaned: boolean;
  setShowOrphaned: (v: boolean) => void;
}) {
  const env = value;
  const envs = environments.map((e) => e.id);

  const hasInactiveRules = (feature.rules ?? []).some((r) =>
    isRuleInactive(r, experimentsMap),
  );

  // Orphaned: non-empty `environments` list referencing only deleted envs.
  const hasOrphanedRules = useMemo(() => {
    const knownEnvIds = new Set(environments.map((e) => e.id));
    return (feature.rules ?? []).some(
      (r) =>
        r &&
        !r.allEnvironments &&
        Array.isArray(r.environments) &&
        r.environments.length > 0 &&
        r.environments.every((e) => !knownEnvIds.has(e)),
    );
  }, [feature.rules, environments]);

  const rulesByEnv = Object.fromEntries(
    environments.map((e) => [e.id, getRules(feature, e.id)]),
  );

  // Show holdout in All-Envs whenever it's enabled in any of the org's envs.
  const holdoutEnabledAnyEnv = isHoldoutEnabledAnyEnv(holdout, envs);
  const liveHoldoutActiveAnyEnv = !!feature.holdout?.id && holdoutEnabledAnyEnv;
  const draftDeletesHoldoutAnyEnv =
    !feature.holdout?.id && !!baseFeature.holdout?.id && holdoutEnabledAnyEnv;
  const includeHoldoutRuleAllEnvs =
    liveHoldoutActiveAnyEnv || draftDeletesHoldoutAnyEnv;

  const countForEnv = (id: string) =>
    holdout?.environmentSettings?.[id]?.enabled
      ? rulesByEnv[id].length + 1
      : rulesByEnv[id].length;
  const allEnvsCount =
    (feature.rules?.length ?? 0) + (includeHoldoutRuleAllEnvs ? 1 : 0);

  // Tab overflow: cache each trigger's natural width once, then compute
  // cumulative-width overflow against the tabs-bar. Caching avoids the
  // hide-then-remeasure oscillation.
  const tabsBarRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const widthsRef = useRef<Map<string, number>>(new Map());
  const [containerWidth, setContainerWidth] = useState(0);
  const [measureTick, setMeasureTick] = useState(0);
  const setTriggerRef = useCallback(
    (key: string) => (el: HTMLButtonElement | null) => {
      if (!el) {
        triggerRefs.current.delete(key);
        return;
      }
      triggerRefs.current.set(key, el);
      if (!widthsRef.current.has(key)) {
        const w = el.getBoundingClientRect().width;
        if (w > 0) {
          widthsRef.current.set(key, w);
          setMeasureTick((n) => n + 1);
        }
      }
    },
    [],
  );
  const tabKeysSig = [FEATURE_RULES_ALL_ENVS, ...envs].join("|");

  // Drop cached widths for tabs that no longer exist.
  useEffect(() => {
    const valid = new Set([FEATURE_RULES_ALL_ENVS, ...envs]);
    let changed = false;
    for (const key of widthsRef.current.keys()) {
      if (!valid.has(key)) {
        widthsRef.current.delete(key);
        changed = true;
      }
    }
    if (changed) setMeasureTick((n) => n + 1);
  }, [tabKeysSig, envs]);

  useEffect(() => {
    const root = tabsBarRef.current;
    if (!root) return;
    setContainerWidth(root.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  const computeOverflow = (order: string[]): Set<string> => {
    const out = new Set<string>();
    if (containerWidth <= 0 || widthsRef.current.size === 0) return out;
    let cumulative = 0;
    for (const key of order) {
      const w = widthsRef.current.get(key);
      if (w == null) continue;
      cumulative += w;
      if (cumulative > containerWidth) out.add(key);
    }
    return out;
  };

  // If the active env would clip into overflow, hoist it to position 2 so
  // the current view stays visible.
  const baseOrder = [FEATURE_RULES_ALL_ENVS, ...envs];
  const naturalOverflow = computeOverflow(baseOrder);
  const renderOrder =
    env && naturalOverflow.has(env)
      ? [FEATURE_RULES_ALL_ENVS, env, ...envs.filter((e) => e !== env)]
      : baseOrder;
  const overflowKeys = computeOverflow(renderOrder);
  void measureTick; // re-render dep so overflow recomputes when widths cache

  const envById = new Map(environments.map((e) => [e.id, e]));
  const orderedEnvIds = renderOrder.filter((k) => k !== FEATURE_RULES_ALL_ENVS);
  const overflowLabels: Array<{ key: string; label: string; count: number }> =
    [];
  for (const key of renderOrder) {
    if (!overflowKeys.has(key)) continue;
    if (key === FEATURE_RULES_ALL_ENVS) {
      overflowLabels.push({
        key,
        label: "All Environments",
        count: allEnvsCount,
      });
      continue;
    }
    const e = envById.get(key);
    if (!e) continue;
    overflowLabels.push({ key: e.id, label: e.id, count: countForEnv(e.id) });
  }

  const [moreOpen, setMoreOpen] = useState(false);
  const [overflowSearch, setOverflowSearch] = useState("");
  useEffect(() => {
    if (!moreOpen) setOverflowSearch("");
  }, [moreOpen]);
  const showOverflowSearch = overflowLabels.length >= 5;
  const filteredOverflowLabels = showOverflowSearch
    ? overflowLabels.filter((l) =>
        l.label.toLowerCase().includes(overflowSearch.trim().toLowerCase()),
      )
    : overflowLabels;

  return (
    <Tabs
      value={env ?? FEATURE_RULES_ALL_ENVS}
      onValueChange={(v) => setValue(v === FEATURE_RULES_ALL_ENVS ? null : v)}
      mb="3"
    >
      <Flex
        align="center"
        justify="between"
        style={{
          boxShadow: "inset 0 -1px 0 0 var(--slate-a3)",
          position: "relative",
        }}
      >
        <Box
          ref={tabsBarRef}
          style={{
            flex: 1,
            minWidth: 0,
          }}
        >
          <TabsList style={{ boxShadow: "none", flexWrap: "nowrap" }}>
            <TabsTrigger
              value={FEATURE_RULES_ALL_ENVS}
              ref={setTriggerRef(FEATURE_RULES_ALL_ENVS)}
              style={
                overflowKeys.has(FEATURE_RULES_ALL_ENVS)
                  ? { display: "none" }
                  : undefined
              }
            >
              <Flex align="center" gap="2">
                All Environments
                <Badge
                  label={String(allEnvsCount)}
                  radius="full"
                  variant="soft"
                  color="gray"
                  size="sm"
                  style={{ marginRight: -4 }}
                />
              </Flex>
            </TabsTrigger>
            {orderedEnvIds.map((id) => {
              const e = envById.get(id);
              if (!e) return null;
              return (
                <TabsTrigger
                  key={e.id}
                  value={e.id}
                  ref={setTriggerRef(e.id)}
                  style={
                    overflowKeys.has(e.id) ? { display: "none" } : undefined
                  }
                >
                  <Flex align="center" gap="2">
                    {e.id}
                    <Badge
                      label={String(countForEnv(e.id))}
                      radius="full"
                      variant="soft"
                      color="gray"
                      size="sm"
                      style={{ marginRight: -4 }}
                    />
                  </Flex>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Box>
        <Box
          style={{
            flexShrink: 0,
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            paddingLeft: 8,
          }}
        >
          <DropdownMenu
            menuPlacement="end"
            color="violet"
            variant="soft"
            open={moreOpen}
            onOpenChange={setMoreOpen}
            trigger={
              <Button
                variant="ghost"
                color="violet"
                icon={<PiFunnel />}
                iconPosition="left"
              >
                {overflowLabels.length > 0
                  ? `More (${overflowLabels.length})`
                  : "More"}
              </Button>
            }
          >
            <Box px="3">
              <Flex align="center" gap="2" justify="end" py="2">
                <Text size="small" color="text-low">
                  Show inactive rules
                </Text>
                <Switch
                  size="1"
                  value={!hasInactiveRules ? false : !hideInactive}
                  onChange={(v) => setHideInactive(!v)}
                  disabled={!hasInactiveRules}
                />
              </Flex>
              {env === null && hasOrphanedRules && (
                <Flex align="center" gap="2" justify="end" py="2">
                  <Text size="small" color="text-low">
                    Show missing environment rules
                  </Text>
                  <Switch
                    size="1"
                    value={showOrphaned}
                    onChange={(v) => setShowOrphaned(v)}
                  />
                </Flex>
              )}
            </Box>
            {overflowLabels.length > 0 && <DropdownMenuSeparator />}
            {showOverflowSearch && (
              <Box px="3" pt="1" pb="2">
                <TextField.Root
                  size="2"
                  placeholder="Search..."
                  value={overflowSearch}
                  onChange={(e) => setOverflowSearch(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                >
                  <TextField.Slot>
                    <PiMagnifyingGlass />
                  </TextField.Slot>
                </TextField.Root>
              </Box>
            )}
            {filteredOverflowLabels.map(({ key, label, count }) => (
              <DropdownMenuItem
                key={key}
                onClick={() =>
                  setValue(key === FEATURE_RULES_ALL_ENVS ? null : key)
                }
              >
                <Flex align="center" justify="between" gap="3" width="100%">
                  <span>{label}</span>
                  <Badge
                    label={String(count)}
                    radius="full"
                    variant="soft"
                    color="gray"
                    size="sm"
                  />
                </Flex>
              </DropdownMenuItem>
            ))}
            {showOverflowSearch && filteredOverflowLabels.length === 0 && (
              <Box px="3" py="2">
                <Text size="small" color="text-low">
                  No matches
                </Text>
              </Box>
            )}
          </DropdownMenu>
        </Box>
      </Flex>
    </Tabs>
  );
}
