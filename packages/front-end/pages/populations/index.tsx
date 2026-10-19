import { date, datetime } from "shared/dates";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "shared/types/app-features";
import { getPopulationStepsLabel } from "shared/populations";
import { truncateString } from "shared/util";
import { Box, Flex } from "@radix-ui/themes";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import LinkButton from "@/ui/LinkButton";
import Link from "@/ui/Link";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import TextField from "@/ui/TextField";
import PageHead from "@/components/Layout/PageHead";
import LoadingOverlay from "@/components/LoadingOverlay";
import EmptyState from "@/components/EmptyState";
import Owner from "@/components/Avatar/Owner";
import ProjectBadges from "@/components/ProjectBadges";
import PopulationSearchFilters from "@/components/Search/PopulationSearchFilters";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import { useAddComputedFields, useSearch } from "@/services/search";
import { usePopulations } from "@/hooks/usePopulations";
import PopulationMoreMenu from "@/components/Populations/PopulationMoreMenu";
import Custom404 from "@/pages/404";

const CREATE_POPULATION_DOCS =
  "https://docs.growthbook.io/api/Populations/operation/createPopulation";

export default function PopulationsPage() {
  const gb = useGrowthBook<AppFeatures>();
  const populationsEnabled = !!gb?.isOn("populations");
  const { project, getFactTableById, getDatasourceById, getProjectById } =
    useDefinitions();
  const { getOwnerDisplay } = useUser();
  const { populations, loading, error, mutate } = usePopulations(project, {
    enabled: populationsEnabled,
  });
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
      projectNames: p.projects.map((id) => getProjectById(id)?.name || id),
    }),
    [getFactTableById, getDatasourceById, getOwnerDisplay, getProjectById],
  );

  const {
    items,
    searchInputProps,
    isFiltered,
    syntaxFilters,
    setSearchValue,
    clear,
    SortableTableColumnHeader,
  } = useSearch({
    items: populationsWithLabels,
    defaultSortField: "name",
    localStorageKey: "populations",
    searchFields: [
      "name^3",
      "description",
      "identifierLabel",
      "stepsLabel",
      "ownerName",
      "datasourceName",
    ],
    updateSearchQueryOnChange: true,
    searchTermFilters: {
      has: (item) => (item.projects.length ? ["project", "projects"] : []),
      created: (item) => new Date(item.dateCreated),
      updated: (item) => new Date(item.dateUpdated),
      name: (item) => item.name,
      description: (item) => item.description,
      id: (item) => item.id,
      owner: (item) => [item.owner, item.ownerName],
      datasource: (item) => [item.datasource, item.datasourceName],
      project: (item) => [...item.projectNames, ...item.projects],
      identifier: (item) => item.userIdTypes,
    },
  });

  if (!populationsEnabled) {
    return <Custom404 />;
  }
  if (loading) {
    return <LoadingOverlay />;
  }

  return (
    <Box className="pagecontents" style={{ margin: "0 auto" }}>
      <PageHead breadcrumb={[{ display: "Populations" }]} />
      <Flex justify="between" align="start" gap="3" mb="4">
        <Box>
          <Heading as="h1" size="xl" mb="1">
            Populations
          </Heading>
          <Box style={{ maxWidth: 640 }}>
            <Text color="text-mid">
              Groups of users defined by steps against your fact tables. Use
              them to filter and compare charts in Product Analytics. Membership
              is recalculated each time a Population refreshes.
            </Text>
          </Box>
        </Box>
      </Flex>

      {error ? (
        <Callout
          status="error"
          action={
            <Button
              color="inherit"
              onClick={async () => {
                await mutate();
              }}
            >
              Retry
            </Button>
          }
        >
          {error.message}
        </Callout>
      ) : !populations.length ? (
        <EmptyState
          title="No Populations yet"
          description="Define a group of users by the steps they take in your fact tables."
          leftButton={
            <LinkButton
              href={CREATE_POPULATION_DOCS}
              variant="outline"
              external
            >
              View the API docs
            </LinkButton>
          }
          rightButton={null}
        />
      ) : (
        <>
          <Flex justify="between" mb="3" gap="3" align="center" wrap="wrap">
            <Box width={{ initial: "100%", sm: "40%" }}>
              <TextField
                type="search"
                placeholder="Search..."
                aria-label="Search Populations"
                {...searchInputProps}
              />
            </Box>
            <PopulationSearchFilters
              populations={populations}
              searchInputProps={searchInputProps}
              setSearchValue={setSearchValue}
              syntaxFilters={syntaxFilters}
            />
          </Flex>

          <Table variant="list" stickyHeader roundedCorners className="appbox">
            <TableHeader>
              <TableRow>
                <SortableTableColumnHeader field="name">
                  Name
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="datasourceName">
                  Data Source
                </SortableTableColumnHeader>
                <TableColumnHeader>Projects</TableColumnHeader>
                <SortableTableColumnHeader field="identifierLabel">
                  Identifier Types
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="stepsLabel">
                  Steps
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="dateUpdated">
                  Last Updated
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
                          {truncateString(p.description, 80)}
                        </Text>
                      )}
                    </Flex>
                  </TableCell>
                  <TableCell>{p.datasourceName}</TableCell>
                  <TableCell>
                    <ProjectBadges
                      resourceType="population"
                      projectIds={
                        p.projects.length > 0 ? p.projects : undefined
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Flex gap="1" wrap="wrap">
                      {p.userIdTypes.map((t) => (
                        <Badge key={t} label={t} color="gray" variant="solid" />
                      ))}
                    </Flex>
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
                  <TableCell colSpan={8} style={{ textAlign: "center" }}>
                    No matching Populations.{" "}
                    <Link onClick={() => clear()}>Clear search field</Link>
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
