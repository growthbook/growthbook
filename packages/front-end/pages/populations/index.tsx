import { useCallback, useState } from "react";
import { ago, datetime } from "shared/dates";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "shared/types/app-features";
import { populationEndpoints } from "shared/api-endpoints";
import { ApiPopulation } from "shared/validators";
import { getPopulationStepsLabel } from "shared/populations";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiDotsThreeVertical } from "react-icons/pi";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import { Select, SelectItem } from "@/ui/Select";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
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
import { useRestApiCall } from "@/services/restApi";
import { usePopulations } from "@/hooks/usePopulations";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
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
      searchFields: ["name^3", "description", "stepsLabel", "ownerName"],
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
        <Text color="text-mid">
          Groups of units defined by steps against your Fact Tables.
        </Text>
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
                          {p.description}
                        </Text>
                      )}
                    </Flex>
                  </TableCell>
                  <TableCell>{p.stepsLabel}</TableCell>
                  <TableCell title={datetime(p.dateUpdated)}>
                    {ago(p.dateUpdated)}
                  </TableCell>
                  <TableCell>
                    <Owner ownerId={p.owner} />
                  </TableCell>
                  <TableCell style={{ width: 40 }}>
                    <PopulationRowMenu population={p} onChange={mutate} />
                  </TableCell>
                </TableRow>
              ))}
              {!items.length && isFiltered && (
                <TableRow>
                  <TableCell colSpan={5} style={{ textAlign: "center" }}>
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

function PopulationRowMenu({
  population,
  onChange,
}: {
  population: ApiPopulation;
  onChange: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const restApiCall = useRestApiCall();
  const permissionsUtil = usePermissionsUtil();

  const canDuplicate = permissionsUtil.canCreateSegment({
    projects: population.projects,
  });
  const canDelete = permissionsUtil.canDeleteSegment(population);
  if (!canDuplicate && !canDelete) return null;

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      trigger={
        <IconButton
          variant="ghost"
          color="gray"
          radius="full"
          size="2"
          highContrast
          aria-label="Population actions"
        >
          <PiDotsThreeVertical size={18} />
        </IconButton>
      }
      menuPlacement="end"
      variant="soft"
    >
      {canDuplicate && (
        <DropdownMenuItem
          onClick={async () => {
            await restApiCall(populationEndpoints.createPopulation, {
              body: {
                name: `${population.name} (copy)`,
                description: population.description,
                projects: population.projects,
                datasource: population.datasource,
                userIdTypes: population.userIdTypes,
                steps: population.steps,
              },
            });
            await onChange();
            setOpen(false);
          }}
        >
          Duplicate
        </DropdownMenuItem>
      )}
      {canDuplicate && canDelete && <DropdownMenuSeparator />}
      {canDelete && (
        <DropdownMenuItem
          color="red"
          confirmation={{
            confirmationTitle: "Delete Population",
            cta: "Delete",
            ctaColor: "red",
            getConfirmationContent: async () =>
              `Are you sure you want to delete "${population.name}"? This can't be undone.`,
            submit: async () => {
              await restApiCall(populationEndpoints.deletePopulation, {
                params: { id: population.id },
              });
              await onChange();
            },
            closeDropdown: () => setOpen(false),
          }}
        >
          Delete
        </DropdownMenuItem>
      )}
    </DropdownMenu>
  );
}
