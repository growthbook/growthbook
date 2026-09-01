import { Box, Flex, Grid } from "@radix-ui/themes";
import { LinkedFeatureEnvState } from "shared/types/experiment";
import {
  PiCaretDown,
  PiCaretRight,
  PiCheckCircleFill,
  PiXCircleFill,
} from "react-icons/pi";
import { useState } from "react";
import Tooltip from "@/ui/Tooltip";
import Text from "@/ui/Text";
import Link from "@/ui/Link";

export type EnvironmentState = {
  env: string;
  state: string;
  isActive: boolean;
  tooltip: string;
};

// The flag's environment toggle AND the rule's presence and enablement.
// Shared so every surface explains a state with the same words.
// Why a state is not yet true: not started, or shown from an unpublished draft.
export type EnvironmentStateTense = false | "started" | "published";

function environmentStateTooltip(
  state: LinkedFeatureEnvState,
  future: EnvironmentStateTense,
): string {
  const once = future === "started" ? " once started" : " once published";
  switch (state) {
    case "active":
      return future
        ? `The experiment will be active in this environment${once}`
        : "The experiment is active in this environment";
    case "disabled-env":
      return future
        ? `The environment is disabled for this feature, so the experiment will not be active${once}`
        : "The environment is disabled for this feature, so the experiment is not active";
    case "disabled-rule":
      return future
        ? `The experiment is disabled in this environment and will not be active${once}`
        : "The experiment is disabled in this environment and is not active";
    case "missing":
      return "The experiment is not present in this environment";
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
): EnvironmentState[] {
  return Object.entries(source.environmentStates || {}).map(([env, state]) => ({
    env,
    state,
    isActive: state === "active",
    tooltip: environmentStateTooltip(state, future),
  }));
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
    <Box p="4" px="5">
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
                  <Box
                    flexShrink="0"
                    style={{
                      color: isActive ? "var(--green-11)" : "var(--slate-9)",
                    }}
                  >
                    {isActive ? <PiCheckCircleFill /> : <PiXCircleFill />}
                  </Box>
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
