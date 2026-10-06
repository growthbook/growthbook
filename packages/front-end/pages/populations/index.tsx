import { useCallback, useState } from "react";
import { ago, datetime } from "shared/dates";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "shared/types/app-features";
import { getPopulationStepsLabel } from "shared/populations";
import { ApiPopulationSnapshot } from "shared/validators";
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
import {
  useLatestPopulationSnapshots,
  usePopulations,
} from "@/hooks/usePopulations";
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
  const { latestSnapshots, mutate: mutateSnapshots } =
    useLatestPopulationSnapshots();
  const [datasourceFilter, setDatasourceFilter] = useState(ALL_DATASOURCES);

  const populationsWithLabels = useAddComputedFields(
    populations,
    (p) => {
      const snapshot = latestSnapshots.get(p.id) ?? null;
      const counts = snapshot?.status === "success" ? snapshot.result : null;
      return {
        ...p,
        stepsLabel: getPopulationStepsLabel(
          p.steps,
          (id) => getFactTableById(id)?.name,
        ),
        datasourceName: getDatasourceById(p.datasource)?.name || p.datasource,
        ownerName: getOwnerDisplay(p.owner),
        snapshot,
        size: counts?.membersNow ?? -1,
        change: counts ? counts.membersNow - counts.membersPrior : 0,
        refreshedAt: snapshot ? new Date(snapshot.asOf).getTime() : 0,
      };
    },
    [getFactTableById, getDatasourceById, getOwnerDisplay, latestSnapshots],
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
                <SortableTableColumnHeader field="size">
                  Size
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="change">
                  Change, 30 days
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="stepsLabel">
                  Steps
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="refreshedAt">
                  Last Refreshed
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
                      <Link href={`/populations/${p.id}`} weight="medium">
                        {p.name}
                      </Link>
                      {p.description && (
                        <Text size="sm" color="text-low">
                          {p.description}
                        </Text>
                      )}
                    </Flex>
                  </TableCell>
                  <TableCell>
                    {p.size >= 0 ? (
                      <Flex direction="column">
                        <Text weight="medium">{p.size.toLocaleString()}</Text>
                        <Text size="sm" color="text-low">
                          {p.snapshot?.userIdType}
                        </Text>
                      </Flex>
                    ) : (
                      <Text color="text-low">—</Text>
                    )}
                  </TableCell>
                  <TableCell>
                    {p.size >= 0 ? (
                      <span
                        style={{
                          color:
                            p.change > 0
                              ? "var(--green-11)"
                              : p.change < 0
                                ? "var(--red-11)"
                                : undefined,
                        }}
                      >
                        <Text>
                          {p.change > 0 ? "+" : ""}
                          {p.change.toLocaleString()}
                        </Text>
                      </span>
                    ) : (
                      <Text color="text-low">—</Text>
                    )}
                  </TableCell>
                  <TableCell>{p.stepsLabel}</TableCell>
                  <TableCell>
                    <RefreshStatus snapshot={p.snapshot} />
                  </TableCell>
                  <TableCell>
                    <Owner ownerId={p.owner} />
                  </TableCell>
                  <TableCell style={{ width: 40 }}>
                    <PopulationMoreMenu
                      population={p}
                      onDuplicated={() => mutate()}
                      onDeleted={() => {
                        void mutateSnapshots();
                        return mutate();
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {!items.length && isFiltered && (
                <TableRow>
                  <TableCell colSpan={7} style={{ textAlign: "center" }}>
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

function RefreshStatus({
  snapshot,
}: {
  snapshot: ApiPopulationSnapshot | null;
}) {
  if (!snapshot) return <Text color="text-low">Never</Text>;
  if (snapshot.status === "running") {
    return <Text color="text-mid">Refreshing…</Text>;
  }
  if (snapshot.status === "error") {
    return (
      <span style={{ color: "var(--red-11)" }}>
        <Text title={snapshot.error || undefined}>Refresh failed</Text>
      </span>
    );
  }
  return <Text title={datetime(snapshot.asOf)}>{ago(snapshot.asOf)}</Text>;
}
