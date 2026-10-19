import { Box, Flex, Grid } from "@radix-ui/themes";
import { date, datetime } from "shared/dates";
import type { ApiPopulation } from "shared/validators";
import { describePopulationStep } from "shared/populations";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { useDefinitions } from "@/services/DefinitionsContext";

export default function PopulationDefinition({
  population,
}: {
  population: ApiPopulation;
}) {
  const { getFactTableById } = useDefinitions();
  // TODO: Support multiple steps. Only the first step is shown for now.
  const step = population.steps[0];
  const factTableId = step?.source.factTableId;
  const factTable = factTableId ? getFactTableById(factTableId) : null;
  const factTableName = factTable?.name || factTableId || "";
  const description = step
    ? describePopulationStep({
        steps: [step],
        index: 0,
        factTableName,
        aggregateColumnName: factTable?.columns.find(
          (c) => c.column === step.aggregateFilterColumn,
        )?.name,
        unit: population.userIdTypes.join(", "),
      })
    : null;

  return (
    <Box>
      <Flex justify="between" align="center" mb="3">
        <Heading as="h2" size="md">
          Definition
        </Heading>
      </Flex>

      {description && (
        <Box mb="4">
          <Text size="sm">
            {description.before}
            {factTable ? (
              <Link href={`/fact-tables/${factTableId}`}>{factTableName}</Link>
            ) : (
              factTableName
            )}
            {description.after}
          </Text>
        </Box>
      )}

      <Grid
        columns="auto 1fr"
        gapX="4"
        gapY="2"
        pt="3"
        style={{ borderTop: "1px solid var(--gray-a5)" }}
      >
        <Text size="sm" color="text-mid">
          Created
        </Text>
        <Text size="sm" title={datetime(population.dateCreated)}>
          {date(population.dateCreated)}
        </Text>
        <Text size="sm" color="text-mid">
          Last updated
        </Text>
        <Text size="sm" title={datetime(population.dateUpdated)}>
          {date(population.dateUpdated)}
        </Text>
      </Grid>
    </Box>
  );
}
