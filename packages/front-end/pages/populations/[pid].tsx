import { useRouter } from "next/router";
import { date, datetime } from "shared/dates";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "shared/types/app-features";
import { PopulationStep } from "shared/validators";
import { FactTableDefinition, RowFilter } from "shared/types/fact-table";
import { getPopulationStepWindowLabel } from "shared/populations";
import { Box, Flex, Grid } from "@radix-ui/themes";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Link from "@/ui/Link";
import PageHead from "@/components/Layout/PageHead";
import LoadingOverlay from "@/components/LoadingOverlay";
import Owner from "@/components/Avatar/Owner";
import PopulationMoreMenu from "@/components/Populations/PopulationMoreMenu";
import PopulationSizePanel from "@/components/Populations/PopulationSizePanel";
import { operatorLabelMap } from "@/components/FactTables/rowFilterUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import { usePopulation } from "@/hooks/usePopulations";
import Custom404 from "@/pages/404";

export default function PopulationPage() {
  const router = useRouter();
  const pid = typeof router.query.pid === "string" ? router.query.pid : "";
  const gb = useGrowthBook<AppFeatures>();
  const { getDatasourceById } = useDefinitions();
  const { population, loading, error } = usePopulation(pid || undefined);

  if (!gb?.isOn("populations")) {
    return <Custom404 />;
  }
  if (error) {
    return (
      <Box className="pagecontents container-fluid">
        <Callout status="error">{error.message}</Callout>
      </Box>
    );
  }
  if (loading || !population) {
    return <LoadingOverlay />;
  }

  const numSteps = population.steps.length;

  return (
    <Box className="pagecontents container-fluid">
      <PageHead
        breadcrumb={[
          { display: "Populations", href: "/populations" },
          { display: population.name },
        ]}
      />

      <Flex justify="between" align="start" gap="3" mb="5">
        <Box>
          <Heading as="h1" size="xl" mb="2">
            {population.name}
          </Heading>
          <Flex align="center" gap="2" wrap="wrap">
            {population.userIdTypes.map((t) => (
              <Badge key={t} label={t} color="gray" variant="soft" />
            ))}
            <Badge
              label={`${numSteps} ${numSteps === 1 ? "step" : "steps"}`}
              color="gray"
              variant="soft"
            />
            <Text color="text-mid">
              {getDatasourceById(population.datasource)?.name ||
                population.datasource}
            </Text>
          </Flex>
          {population.description && (
            <Box mt="3">
              <Text color="text-mid">{population.description}</Text>
            </Box>
          )}
        </Box>
        <PopulationMoreMenu
          population={population}
          onDuplicated={(copy) => router.push(`/populations/${copy.id}`)}
          onDeleted={() => router.push("/populations")}
        />
      </Flex>

      <Grid columns={{ initial: "1", md: "3" }} gap="4">
        <Box gridColumn={{ initial: "1", md: "1 / 3" }}>
          <PopulationSizePanel population={population} />
        </Box>
        <Box>
          <Frame>
            <Heading as="h3" size="md" mb="3">
              Definition
            </Heading>
            <Flex direction="column" gap="3" mb="4">
              {population.steps.map((step, i) => (
                <PopulationStepSummary key={i} step={step} index={i} />
              ))}
            </Flex>
            <Flex direction="column" gap="2">
              <Flex justify="between" gap="3">
                <Text color="text-mid">Owner</Text>
                <Owner ownerId={population.owner} />
              </Flex>
              <Flex justify="between" gap="3">
                <Text color="text-mid">Created</Text>
                <Text title={datetime(population.dateCreated)}>
                  {date(population.dateCreated)}
                </Text>
              </Flex>
              <Flex justify="between" gap="3">
                <Text color="text-mid">Last Updated</Text>
                <Text title={datetime(population.dateUpdated)}>
                  {date(population.dateUpdated)}
                </Text>
              </Flex>
            </Flex>
          </Frame>
        </Box>
      </Grid>
    </Box>
  );
}

// Same wording as Product Analytics' funnel step filters, e.g. `event_name=signup`.
function getRowFilterLabel(
  filter: RowFilter,
  factTable: FactTableDefinition | null,
): string {
  if (filter.operator === "sql_expr") return "SQL expr";
  if (filter.operator === "saved_filter") {
    const saved = factTable?.filters.find((f) => f.id === filter.values?.[0]);
    return saved ? saved.name : "Saved Filter";
  }
  const column =
    factTable?.columns.find((c) => c.column === filter.column)?.name ||
    filter.column ||
    "?";
  const op = operatorLabelMap[filter.operator] ?? filter.operator;
  if (
    ["is_true", "is_false", "is_null", "not_null"].includes(filter.operator)
  ) {
    return `${column} ${op}`;
  }
  const values = (filter.values ?? []).filter((v) => v !== "");
  const value = values.length ? values.join(", ") : "…";
  return /^[a-zA-Z]/.test(op)
    ? `${column} ${op} ${value}`
    : `${column}${op}${value}`;
}

function PopulationStepSummary({
  step,
  index,
}: {
  step: PopulationStep;
  index: number;
}) {
  const { getFactTableById } = useDefinitions();
  const factTable = getFactTableById(step.source.factTableId);
  const windowLabel = getPopulationStepWindowLabel(step.windowSettings);

  return (
    <Flex direction="column" gap="1">
      <Text weight="medium">
        {index + 1}.{" "}
        {factTable ? (
          <Link href={`/fact-tables/${factTable.id}`}>{factTable.name}</Link>
        ) : (
          step.source.factTableId
        )}
      </Text>
      {step.rowFilters.map((rf, i) => (
        <Text key={i} size="sm" color="text-mid">
          {getRowFilterLabel(rf, factTable)}
        </Text>
      ))}
      {windowLabel && (
        <Text size="sm" color="text-mid">
          {windowLabel}
        </Text>
      )}
    </Flex>
  );
}
