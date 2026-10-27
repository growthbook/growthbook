import { useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { populationEndpoints } from "shared/api-endpoints";
import type { ApiPopulation } from "shared/validators";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Frame from "@/ui/Frame";
import HelperText from "@/ui/HelperText";
import TextField from "@/ui/TextField";
import { Select, SelectItem } from "@/ui/Select";
import MultiSelectField from "@/ui/MultiSelectField";
import PageHead from "@/components/Layout/PageHead";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useRestApiCall } from "@/services/restApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useFullFactTables from "@/hooks/useFullFactTables";
import { useRefreshPopulations } from "@/hooks/usePopulations";
import PopulationStepCard from "./PopulationStepCard";
import {
  getDefaultPopulationUserIdType,
  getPopulationDraftIssue,
  newPopulationStep,
  PopulationDraft,
} from "./populationDraft";

export default function PopulationEditor({
  population,
}: {
  population?: ApiPopulation;
}) {
  const router = useRouter();
  const restApiCall = useRestApiCall();
  const refreshPopulations = useRefreshPopulations();
  const permissionsUtil = usePermissionsUtil();
  const {
    project,
    datasources,
    factTables,
    _factTablesIncludingArchived: allFactTables,
    getDatasourceById,
  } = useDefinitions();

  const eligibleDatasources = useMemo(
    () =>
      datasources.filter(
        (d) =>
          d.id === population?.datasource ||
          factTables.some((ft) => ft.datasource === d.id),
      ),
    [datasources, factTables, population?.datasource],
  );

  const defaultUserIdTypes = (datasourceId: string) => {
    const userIdType = getDefaultPopulationUserIdType(
      getDatasourceById(datasourceId)?.settings.userIdTypes?.map(
        (t) => t.userIdType,
      ) ?? [],
      factTables,
      datasourceId,
    );
    return userIdType ? [userIdType] : [];
  };

  const [draft, setDraft] = useState<PopulationDraft>(() => {
    if (population) {
      return {
        name: population.name,
        description: population.description,
        datasource: population.datasource,
        userIdTypes: population.userIdTypes,
        step: population.steps[0],
      };
    }
    const datasource = eligibleDatasources[0]?.id ?? "";
    return {
      name: "",
      description: "",
      datasource,
      userIdTypes: defaultUserIdTypes(datasource),
      step: newPopulationStep(),
    };
  });
  const [error, setError] = useState<string | null>(null);
  const [pendingDatasource, setPendingDatasource] = useState<string | null>(
    null,
  );

  const projects = population?.projects ?? (project ? [project] : []);
  const canSave = population
    ? permissionsUtil.canUpdatePopulation(population, { projects })
    : permissionsUtil.canCreatePopulation({ projects });
  const stepFactTableIds = [draft.step.source.factTableId].filter((id) =>
    allFactTables.some((ft) => ft.id === id),
  );
  const {
    getById: getFullFactTable,
    isLoadedFor: fullFactTablesLoadedFor,
    isLoading: fullFactTablesLoading,
    error: fullFactTablesError,
  } = useFullFactTables(stepFactTableIds);
  const ruleFactTables = allFactTables.map((ft) => ({
    ...ft,
    columns: getFullFactTable(ft.id)?.columns ?? ft.columns,
  }));
  // Without full columns a JSON aggregate can't be checked, so Save stays
  // disabled until the step's fact table loads. SWR retries a failed request
  // with isLoading true, so `error` keeps the settled message during retries.
  const fullFactTablesLoaded = fullFactTablesLoadedFor(stepFactTableIds);
  const blocker = !canSave
    ? "You don't have permission to save this Population."
    : !fullFactTablesLoaded && (!fullFactTablesLoading || fullFactTablesError)
      ? "The fact table on this Population could not be loaded."
      : null;
  const issue =
    blocker ??
    (!fullFactTablesLoaded
      ? "Loading fact table..."
      : getPopulationDraftIssue(draft, ruleFactTables));
  const noEligibleDatasources = !population && !eligibleDatasources.length;

  const changeDatasource = (datasource: string) =>
    setDraft((d) => ({
      ...d,
      datasource,
      userIdTypes: defaultUserIdTypes(datasource),
      step: newPopulationStep(),
    }));
  const stepHasContent =
    !!draft.step.source.factTableId ||
    draft.step.rowFilters.length > 0 ||
    draft.step.aggregateFilterColumn !== undefined;

  const userIdTypeOptions =
    getDatasourceById(draft.datasource)?.settings.userIdTypes?.map(
      (t) => t.userIdType,
    ) ?? [];
  // Keep identifier types saved through the API selectable even if the Data
  // Source no longer lists them.
  for (const t of draft.userIdTypes) {
    if (!userIdTypeOptions.includes(t)) userIdTypeOptions.push(t);
  }

  const save = async () => {
    const body = {
      name: draft.name.trim(),
      description: draft.description,
      userIdTypes: draft.userIdTypes,
      steps: [draft.step],
    };
    if (population) {
      await restApiCall(populationEndpoints.updatePopulation, {
        params: { id: population.id },
        body,
      });
      await refreshPopulations(population.id);
      await router.push(`/populations/${population.id}`);
    } else {
      const { population: created } = await restApiCall(
        populationEndpoints.createPopulation,
        { body: { ...body, datasource: draft.datasource, projects } },
      );
      await refreshPopulations();
      await router.push(`/populations/${created.id}`);
    }
  };
  const cancelHref = population
    ? `/populations/${population.id}`
    : "/populations";

  const title = population ? "Edit Population" : "New Population";

  return (
    <Box className="pagecontents" style={{ margin: "0 auto" }}>
      <PageHead
        breadcrumb={[
          { display: "Populations", href: "/populations" },
          ...(population
            ? [
                { display: population.name, href: cancelHref },
                { display: "Edit" },
              ]
            : [{ display: "New Population" }]),
        ]}
      />
      <Flex justify="between" align="center" gap="3" mb="4" wrap="wrap">
        <Heading as="h1" size="xl">
          {title}
        </Heading>
        <Flex gap="3" align="center" wrap="wrap" justify="end">
          {issue && !blocker && !noEligibleDatasources && (
            <HelperText status="info" size="sm">
              {issue}
            </HelperText>
          )}
          <LinkButton href={cancelHref} variant="outline">
            Cancel
          </LinkButton>
          <Button onClick={save} setError={setError} disabled={!!issue}>
            Save Population
          </Button>
        </Flex>
      </Flex>

      {blocker && (
        <Callout status={canSave ? "error" : "warning"} mb="4">
          {blocker}
        </Callout>
      )}
      {error && (
        <Callout status="error" mb="4">
          {error}
        </Callout>
      )}
      {noEligibleDatasources && (
        <Callout status="info" mb="4">
          A Population is built from a fact table, so create one first.{" "}
          <Link href="/fact-tables">Go to Fact Tables</Link>
        </Callout>
      )}
      {pendingDatasource !== null && (
        <ConfirmDialog
          title="Change Data Source?"
          content="Changing the Data Source clears the fact table and filters you've chosen."
          yesText="Change Data Source"
          onConfirm={() => {
            changeDatasource(pendingDatasource);
            setPendingDatasource(null);
          }}
          onCancel={() => setPendingDatasource(null)}
        />
      )}

      {/* The form's large flex-grow keeps the size panel at its base width
          until it wraps below. */}
      <Flex wrap="wrap" gap="4" align="start">
        <Frame
          px="5"
          py="5"
          mb="0"
          minWidth="0"
          style={{ flex: "999 1 600px" }}
        >
          <Grid columns={{ initial: "1fr", sm: "3fr 2fr 2fr" }} gap="4" mb="4">
            <TextField
              label="Name"
              value={draft.name}
              onChange={(e) =>
                setDraft((d) => ({ ...d, name: e.target.value }))
              }
              placeholder="e.g. Signed up, never ordered"
              autoFocus={!population}
            />
            <Box>
              <Select
                label="Data Source"
                value={draft.datasource}
                disabled={!!population || noEligibleDatasources}
                setValue={(datasource) => {
                  if (datasource === draft.datasource) return;
                  if (stepHasContent) {
                    setPendingDatasource(datasource);
                  } else {
                    changeDatasource(datasource);
                  }
                }}
                placeholder="Choose a Data Source..."
              >
                {eligibleDatasources.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </Select>
              {population && (
                <Box mt="1">
                  <Text size="sm" color="text-mid">
                    Data Source can&apos;t be changed after the Population is
                    created.
                  </Text>
                </Box>
              )}
            </Box>
            <MultiSelectField
              label="Identifier types"
              size="md"
              legacyLabelFormatting={false}
              containerStyle={{ marginBottom: 0 }}
              value={draft.userIdTypes}
              onChange={(userIdTypes) =>
                setDraft((d) => ({ ...d, userIdTypes }))
              }
              options={userIdTypeOptions.map((t) => ({ label: t, value: t }))}
              placeholder="Choose identifier types..."
              showCopyButton={false}
              sort={false}
            />
          </Grid>

          <Box mb="4">
            <Text as="label" htmlFor="population-description" weight="semibold">
              Description
            </Text>
            <Box mt="1">
              <MarkdownInput
                id="population-description"
                value={draft.description}
                setValue={(description) =>
                  setDraft((d) => ({ ...d, description }))
                }
                placeholder="Who is in this Population, and what is it used for?"
                hidePreview
                maxRows={6}
              />
            </Box>
          </Box>

          <Box pt="4" style={{ borderTop: "1px solid var(--gray-a5)" }}>
            <Heading as="h2" size="md" mb="1">
              Definition
            </Heading>
            <Box mb="3">
              <Text size="sm" color="text-mid">
                Members are the units with a matching row in this fact table.
              </Text>
            </Box>

            <PopulationStepCard
              step={draft.step}
              datasource={draft.datasource}
              userIdTypes={draft.userIdTypes}
              onChange={(step) => setDraft((d) => ({ ...d, step }))}
            />
          </Box>
        </Frame>

        <Frame px="5" py="5" mb="0" style={{ flex: "1 1 280px" }}>
          <Heading as="h2" size="md" mb="3">
            Members
          </Heading>
          <Text size="sm" color="text-mid">
            A live member count is coming soon. Membership is calculated when
            the Population refreshes.
          </Text>
        </Frame>
      </Flex>
    </Box>
  );
}
