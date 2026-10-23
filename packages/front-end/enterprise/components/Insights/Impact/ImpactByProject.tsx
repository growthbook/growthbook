import { Box, Flex } from "@radix-ui/themes";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";

export type ProjectImpact = {
  id: string;
  name: string;
  value: number;
  filteredOut: boolean;
};

export default function ImpactByProject({
  projects,
  formatAnnual,
}: {
  projects: ProjectImpact[];
  formatAnnual: (v: number) => string;
}) {
  const max = Math.max(...projects.map((p) => Math.abs(p.value)), 0);
  return (
    <Box className="appbox" mb="0" p="4">
      <Heading as="h3" size="sm" mb="3">
        Impact by Project
      </Heading>
      {projects.length === 0 ? (
        <Text color="text-mid">No Project has a won or lost experiment.</Text>
      ) : (
        <Flex direction="column" gap="3">
          {projects.map((p) => (
            <Box key={p.id} style={{ opacity: p.filteredOut ? 0.4 : 1 }}>
              <Flex justify="between" mb="1">
                <Text size="sm" weight="medium">
                  {p.name}
                </Text>
                <Text size="sm" weight="semibold">
                  {p.filteredOut ? "filtered out" : formatAnnual(p.value)}
                </Text>
              </Flex>
              <Box
                style={{
                  height: 6,
                  borderRadius: 3,
                  background: "var(--gray-a3)",
                }}
              >
                {!p.filteredOut && max > 0 && (
                  <Box
                    style={{
                      height: "100%",
                      borderRadius: 3,
                      width: `${(Math.abs(p.value) / max) * 100}%`,
                      background:
                        p.value >= 0 ? "var(--violet-9)" : "var(--red-9)",
                    }}
                  />
                )}
              </Box>
            </Box>
          ))}
        </Flex>
      )}
      <Text as="p" size="sm" color="text-low" mt="3" mb="0">
        Impact is summed per Project from completed experiments with a shipped
        or rolled-back decision.
      </Text>
    </Box>
  );
}
