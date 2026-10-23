import { Flex } from "@radix-ui/themes";
import { PiChartBar } from "react-icons/pi";
import Text from "@/ui/Text";
import styles from "./PreviewEmptyState.module.scss";

// Relative heights of the placeholder bars, as a percent of the tallest.
const PLACEHOLDER_BARS = [62, 68, 54, 75, 83, 46, 100];

// Shown in place of a preview chart before the first run.
export default function PreviewEmptyState({
  description,
}: {
  description: string;
}) {
  return (
    <Flex direction="column" align="center" gap="3" pb="2">
      <div className={styles.placeholderBars} aria-hidden="true">
        {PLACEHOLDER_BARS.map((height, i) => (
          <span key={i} style={{ height: `${height}%` }} />
        ))}
      </div>
      <span className={styles.emptyIcon} aria-hidden="true">
        <PiChartBar size={20} />
      </span>
      <Text size="lg" weight="semibold" align="center">
        Preview will appear here
      </Text>
      <Text color="text-mid" align="center">
        {description}
      </Text>
    </Flex>
  );
}
