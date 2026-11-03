import { Box, Flex, Grid } from "@radix-ui/themes";
import {
  LinkedChangeEnvStates,
  LinkedFeatureEnvInputs,
  LinkedFeatureEnvState,
} from "shared/types/experiment";
import type { ExperimentRuleEnvironments } from "shared/validators";
import { PiArrowRight, PiCaretDown, PiCaretRight } from "react-icons/pi";
import { Fragment, ReactNode, useState } from "react";
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
type FeatureEnvironmentState = {
  env: string;
  state: LinkedFeatureEnvState;
  isActive: boolean;
};

export function getEnvironmentStates(source: {
  environmentStates?: Record<string, LinkedFeatureEnvState>;
}): FeatureEnvironmentState[] {
  return Object.entries(source.environmentStates || {}).map(([env, state]) => ({
    env,
    state,
    isActive: state === "active",
  }));
}

const inScope = (scope: ExperimentRuleEnvironments, env: string) =>
  scope.allEnvironments || scope.environments.includes(env);

// The rule's settings under a staged scope: entering switches the environment on.
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

/**
 * A scope as the environments modal edits it. `allEnvironments` is the stored
 * rule's; only when it's unknown does covering every environment read as all.
 */
export function scopeFromStates(
  states: Record<string, LinkedFeatureEnvState>,
  orgEnvironments: string[],
  allEnvironments: boolean | null = null,
): ExperimentRuleEnvironments {
  const covered = Object.entries(states)
    .filter(([, state]) => state !== "missing")
    .map(([env]) => env);
  return (allEnvironments ?? orgEnvironments.every((e) => covered.includes(e)))
    ? { allEnvironments: true, environments: [] }
    : { allEnvironments: false, environments: covered };
}

/** Whether two scopes are the same setting, ignoring environment order. */
export function sameScope(
  a: ExperimentRuleEnvironments,
  b: ExperimentRuleEnvironments,
): boolean {
  if (a.allEnvironments || b.allEnvironments) {
    return a.allEnvironments === b.allEnvironments;
  }
  return (
    a.environments.length === b.environments.length &&
    a.environments.every((e) => b.environments.includes(e))
  );
}

const ENVIRONMENT_STATE_LABELS: Record<LinkedFeatureEnvState, string> = {
  active: "Active",
  "disabled-env": "Off",
  "disabled-rule": "Off",
  missing: "Not included",
};

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

// Between an environment's gates: it's active once it passes both.
function FlowArrow() {
  return (
    <Flex align="center" justify="center" aria-hidden>
      <PiArrowRight size={12} style={{ color: "var(--gray-8)" }} />
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
  onEdit = null,
}: {
  environmentStates: FeatureEnvironmentState[];
  environmentInputs?: Record<string, LinkedFeatureEnvInputs>;
  note?: string | null;
  onEdit?: (() => void) | null;
}) {
  return (
    <EnvironmentsPopover
      active={environmentStates.filter((e) => e.isActive).length}
      total={environmentStates.length}
      content={
        <Flex direction="column" gap="2" width="fit-content">
          <Grid
            columns="max-content 14px 12px 14px 12px max-content"
            gapX="3"
            gapY="2"
            align="center"
          >
            <Box />
            <Flex justify="center">
              <Text size="sm" color="text-low">
                Flag
              </Text>
            </Flex>
            <Box />
            <Flex justify="center">
              <Text size="sm" color="text-low">
                Rule
              </Text>
            </Flex>
            <Box />
            <Box />
            {environmentStates.map(({ env, state, isActive }) => {
              const input = environmentInputs?.[env];
              return (
                <Fragment key={env}>
                  <EnvironmentName env={env} isActive={isActive} />
                  <EnvironmentSetting
                    value={input ? input.flagEnabled : null}
                  />
                  <FlowArrow />
                  <EnvironmentSetting
                    value={input ? input.rule === "on" : null}
                  />
                  <FlowArrow />
                  <Flex align="center" gap="1">
                    <EnvironmentStateIcon isActive={isActive} />
                    <Text size="sm" weight="medium">
                      {ENVIRONMENT_STATE_LABELS[state]}
                    </Text>
                  </Flex>
                </Fragment>
              );
            })}
          </Grid>
          {note ? (
            <Box width="0" minWidth="100%">
              <Text as="div" size="sm">
                {note}
              </Text>
            </Box>
          ) : null}
          {onEdit ? (
            <Text size="sm">
              <Link underline="hover" onClick={onEdit}>
                Edit environments
              </Link>
            </Text>
          ) : null}
        </Flex>
      }
    />
  );
}

// "Environments n/m", opening on hover to `content`.
function EnvironmentsPopover({
  active,
  total,
  content,
}: {
  active: number;
  total: number;
  content: ReactNode;
}) {
  return (
    <Popover
      openOnHover
      side="bottom"
      align="start"
      avoidCollisions={false}
      trigger={
        <span
          style={{
            cursor: "default",
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-1)",
            flexShrink: 0,
          }}
        >
          <Text size="sm" color="text-low" whiteSpace="nowrap">
            Environments {active}/{total}
          </Text>
        </span>
      }
      content={content}
    />
  );
}

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
    <EnvironmentsPopover
      active={active}
      total={entries.length}
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
