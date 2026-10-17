import { Box, Flex, Grid } from "@radix-ui/themes";
import {
  LinkedChangeEnvStates,
  LinkedFeatureEnvInputs,
  LinkedFeatureEnvState,
} from "shared/types/experiment";
import type {
  ExperimentRuleEnvironments,
  ExperimentStatus,
} from "shared/validators";
import { PiCaretDown, PiCaretRight } from "react-icons/pi";
import { forwardRef, Fragment, HTMLAttributes, useState } from "react";
import {
  FaCircleCheck,
  FaCircleXmark,
  FaRegCircleCheck,
  FaRegCircleXmark,
} from "react-icons/fa6";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { Popover } from "@/ui/Popover";
import Tooltip from "@/ui/Tooltip";
import Text from "@/ui/Text";
import Link from "@/ui/Link";

type EnvironmentState = {
  env: string;
  state: string;
  isActive: boolean;
  tooltip: string;
};

// The flag's environment toggle AND the rule's presence and enablement.
type FeatureEnvironmentState = EnvironmentState & {
  state: LinkedFeatureEnvState;
};

// Why a state is not yet true: not started, or shown from an unpublished
// draft. false: a running experiment's live states. "rule" and
// "rule-published": the rule as it stands or will once published, for an
// experiment that publishing alone won't make active.
type EnvironmentStateTense =
  | false
  | "started"
  | "published"
  | "rule"
  | "rule-published";

/** How a flag's environment states read, from what they show. */
export function environmentStateTense({
  status,
  unpublished,
  launches,
  liveView,
}: {
  status: ExperimentStatus;
  // A draft's states, or an unsaved scope over them.
  unpublished: boolean;
  // Shows the draft a draft experiment publishes when it starts.
  launches: boolean;
  liveView: boolean;
}): EnvironmentStateTense {
  if (unpublished) {
    if (status === "running") return "published";
    return status === "draft" && launches ? "started" : "rule-published";
  }
  if (status === "running") return false;
  // Unless a draft changes them, starting keeps live's.
  return status === "draft" && !liveView ? "started" : "rule";
}

function environmentStateTooltip(
  state: LinkedFeatureEnvState,
  future: EnvironmentStateTense,
): string {
  const once = future === "started" ? " once started" : " once published";
  if (future === "rule" || future === "rule-published") {
    const pending = future === "rule-published";
    switch (state) {
      case "active":
        return pending
          ? "The experiment's rule will be on in this environment once published"
          : "The experiment's rule is on in this environment";
      case "disabled-env":
        return pending
          ? "The Feature Flag will be disabled in this environment once published, so the experiment's rule won't apply"
          : "The Feature Flag is disabled in this environment, so the experiment's rule doesn't apply";
      case "disabled-rule":
        return pending
          ? "The experiment's rule will be off in this environment once published"
          : "The experiment's rule is off in this environment";
      case "missing":
        return pending
          ? "The experiment won't be in this environment once published"
          : "The experiment isn't in this environment";
    }
  }
  switch (state) {
    case "active":
      return future
        ? `The experiment will be active in this environment${once}`
        : "The experiment is active in this environment";
    case "disabled-env":
      return future
        ? `The Feature Flag is disabled in this environment, so the experiment won't be active here${once}`
        : "The Feature Flag is disabled in this environment, so the experiment isn't active here";
    case "disabled-rule":
      return future
        ? `The experiment is disabled in this environment and won't be active${once}`
        : "The experiment is disabled in this environment and isn't active";
    case "missing":
      return future
        ? `The experiment won't be in this environment${once}`
        : "The experiment isn't in this environment";
    default: {
      const _exhaustiveCheck: never = state;
      return _exhaustiveCheck;
    }
  }
}

export function getEnvironmentStates(
  source: {
    environmentStates?: Record<string, LinkedFeatureEnvState>;
  },
  { future = false }: { future?: EnvironmentStateTense } = {},
): FeatureEnvironmentState[] {
  return Object.entries(source.environmentStates || {}).map(([env, state]) => ({
    env,
    state,
    isActive: state === "active",
    tooltip: environmentStateTooltip(state, future),
  }));
}

const inScope = (scope: ExperimentRuleEnvironments, env: string) =>
  scope.allEnvironments || scope.environments.includes(env);

/** What the rule's settings become under a staged scope: entering switches the environment on. */
export function stageEnvironmentInputs(
  inputs: Record<string, LinkedFeatureEnvInputs>,
  scope: ExperimentRuleEnvironments | null,
): Record<string, LinkedFeatureEnvInputs> {
  if (!scope) return inputs;
  return Object.fromEntries(
    Object.entries(inputs).map(([env, input]) => [
      env,
      inScope(scope, env)
        ? {
            flagEnabled: true,
            rule: input.rule === "missing" ? "on" : input.rule,
          }
        : { ...input, rule: "missing" },
    ]),
  );
}

/** The states those settings add up to. */
export function statesFromInputs(
  inputs: Record<string, LinkedFeatureEnvInputs>,
): Record<string, LinkedFeatureEnvState> {
  return Object.fromEntries(
    Object.entries(inputs).map(([env, { flagEnabled, rule }]) => [
      env,
      rule === "missing"
        ? "missing"
        : !flagEnabled
          ? "disabled-env"
          : rule === "on"
            ? "active"
            : "disabled-rule",
    ]),
  );
}

/** A scope as the environments modal edits it. */
export function scopeFromStates(
  states: Record<string, LinkedFeatureEnvState>,
  orgEnvironments: string[],
): ExperimentRuleEnvironments {
  const covered = Object.entries(states)
    .filter(([, state]) => state !== "missing")
    .map(([env]) => env);
  return orgEnvironments.every((e) => covered.includes(e))
    ? { allEnvironments: true, environments: [] }
    : { allEnvironments: false, environments: covered };
}

const ENVIRONMENT_STATE_LABELS: Record<LinkedFeatureEnvState, string> = {
  active: "Active",
  "disabled-env": "Off",
  "disabled-rule": "Off",
  missing: "Not included",
};

/** Whether the experiment is active in an environment. */
function EnvironmentStateIcon({ isActive }: { isActive: boolean }) {
  return (
    <Box
      flexShrink="0"
      style={{
        display: "flex",
        color: isActive ? "var(--green-11)" : "var(--slate-9)",
      }}
    >
      {isActive ? <FaCircleCheck size={14} /> : <FaCircleXmark size={14} />}
    </Box>
  );
}

// The inline row: every environment with its state, wherever there is room to
// show them all at once.
export function EnvironmentStateChips({
  states,
}: {
  states: EnvironmentState[];
}) {
  return (
    <Flex gap="4" wrap="wrap">
      {states.map(({ env, isActive, tooltip }) => (
        <Tooltip key={env} content={tooltip} side="top">
          <Flex align="center" gap="1" minWidth="0">
            <EnvironmentStateIcon isActive={isActive} />
            <Text weight="medium">{env}</Text>
          </Flex>
        </Tooltip>
      ))}
    </Flex>
  );
}

type Props = {
  environmentStates: EnvironmentState[];
};

export default function EnvironmentStatesGrid({ environmentStates }: Props) {
  const [environmentsOpen, setEnvironmentsOpen] = useState(false);

  const totalCount = environmentStates.length;
  const activeCount = environmentStates.filter((e) => e.isActive).length;

  if (totalCount === 0) return null;

  return (
    <Box p="3" px="4">
      <Link color="dark" onClick={() => setEnvironmentsOpen((prev) => !prev)}>
        <Flex align="center">
          <Text color="text-low" weight="semibold" size="md">
            Environments
          </Text>
          <Text color="text-low" size="md" ml="1">
            ({activeCount}/{totalCount})
          </Text>
          <Box ml="2">
            {environmentsOpen ? <PiCaretDown /> : <PiCaretRight />}
          </Box>
        </Flex>
      </Link>
      {environmentsOpen && (
        <Grid
          mt="3"
          gapY="2"
          flow="column"
          rows={totalCount >= 5 ? "5" : totalCount.toString()}
          display="grid"
          width="100%"
          style={{ gridAutoColumns: "1fr" }}
        >
          {environmentStates.map(({ env, isActive, tooltip }) => (
            <Box key={env} minWidth="0">
              <Tooltip content={tooltip} side="top" maxWidth="300px">
                <Flex
                  gap="2"
                  align="center"
                  minWidth="0"
                  display="inline-flex"
                  maxWidth="100%"
                >
                  <EnvironmentStateIcon isActive={isActive} />
                  <Box className="text-ellipsis" title={env} minWidth="0">
                    <Text weight="medium">{env}</Text>
                  </Box>
                </Flex>
              </Tooltip>
            </Box>
          ))}
        </Grid>
      )}
    </Box>
  );
}

// One of an environment's two settings: on, off, or unknown (null).
function EnvironmentSetting({ value }: { value: boolean | null }) {
  return (
    <Flex align="center" justify="center">
      {value === null ? (
        <Text size="sm" color="text-low">
          —
        </Text>
      ) : (
        // Same marks as a feature rule's environment badges.
        <Box aria-label={value ? "On" : "Off"} style={{ display: "flex" }}>
          {value ? (
            <FaRegCircleCheck size={14} style={{ color: "var(--green-11)" }} />
          ) : (
            <FaRegCircleXmark size={14} style={{ color: "var(--gray-8)" }} />
          )}
        </Box>
      )}
    </Flex>
  );
}

function EnvironmentName({
  env,
  isActive,
}: {
  env: string;
  isActive: boolean;
}) {
  return (
    <span
      style={{
        color: isActive ? undefined : "var(--gray-8)",
        fontWeight: isActive ? 500 : 300,
      }}
    >
      {env}
    </span>
  );
}

/**
 * "Environments n/m", opening on hover to the settings behind each state: the
 * flag's environment toggle and the experiment rule's.
 */
export function EnvironmentInputsPopover({
  environmentStates,
  environmentInputs,
  note,
}: {
  environmentStates: FeatureEnvironmentState[];
  environmentInputs?: Record<string, LinkedFeatureEnvInputs>;
  note?: string | null;
}) {
  const active = environmentStates.filter((e) => e.isActive).length;
  return (
    <Popover
      openOnHover
      side="top"
      align="end"
      avoidCollisions={false}
      trigger={
        <EnvironmentsCount active={active} total={environmentStates.length} />
      }
      content={
        // The two settings get fixed columns so their marks line up.
        <Grid
          columns="max-content 40px 40px max-content"
          gapX="4"
          gapY="2"
          align="center"
        >
          <Box />
          <Flex justify="center">
            <Text size="sm" color="text-low">
              Flag
            </Text>
          </Flex>
          <Flex justify="center">
            <Text size="sm" color="text-low">
              Rule
            </Text>
          </Flex>
          <Box />
          {environmentStates.map(({ env, state, isActive }) => {
            const input = environmentInputs?.[env];
            return (
              <Fragment key={env}>
                <EnvironmentName env={env} isActive={isActive} />
                <EnvironmentSetting value={input ? input.flagEnabled : null} />
                {/* A rule that doesn't target the environment is off there too. */}
                <EnvironmentSetting
                  value={input ? input.rule === "on" : null}
                />
                <Flex align="center" gap="1">
                  <EnvironmentStateIcon isActive={isActive} />
                  <Text size="sm" weight="medium">
                    {ENVIRONMENT_STATE_LABELS[state]}
                  </Text>
                </Flex>
              </Fragment>
            );
          })}
          {note ? (
            <Box gridColumn="1 / -1" mt="1">
              <Text size="sm" color="text-low">
                {note}
              </Text>
            </Box>
          ) : null}
        </Grid>
      }
    />
  );
}

// The popover's trigger: it hands over its hover handlers and ref, so they
// land on the span.
const EnvironmentsCount = forwardRef<
  HTMLSpanElement,
  HTMLAttributes<HTMLSpanElement> & {
    active: number;
    total: number;
  }
>(function EnvironmentsCount({ active, total, ...props }, ref) {
  return (
    <span
      ref={ref}
      {...props}
      style={{
        cursor: "default",
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
      }}
    >
      <Text size="sm" color="text-low">
        Environments {active}/{total}
      </Text>
    </span>
  );
});

/**
 * "Environments n/m" for changes the SDK applies itself, opening on hover to
 * where each environment's state comes from: its SDK Connections.
 */
export function SdkConnectionEnvironmentsPopover({
  environmentStates,
  kind,
  project,
}: {
  environmentStates: LinkedChangeEnvStates;
  // As the SDK Connection's setting names it.
  kind: "Visual Editor" | "URL Redirect";
  // The experiment's, which decides who can manage its SDK Connections.
  project: string;
}) {
  const canManageSdkConnections =
    usePermissionsUtil().canViewCreateSDKConnectionModal(project);
  const entries = Object.entries(environmentStates);
  if (!entries.length) return null;
  const active = entries.filter(([, state]) => state === "active").length;
  return (
    <Popover
      openOnHover
      side="top"
      align="end"
      avoidCollisions={false}
      trigger={<EnvironmentsCount active={active} total={entries.length} />}
      content={
        <Flex direction="column" gap="3" style={{ maxWidth: 300 }}>
          <Text size="sm" color="text-mid">
            On where an SDK Connection in the environment includes this
            experiment&apos;s Project and has <strong>{kind}</strong>{" "}
            experiments enabled.
          </Text>
          <Grid
            columns="max-content max-content"
            gapX="4"
            gapY="2"
            align="center"
          >
            {entries.map(([env, state]) => {
              const isActive = state === "active";
              return (
                <Fragment key={env}>
                  <EnvironmentName env={env} isActive={isActive} />
                  <Flex align="center" gap="1">
                    <EnvironmentStateIcon isActive={isActive} />
                    <Text size="sm" weight="medium">
                      {isActive ? "On" : "No SDK Connection"}
                    </Text>
                  </Flex>
                </Fragment>
              );
            })}
          </Grid>
          {canManageSdkConnections ? (
            <Text size="sm">
              <Link href="/sdks" external>
                Manage SDK Connections
              </Link>
            </Text>
          ) : null}
        </Flex>
      }
    />
  );
}
