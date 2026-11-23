import React, { useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Box, Grid } from "@radix-ui/themes";
import { ApiAutoRun } from "shared/validators";
import { FullFactTableColumns } from "shared/types/fact-table";
import { MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID } from "shared/constants";
import { getEventForwarderEventsFactTableId } from "shared/util";
import {
  buildImportData,
  CATEGORIES,
  ExistingIds,
  fetchOptimizelyData,
  getFilterProperties,
  getImportedIds,
  ImportSettings,
  isDummyImport,
  matchItems,
  OptimizelyCategory,
  OptimizelyData,
  runOptimizelyImport,
} from "@/services/importing/optimizely/optimizely-importing";
import {
  getColumnNames,
  ImportResult,
} from "@/services/importing/eppo/eppo-importing";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAttributeSchema, useEnvironments } from "@/services/features";
import { useFeatureMetaInfo } from "@/hooks/useFeatureMetaInfo";
import { useUser } from "@/services/UserContext";
import { useSessionStorage } from "@/hooks/useSessionStorage";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import useApi from "@/hooks/useApi";
import track from "@/services/track";
import Frame from "@/ui/Frame";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import { TextField } from "@/ui/TextField";
import Table, { TableBody } from "@/ui/Table";
import Text from "@/ui/Text";
import ColumnMappingRow from "@/components/SchemaBrowser/ColumnMappingRow";
import SelectField from "@/components/Forms/SelectField";
import ImportReviewTables from "@/components/importing/ImportReviewTables/ImportReviewTables";

const itemId = (category: OptimizelyCategory, key: string) =>
  `${category}:${key}`;

const HREFS: Partial<Record<OptimizelyCategory, (id: string) => string>> = {
  audiences: (id) => `/saved-groups/${id}`,
  metrics: (id) => `/fact-metrics/${id}`,
  flags: (id) => `/features/${id}`,
};

const UNTOUCHED: OptimizelyCategory[] = ["environments"];

const inProject = (project: string, projects?: string[] | null) =>
  !project || !projects?.length || projects.includes(project);

export default function ImportFromOptimizely() {
  const router = useRouter();
  const { apiCall } = useAuth();
  const { refreshOrganization } = useUser();
  const {
    datasources,
    getDatasourceById,
    projects,
    savedGroups,
    factTables,
    factMetrics,
    _savedGroupsIncludingArchived,
    _factMetricsIncludingArchived,
    mutateDefinitions,
  } = useDefinitions();
  const environments = useEnvironments();
  const attributeSchema = useAttributeSchema();
  const { features, mutate: mutateFeatures } = useFeatureMetaInfo();
  const { data: runsData, mutate: mutateRuns } = useApi<{
    autoRuns: ApiAutoRun[];
  }>("/auto-runs");

  const [apiToken, setApiToken] = useSessionStorage("optimizelyApiToken", "");
  const [optimizelyProjectId, setOptimizelyProjectId] = useLocalStorage(
    "optimizelyImportSourceProject",
    "",
  );
  // Existing Project by name, or a new one created when the import starts
  const [projectName, setProjectName] = useLocalStorage(
    "optimizelyImportProject",
    "",
  );
  const project = projects.find((p) => p.name === projectName.trim())?.id ?? "";
  const newProjectName = project ? "" : projectName.trim();
  const [pickedDatasourceId, setDatasourceId] = useState<string | null>(null);
  const datasourceId =
    pickedDatasourceId ?? (datasources.length === 1 ? datasources[0].id : "");
  const datasource = getDatasourceById(datasourceId);

  // Every metric reads from one events table: the one the Managed Warehouse
  // or Event Forwarder creates, else any table with an event_name column
  const datasourceFactTables = factTables.filter(
    (ft) => ft.datasource === datasourceId,
  );
  const [pickedFactTableId, setFactTableId] = useState<string | null>(null);
  // Only suggest a table until one is picked; "None" is a choice too
  const factTable =
    pickedFactTableId !== null
      ? datasourceFactTables.find((ft) => ft.id === pickedFactTableId)
      : (datasourceFactTables.find(
          (ft) =>
            ft.id === MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID ||
            ft.id === getEventForwarderEventsFactTableId(datasourceId),
        ) ??
        datasourceFactTables.find((ft) =>
          getColumnNames(ft.columns).includes("event_name"),
        ));

  const [opt, setOpt] = useState<OptimizelyData | null>(null);
  const [busy, setBusy] = useState<"fetching" | "importing" | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Which step the error belongs to, so it shows next to that step's button
  const [errorStep, setErrorStep] = useState<"fetch" | "import">("fetch");
  const [results, setResults] = useState<Record<string, ImportResult>>({});
  const [selection, setSelection] = useState<Record<string, boolean>>({});

  // One row per column the metrics read. Managed events tables keep event
  // tags and properties in a `properties` JSON column.
  const columns = getColumnNames(factTable?.columns ?? []);
  const nested = (field: string) =>
    columns.includes("properties")
      ? `properties.${field}`
      : columns.includes(field)
        ? field
        : "";
  // Definitions leave out the fields inside JSON columns
  const { data: fullFactTable } = useApi<{
    factTables: FullFactTableColumns[];
  }>(`/fact-tables?ids=${factTable?.id}`, { shouldRun: () => !!factTable });
  const jsonFieldColumns = (fullFactTable?.factTables[0]?.columns ?? [])
    .filter((c) => !c.deleted)
    .flatMap((c) =>
      Object.keys(c.jsonFields ?? {}).map((field) => `${c.column}.${field}`),
    );
  const [pickedColumns, setPickedColumns] = useState<Record<string, string>>(
    {},
  );
  const properties = useMemo(
    () => (opt ? getFilterProperties(opt) : []),
    [opt],
  );
  const columnPickers = [
    {
      key: "eventName",
      label: "Event key",
      kind: "event" as const,
      tooltip: "Filtered to each metric's Optimizely event key",
      fallback: columns.includes("event_name") ? "event_name" : "",
    },
    ...["revenue", "value"].map((tag) => ({
      key: tag,
      label: tag === "revenue" ? "Revenue tag" : "Value tag",
      kind: "columns" as const,
      tooltip: `Optimizely's "${tag}" event tag`,
      fallback: nested(tag),
    })),
    ...properties.map((name) => ({
      key: `property:${name}`,
      label: `Property: ${name}`,
      kind: "columns" as const,
      tooltip: `The "${name}" event property a metric filters on`,
      fallback: nested(name),
    })),
  ].map((picker) => ({
    ...picker,
    column: pickedColumns[picker.key] ?? picker.fallback,
    options: [...new Set([...columns, ...jsonFieldColumns])].map((column) => ({
      column,
      datatype: "" as const,
    })),
  }));
  // A string, so the import data is only rebuilt when a mapping changes
  const columnMapping = JSON.stringify(
    columnPickers.map(({ key, column }) => [key, column]),
  );

  const factTableId = factTable?.id ?? "";
  const settings: ImportSettings = useMemo(() => {
    const mapping: [string, string][] = JSON.parse(columnMapping);
    const column = (key: string) => mapping.find(([k]) => k === key)?.[1] ?? "";
    return {
      project,
      datasource: datasource ?? null,
      eventsFactTable: factTableId
        ? {
            id: factTableId,
            eventNameColumn: column("eventName"),
            revenueColumn: column("revenue"),
            valueColumn: column("value"),
            propertyColumns: Object.fromEntries(
              mapping.flatMap(([key, value]) =>
                key.startsWith("property:")
                  ? [[key.slice("property:".length), value]]
                  : [],
              ),
            ),
          }
        : null,
    };
  }, [project, datasource, factTableId, columnMapping]);

  const existing: ExistingIds = useMemo(() => {
    const ids = {
      // Archived objects still exist; only deleted ones should be re-created
      "saved-group": new Set(_savedGroupsIncludingArchived.map((sg) => sg.id)),
      metric: new Set(
        _factMetricsIncludingArchived
          .filter((m) => m.datasource === datasourceId)
          .map((m) => m.id),
      ),
      feature: new Set(features.map((f) => f.id)),
    };
    return {
      environments: new Set(environments.map((e) => e.id)),
      imported: getImportedIds(
        runsData?.autoRuns ?? [],
        (kind, id) => kind in ids && ids[kind as keyof typeof ids].has(id),
      ),
      // Only condition groups can take an audience's rules
      savedGroups: new Map(
        savedGroups
          .filter(
            (sg) => sg.type === "condition" && inProject(project, sg.projects),
          )
          .map((sg) => [sg.groupName, sg.id]),
      ),
      factMetrics: new Map(
        factMetrics
          .filter(
            (m) =>
              m.datasource === datasourceId && inProject(project, m.projects),
          )
          .map((m) => [m.name, m.id]),
      ),
      features: new Set(features.map((f) => f.id)),
    };
  }, [
    environments,
    savedGroups,
    features,
    factMetrics,
    _savedGroupsIncludingArchived,
    _factMetricsIncludingArchived,
    datasourceId,
    project,
    runsData,
  ]);

  const matches = useMemo(
    () => (opt ? matchItems(opt, existing) : null),
    [opt, existing],
  );

  // Items that only share a name with something in GrowthBook start unselected
  const isSelected = (category: OptimizelyCategory, key: string) => {
    const match = matches?.[category].get(key);
    if (UNTOUCHED.includes(category) && match?.existingId) return false;
    return selection[itemId(category, key)] ?? match?.match !== "name";
  };

  const data = useMemo(
    () =>
      opt && matches
        ? buildImportData(
            opt,
            existing,
            matches,
            settings,
            (category, key) =>
              selection[itemId(category, key)] ??
              matches[category].get(key)?.match !== "name",
          )
        : null,
    [opt, matches, existing, settings, selection],
  );

  const getItems = (category: OptimizelyCategory) =>
    (data?.[category] ?? []).map((item) => ({
      ...item,
      ...results[itemId(category, item.key)],
    }));
  const selectedItems = CATEGORIES.flatMap(({ key }) =>
    getItems(key)
      .filter(
        (item) =>
          item.status !== "invalid" &&
          !(UNTOUCHED.includes(key) && item.existingId) &&
          isSelected(key, item.key),
      )
      .map((item) => ({ category: key, item })),
  );
  const selectedCount = selectedItems.length;
  const updating = selectedItems.filter(({ item }) => item.existingId);
  const updateCount = updating.filter(
    ({ item }) => item.match === "run",
  ).length;
  const overwriteCount = updating.filter(
    ({ item }) => item.match === "name",
  ).length;

  const refresh = () =>
    Promise.all([mutateDefinitions(), mutateFeatures(), mutateRuns()]);

  const fetchData = async () => {
    track("Optimizely import fetch started", { source: "optimizely" });
    setBusy("fetching");
    setProgress("");
    setError(null);
    setErrorStep("fetch");
    try {
      const [fetched] = await Promise.all([
        fetchOptimizelyData(
          apiToken,
          optimizelyProjectId.trim(),
          apiCall,
          (done, total) => setProgress(` (${done}/${total})`),
        ),
        refresh(),
      ]);
      setOpt(fetched);
      setResults({});
      setSelection({});
    } catch (e) {
      setError(e.message);
    }
    setBusy(null);
  };

  const runImport = async () => {
    if (!data || !opt) return;
    track("Optimizely import started", {
      source: "optimizely",
      items: selectedCount,
    });
    setBusy("importing");
    setError(null);
    setErrorStep("import");

    let pending: Record<string, ImportResult> = {};
    const flush = () => {
      if (!Object.keys(pending).length) return;
      const updates = pending;
      pending = {};
      setResults((prev) => {
        const next = { ...prev };
        Object.entries(updates).forEach(([id, update]) => {
          next[id] = { ...prev[id], ...update };
        });
        return next;
      });
    };
    const timer = window.setInterval(flush, 250);

    let runId: string | null = null;
    try {
      let projectId = project;
      if (newProjectName) {
        const created = await apiCall<{ project: { id: string } }>(
          "/projects",
          {
            method: "POST",
            body: JSON.stringify({
              name: newProjectName,
              description: "Created by the Optimizely importer",
            }),
          },
        );
        projectId = created.project.id;
      }
      const outcome = await runOptimizelyImport({
        data,
        opt,
        isSelected,
        existing,
        settings: { ...settings, project: projectId },
        attributeSchema,
        apiCall,
        setItem: (category, key, update) => {
          const id = itemId(category, key);
          pending[id] = { ...pending[id], ...update };
        },
      });
      runId = outcome.runId;
      track("Optimizely import finished", {
        source: "optimizely",
        completed: outcome.completed,
        failed: outcome.failed,
      });
    } catch (e) {
      setError(e.message);
    }
    window.clearInterval(timer);
    flush();
    await Promise.all([refresh(), refreshOrganization()]);
    setBusy(null);
    if (runId) router.push(`/auto-runs/${runId}`);
  };

  return (
    <Box>
      <Frame>
        <Grid columns={{ initial: "1", md: "2" }} gap="4">
          <TextField
            label="API token"
            type="password"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            // A fetch in flight belongs to these values
            disabled={!!busy}
            helpText="Personal access token from Optimizely Profile > API Access"
          />
          <TextField
            label="Optimizely project ID"
            value={optimizelyProjectId}
            disabled={!!busy}
            onChange={(e) => {
              setOptimizelyProjectId(e.target.value);
              // What was fetched belongs to the old project
              setOpt(null);
              setResults({});
              setSelection({});
            }}
            helpText="The number after /projects/ in the Optimizely URL"
          />
          <SelectField
            label="GrowthBook Project"
            value={projectName}
            initialOption="All Projects"
            // Typing a new name creates that Project when the import starts
            createable
            // With no Projects yet, still offer "All Projects"
            keepCreatableWhenEmpty
            options={projects.map((p) => ({ label: p.name, value: p.name }))}
            onChange={setProjectName}
            helpText={
              newProjectName ? `"${newProjectName}" will be created` : undefined
            }
          />
        </Grid>
        <Box mt="4">
          <Button
            variant={data ? "outline" : "solid"}
            disabled={
              !!busy ||
              (!isDummyImport() && (!apiToken || !optimizelyProjectId.trim()))
            }
            loading={busy === "fetching"}
            onClick={fetchData}
          >
            {busy === "fetching"
              ? `Fetching${progress}`
              : "Fetch from Optimizely"}
          </Button>
        </Box>
      </Frame>

      {error && errorStep === "fetch" ? (
        <Callout status="error" mb="4">
          {error}
        </Callout>
      ) : null}

      {data?.metrics.length ? (
        <Frame>
          <Heading as="h2" size="md" mb="3">
            Metric Data Mapping
          </Heading>
          <Grid columns={{ initial: "1", md: "2" }} gap="4">
            <SelectField
              label="Data Source"
              value={datasourceId}
              initialOption="None"
              options={datasources.map((ds) => ({
                label: ds.name,
                value: ds.id,
              }))}
              onChange={(id) => {
                setDatasourceId(id);
                setFactTableId(null);
                setPickedColumns({});
              }}
            />
            {datasourceId ? (
              <SelectField
                label="Events Fact Table"
                value={factTable?.id ?? ""}
                initialOption="None"
                options={datasourceFactTables.map((ft) => ({
                  label: ft.name,
                  value: ft.id,
                }))}
                onChange={(id) => {
                  setFactTableId(id);
                  setPickedColumns({});
                }}
              />
            ) : null}
          </Grid>
          {factTable ? (
            <Box mt="4">
              <Text as="div" weight="semibold" mb="2">
                Column mapping
              </Text>
              <Table size="sm" variant="surface" layout="fixed">
                <TableBody>
                  {columnPickers.map(
                    ({ key, label, kind, tooltip, column, options }) => {
                      const setColumn = (picked: string) =>
                        setPickedColumns((prev) => ({
                          ...prev,
                          [key]: picked,
                        }));
                      return (
                        <ColumnMappingRow
                          key={key}
                          kind={kind}
                          label={label}
                          tooltip={tooltip}
                          value={column}
                          options={options}
                          setValue={setColumn}
                          onRemove={() => setColumn("")}
                          // The table's columns may not all exist yet
                          createable
                        />
                      );
                    },
                  )}
                </TableBody>
              </Table>
            </Box>
          ) : null}
        </Frame>
      ) : null}

      {data && CATEGORIES.every(({ key }) => !data[key].length) ? (
        <Callout status="info" mb="4">
          Optimizely returned nothing to import for this project.
        </Callout>
      ) : null}

      {data ? (
        <ImportReviewTables
          categories={CATEGORIES}
          sourceName="Optimizely"
          hrefs={HREFS}
          untouchedCategories={UNTOUCHED}
          getItems={getItems}
          isSelected={isSelected}
          setSelected={(category, keys, selected) =>
            setSelection((prev) => ({
              ...prev,
              ...Object.fromEntries(
                keys.map((key) => [itemId(category, key), selected]),
              ),
            }))
          }
        />
      ) : null}

      {updateCount ? (
        <Callout status="info" mb="4">
          {`${updateCount} selected ${
            updateCount === 1 ? "item" : "items"
          } from earlier imports will be updated to match Optimizely.`}
          {updating.some(({ category }) => category === "flags")
            ? " Rules on an existing Feature Flag are replaced; owners, tags and Projects are kept."
            : ""}
        </Callout>
      ) : null}

      {overwriteCount ? (
        <Callout status="warning" mb="4">
          {`${overwriteCount} selected ${
            overwriteCount === 1 ? "item was" : "items were"
          } not created by an Optimizely import and only ${
            overwriteCount === 1 ? "shares" : "share"
          } a name or key with the Optimizely item. Importing overwrites ${
            overwriteCount === 1 ? "it" : "them"
          } with Optimizely's definition.`}
        </Callout>
      ) : null}

      {error && errorStep === "import" ? (
        <Callout status="error" mb="4">
          {error}
        </Callout>
      ) : null}

      {data ? (
        <Button
          mb="5"
          disabled={!selectedCount || !!busy}
          loading={busy === "importing"}
          onClick={runImport}
        >
          {`Import ${selectedCount} item${selectedCount === 1 ? "" : "s"}`}
        </Button>
      ) : null}
    </Box>
  );
}
