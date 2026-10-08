import { useCallback, useState } from "react";
import { date, datetime } from "shared/dates";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "shared/types/app-features";
import { getPopulationStepsLabel } from "shared/populations";
import { Box, Flex } from "@radix-ui/themes";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import { Select, SelectItem } from "@/ui/Select";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Field from "@/components/Forms/Field";
import PageHead from "@/components/Layout/PageHead";
import LoadingOverlay from "@/components/LoadingOverlay";
import EmptyState from "@/components/EmptyState";
import Owner from "@/components/Avatar/Owner";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import { useAddComputedFields, useSearch } from "@/services/search";
import { usePopulations } from "@/hooks/usePopulations";
import PopulationMoreMenu from "@/components/Populations/PopulationMoreMenu";
import Custom404 from "@/pages/404";

const ALL_DATASOURCES = "__all__";
const CREATE_POPULATION_DOCS =
  "https://docs.growthbook.io/api/Populations/operation/createPopulation";

export default function PopulationsPage() {
  const gb = useGrowthBook<AppFeatures>();
  const { project, getFactTableById, getDatasourceById, datasources } =
    useDefinitions();
  const { getOwnerDisplay } = useUser();
  const { populations, loading, error, mutate } = usePopulations(project);
  const [datasourceFilter, setDatasourceFilter] = useState(ALL_DATASOURCES);

  const populationsWithLabels = useAddComputedFields(
    populations,
    (p) => ({
      ...p,
      stepsLabel: getPopulationStepsLabel(
        p.steps,
        (id) => getFactTableById(id)?.name,
      ),
      identifierLabel: p.userIdTypes.join(", "),
      datasourceName: getDatasourceById(p.datasource)?.name || p.datasource,
      ownerName: getOwnerDisplay(p.owner),
    }),
    [getFactTableById, getDatasourceById, getOwnerDisplay],
  );

  const filterResults = useCallback(
    (items: typeof populationsWithLabels) =>
      datasourceFilter === ALL_DATASOURCES
        ? items
        : items.filter((p) => p.datasource === datasourceFilter),
    [datasourceFilter],
  );

  const { items, searchInputProps, isFiltered, SortableTableColumnHeader } =
    useSearch({
      items: populationsWithLabels,
      defaultSortField: "name",
      localStorageKey: "populations",
      searchFields: [
        "name^3",
        "description",
        "identifierLabel",
        "stepsLabel",
        "ownerName",
      ],
      filterResults,
    });

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
  if (loading) {
    return <LoadingOverlay />;
  }

  const datasourceIds = [...new Set(populations.map((p) => p.datasource))];

  return (
    <Box className="pagecontents container-fluid">
      <PageHead breadcrumb={[{ display: "Populations" }]} />
      <Box mb="4">
        <Heading as="h1" size="xl" mb="1">
          Populations
        </Heading>
        <Box style={{ maxWidth: 640 }}>
          <Text color="text-mid">
            Groups of users defined by steps against your fact tables. Use them
            to filter and compare charts in Product Analytics. Membership is
            recalculated each time a population refreshes.
          </Text>
        </Box>
      </Box>

      {!populations.length ? (
        <EmptyState
          title="No populations yet"
          description="Populations are created with the REST API for now. Creating them here is coming soon."
          leftButton={
            <Link href={CREATE_POPULATION_DOCS} target="_blank">
              View the API docs
            </Link>
          }
          rightButton={null}
        />
      ) : (
        <>
          <Flex justify="between" align="center" gap="3" mb="3" wrap="wrap">
            <Flex gap="3" align="center">
              <Box width="300px">
                <Field
                  placeholder="Search populations"
                  type="search"
                  {...searchInputProps}
                />
              </Box>
              <Select
                value={datasourceFilter}
                setValue={setDatasourceFilter}
                size="md"
              >
                <SelectItem value={ALL_DATASOURCES}>
                  All Data Sources
                </SelectItem>
                {datasources
                  .filter((d) => datasourceIds.includes(d.id))
                  .map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
              </Select>
            </Flex>
            <Text color="text-mid">
              {items.length} {items.length === 1 ? "population" : "populations"}
            </Text>
          </Flex>

          <Table variant="list" stickyHeader roundedCorners className="appbox">
            <TableHeader>
              <TableRow>
                <SortableTableColumnHeader field="name">
                  Name
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="identifierLabel">
                  Identifier
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="stepsLabel">
                  Steps
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="dateUpdated">
                  Last updated
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="ownerName">
                  Owner
                </SortableTableColumnHeader>
                <TableColumnHeader />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Flex direction="column">
                      <Text weight="medium">{p.name}</Text>
                      {p.description && (
                        <Text size="sm" color="text-low">
                          {p.description}
                        </Text>
                      )}
                    </Flex>
                  </TableCell>
                  <TableCell>
                    <Text size="sm" color="text-mid" mono>
                      {p.identifierLabel}
                    </Text>
                  </TableCell>
                  <TableCell>{p.stepsLabel}</TableCell>
                  <TableCell title={datetime(p.dateUpdated)}>
                    {date(p.dateUpdated)}
                  </TableCell>
                  <TableCell>
                    <Owner ownerId={p.owner} />
                  </TableCell>
                  <TableCell style={{ width: 40 }}>
                    <PopulationMoreMenu
                      population={p}
                      onDuplicated={() => mutate()}
                      onDeleted={() => mutate()}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {!items.length && isFiltered && (
                <TableRow>
                  <TableCell colSpan={6} style={{ textAlign: "center" }}>
                    No matching populations.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </>
      )}
    </Box>
  );
}
