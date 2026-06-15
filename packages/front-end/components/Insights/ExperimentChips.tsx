import { FC } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

/**
 * Labeled list of experiment links, used for the "Supporting experiments"
 * and "Contrary evidence" sections of insight cards. Falls back to the raw
 * id when an experiment isn't in the map (e.g. archived or unreadable).
 */
const ExperimentChips: FC<{
  label: string;
  experimentIds: string[];
  experimentMap: Map<string, ExperimentInterfaceStringDates>;
  /** "contrary" renders red chips */
  variant?: "supporting" | "contrary";
}> = ({ label, experimentIds, experimentMap, variant = "supporting" }) => {
  if (!experimentIds.length) return null;
  const contrary = variant === "contrary";
  return (
    <Box>
      <Box mb="1">
        <Text size="small" weight="semibold" color="text-mid" as="div">
          {label} ({experimentIds.length})
        </Text>
      </Box>
      <Flex gap="2" wrap="wrap">
        {experimentIds.map((id) => {
          const exp = experimentMap.get(id);
          return (
            <Link
              key={id}
              href={`/experiment/${id}`}
              style={{
                fontSize: 13,
                padding: "2px 8px",
                border: contrary
                  ? "1px solid var(--red-a5)"
                  : "1px solid var(--gray-a5)",
                borderRadius: 4,
                ...(contrary ? { color: "var(--red-11)" } : {}),
              }}
            >
              {exp?.name || id}
            </Link>
          );
        })}
      </Flex>
    </Box>
  );
};

export default ExperimentChips;
