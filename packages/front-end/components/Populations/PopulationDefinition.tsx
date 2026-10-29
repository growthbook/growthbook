import { Box, Flex, Grid, Separator } from "@radix-ui/themes";
import { date, datetime } from "shared/dates";
import type { ApiPopulation } from "shared/validators";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { useDefinitions } from "@/services/DefinitionsContext";
import { describePopulationStep } from "@/components/Populations/populationUtils";

export default function PopulationDefinition({
  population,
}: {
  population: ApiPopulation;
}) {
  const { getFactTableById } = useDefinitions();
  // TODO: Support multiple steps. Only the first step is shown for now.
  const step = population.steps[0];
  const factTable = step ? getFactTableById(step.source.factTableId) : null;
  const descriptionSegments = step
    ? describePopulationStep({
        step,
        identifierTypes: population.userIdTypes,
        factTable,
      })
    : null;

  return (
    <Box>
      <Flex justify="between" align="center" mb="3">
        <Heading as="h2" size="md">
          Definition
        </Heading>
      </Flex>

      {descriptionSegments && (
        <Box mb="4">
          <Text size="sm" overflowWrap="anywhere">
            {descriptionSegments.map((segment, i) =>
              typeof segment === "string" ? (
                segment
              ) : (
                <Link key={i} href={segment.href}>
                  {segment.label}
                </Link>
              ),
            )}
          </Text>
        </Box>
      )}

      <Separator size="4" mb="3" />
      <Grid columns="auto 1fr" gapX="4" gapY="2">
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
