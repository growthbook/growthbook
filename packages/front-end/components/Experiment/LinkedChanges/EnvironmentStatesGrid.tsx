import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
import {
  PiCaretDown,
  PiCaretRight,
  PiCheckCircleFill,
  PiWarningFill,
} from "react-icons/pi";
import { useState } from "react";
import Tooltip from "@/components/Tooltip/Tooltip";
import Text from "@/ui/Text";

type EnvironmentState = {
  env: string;
  state: string;
  isActive: boolean;
  tooltip: string;
};

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
      <Flex align="center">
        <Text color="text-low" weight="semibold" size="medium">
          Environments
        </Text>
        <Text color="text-low" size="medium" ml="1">
          ({activeCount}/{totalCount})
        </Text>
        <IconButton
          type="button"
          radius="full"
          ml="2"
          variant="ghost"
          onClick={() => setEnvironmentsOpen((prev) => !prev)}
        >
          {environmentsOpen ? <PiCaretDown /> : <PiCaretRight />}
        </IconButton>
      </Flex>
      {environmentsOpen && (
        <Grid
          mt="3"
          gap="2"
          gapX="9"
          justify="between"
          flow="column"
          rows={totalCount >= 5 ? "5" : totalCount.toString()}
          display="inline-grid"
        >
          {environmentStates.map(({ env, isActive, tooltip }) => (
            <Box key={env}>
              <Tooltip body={tooltip}>
                <Flex gap="2" align="center" style={{ minWidth: 0 }}>
                  <Box
                    flexShrink="0"
                    style={{
                      color: isActive ? "var(--green-11)" : "var(--amber-11)",
                    }}
                  >
                    {isActive ? <PiCheckCircleFill /> : <PiWarningFill />}
                  </Box>
                  <Box className="text-ellipsis" title={env}>
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
