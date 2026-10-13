import { Box, Flex, Grid } from "@radix-ui/themes";
import { date, datetime } from "shared/dates";
import type { ApiPopulation } from "shared/validators";
import { describePopulationStep } from "shared/populations";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Owner from "@/components/Avatar/Owner";
import { useDefinitions } from "@/services/DefinitionsContext";

export default function PopulationDefinition({
  population,
  editHref,
}: {
  population: ApiPopulation;
  editHref: string | null;
}) {
  const { getFactTableById } = useDefinitions();
  const unit = population.userIdTypes.join(", ");

  return (
    <Box>
      <Flex justify="between" align="center" mb="3">
        <Heading as="h2" size="md">
          Definition
        </Heading>
        {editHref && <Link href={editHref}>Edit</Link>}
      </Flex>

      <Box asChild mb="4" pl="4">
        <ol style={{ margin: 0 }}>
          {population.steps.map((step, i) => {
            const factTable = getFactTableById(step.source.factTableId);
            return (
              <li key={i}>
                <Text size="sm">
                  {describePopulationStep({
                    steps: population.steps,
                    index: i,
                    factTableName: factTable?.name || step.source.factTableId,
                    aggregateColumnName: factTable?.columns.find(
                      (c) => c.column === step.aggregateFilterColumn,
                    )?.name,
                    unit,
                  })}
                </Text>
              </li>
            );
          })}
        </ol>
      </Box>

      <Grid
        columns="auto 1fr"
        gapX="4"
        gapY="2"
        pt="3"
        style={{ borderTop: "1px solid var(--gray-a5)" }}
      >
        <Text size="sm" color="text-mid">
          Owner
        </Text>
        <Box>
          <Owner ownerId={population.owner} />
        </Box>
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
