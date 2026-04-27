import { Box, Flex, Grid } from "@radix-ui/themes";
import {
  PiCaretDown,
  PiCaretRight,
  PiCheckCircleFill,
  PiWarningFill,
} from "react-icons/pi";
import { useState } from "react";
import Tooltip from "@/components/Tooltip/Tooltip";
import Text from "@/ui/Text";
import Link from "@/ui/Link";

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
      <Link color="dark" onClick={() => setEnvironmentsOpen((prev) => !prev)}>
        <Flex align="center">
          <Text color="text-low" weight="semibold" size="medium">
            Environments
          </Text>
          <Text color="text-low" size="medium" ml="1">
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
              <Tooltip
                body={tooltip}
                tipPosition="top"
                style={{
                  display: "block",
                  width: "fit-content",
                  maxWidth: "100%",
                }}
              >
                <Flex gap="2" align="center" minWidth="0">
                  <Box
                    flexShrink="0"
                    style={{
                      color: isActive ? "var(--green-11)" : "var(--amber-11)",
                    }}
                  >
                    {isActive ? <PiCheckCircleFill /> : <PiWarningFill />}
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
