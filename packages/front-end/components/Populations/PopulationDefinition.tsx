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
            const factTableId = step.source.factTableId;
            const factTable = getFactTableById(factTableId);
            const factTableName = factTable?.name || factTableId;
            const sentence = describePopulationStep({
              steps: population.steps,
              index: i,
              factTableName,
              aggregateColumnName: factTable?.columns.find(
                (c) => c.column === step.aggregateFilterColumn,
              )?.name,
              unit,
            });
            const nameAt = sentence.indexOf(factTableName);
            return (
              <li key={i}>
                <Text size="sm">
                  {factTable && nameAt >= 0 ? (
                    <>
                      {sentence.slice(0, nameAt)}
                      <Link href={`/fact-tables/${factTableId}`}>
                        {factTableName}
                      </Link>
                      {sentence.slice(nameAt + factTableName.length)}
                    </>
                  ) : (
                    sentence
                  )}
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
