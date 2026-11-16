import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDownBold } from "react-icons/pi";
import styles from "./TrafficAllocationFunnel.module.scss";

export default function FunnelConnector({ fill = false }: { fill?: boolean }) {
  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      height={fill ? "100%" : undefined}
    >
      <Box
        className={styles.connectorLine}
        height={fill ? undefined : "15px"}
        flexGrow={fill ? "1" : undefined}
      />
      <Box mt="-3" mb="-1" className={styles.caret}>
        <PiCaretDownBold size="11" />
      </Box>
    </Flex>
  );
}
