import React, { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex, Grid, VisuallyHidden } from "@radix-ui/themes";
import { ApiAutoRun } from "shared/validators";
import {
  buildImportData,
  CATEGORIES,
  EppoCategory,
  EppoData,
  ExistingIds,
  fetchEppoData,
  getColumnNames,
  getImportedIds,
  ImportItem,
  ImportResult,
  ItemMatch,
  matchItems,
  runEppoImport,
} from "@/services/importing/eppo/eppo-importing";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAttributeSchema, useEnvironments } from "@/services/features";
import { useFeatureMetaInfo } from "@/hooks/useFeatureMetaInfo";
import { useExperiments } from "@/hooks/useExperiments";
import { useUser } from "@/services/UserContext";
import { useSessionStorage } from "@/hooks/useSessionStorage";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import useApi from "@/hooks/useApi";
import track from "@/services/track";
import Frame from "@/ui/Frame";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import { TextField } from "@/ui/TextField";
import DatePicker from "@/components/DatePicker";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
  TableRowHeaderCell,
} from "@/ui/Table";
import SelectField from "@/components/Forms/SelectField";
import Code from "@/components/SyntaxHighlighting/Code";

const itemId = (category: EppoCategory, key: string) => `${category}:${key}`;

const HREFS: Partial<Record<EppoCategory, (id: string) => string>> = {
  audiences: (id) => `/saved-groups/${id}`,
  factSources: (id) => `/fact-tables/${id}`,
  metrics: (id) => `/fact-metrics/${id}`,
  experiments: (id) => `/experiment/${id}`,
  flags: (id) => `/features/${id}`,
};

const UNTOUCHED: EppoCategory[] = ["environments", "tags"];

function StatusBadge({
  item,
  category,
}: {
  item: ImportItem<unknown>;
  category: EppoCategory;
}) {
  switch (item.status) {
    case "invalid":
      return <Badge color="red" label="Can't import" />;
    case "failed":
      return <Badge color="red" label="Failed" />;
    case "completed":
      return <Badge color="green" label="Imported" />;
    case "pending":
      if (item.match === "name") return <Badge color="amber" label="Exists" />;
      if (item.existingId && UNTOUCHED.includes(category)) {
        return <Badge color="gray" label="No change" />;
      }
      return (
        <Badge color="gray" label={item.existingId ? "Update" : "Create"} />
      );
  }
}

const inProject = (project: string, projects?: string[] | null) =>
  !project || !projects?.length || projects.includes(project);

export default function ImportFromEppo() {
  const router = useRouter();
  const { apiCall } = useAuth();
  const { refreshOrganization } = useUser();
  const {
    datasources,
    getDatasourceById,
    projects,
    tags,
    savedGroups,
    factTables,
    factMetrics,
    _savedGroupsIncludingArchived,
    _factTablesIncludingArchived,
    _factMetricsIncludingArchived,
    mutateDefinitions,
  } = useDefinitions();
  const environments = useEnvironments();
  const attributeSchema = useAttributeSchema();
  const { features, mutate: mutateFeatures } = useFeatureMetaInfo();
  const { experiments, mutateExperiments } = useExperiments("", true);
  const { data: runsData, mutate: mutateRuns } = useApi<{
    autoRuns: ApiAutoRun[];
  }>("/auto-runs");

  const [apiKey, setApiKey] = useSessionStorage("eppoApiKey", "");
  // Only experiments and flags created on or after this date; blank is all
  const [createdSince, setCreatedSince] = useSessionStorage(
    "eppoCreatedSince",
    "",
  );
  // Existing Project by name, or a new one created when the import starts
  const [projectName, setProjectName] = useLocalStorage(
    "eppoImportProject",
    "",
  );
  const project = projects.find((p) => p.name === projectName.trim())?.id ?? "";
  const newProjectName = project ? "" : projectName.trim();
  const [pickedDatasourceId, setDatasourceId] = useState<string | null>(null);
  const datasourceId =
    pickedDatasourceId ?? (datasources.length === 1 ? datasources[0].id : "");
  const datasource = getDatasourceById(datasourceId);

  const [eppo, setEppo] = useState<EppoData | null>(null);
  const [busy, setBusy] = useState<"fetching" | "importing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ImportResult>>({});
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const changeCreatedSince = (d: Date | undefined) => {
    setCreatedSince(d ? d.toISOString() : "");
    // What was fetched belongs to the old cutoff
    setEppo(null);
    setResults({});
    setSelection({});
  };
  const [expanded, setExpanded] = useState<string | null>(null);

  const existing: ExistingIds = useMemo(() => {
    const inDatasource = <T extends { id: string; datasource: string }>(
      items: T[],
    ) =>
      new Set(
        items.filter((i) => i.datasource === datasourceId).map((i) => i.id),
      );
    const ids = {
      // Archived objects still exist; only deleted ones should be re-created
      "saved-group": new Set(_savedGroupsIncludingArchived.map((sg) => sg.id)),
      "fact-table": inDatasource(_factTablesIncludingArchived),
      metric: inDatasource(_factMetricsIncludingArchived),
      experiment: new Set(experiments.map((e) => e.id)),
      feature: new Set(features.map((f) => f.id)),
    };
    return {
      environments: new Set(environments.map((e) => e.id)),
      tags: new Set(tags.map((t) => t.id)),
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
      features: new Set(features.map((f) => f.id)),
      factTables: new Map(
        factTables
          .filter(
            (ft) =>
              ft.datasource === datasourceId && inProject(project, ft.projects),
          )
          .map((ft) => [ft.name, ft.id]),
      ),
      factTableColumns: new Map(
        factTables.map((ft) => [ft.id, getColumnNames(ft.columns)]),
      ),
      factMetrics: new Map(
        factMetrics
          .filter(
            (m) =>
              m.datasource === datasourceId && inProject(project, m.projects),
          )
          .map((m) => [m.name, m.id]),
      ),
      experiments: new Map(
        experiments
          .filter(
            (e) =>
              e.trackingKey && inProject(project, e.project ? [e.project] : []),
          )
          .map((e) => [e.trackingKey, e.id]),
      ),
      experimentRefs: new Map(
        experiments.map((e) => {
          const phase = e.phases[e.phases.length - 1];
          return [
            e.id,
            {
              status: e.status,
              variations: e.variations.map((v) => ({ id: v.id, key: v.key })),
              phase: phase && {
                condition: phase.condition ?? "",
                savedGroups: phase.savedGroups ?? [],
                coverage: phase.coverage ?? 1,
                variationWeights: phase.variationWeights,
              },
            },
          ];
        }),
      ),
    };
  }, [
    environments,
    tags,
    savedGroups,
    features,
    factTables,
    factMetrics,
    experiments,
    _savedGroupsIncludingArchived,
    _factTablesIncludingArchived,
    _factMetricsIncludingArchived,
    datasourceId,
    project,
    runsData,
  ]);

  const matches = useMemo(
    () => (eppo ? matchItems(eppo, existing) : null),
    [eppo, existing],
  );

  const untouched = (category: EppoCategory, match: ItemMatch) =>
    UNTOUCHED.includes(category) && !!match.existingId;
  const isSelected = (category: EppoCategory, key: string) => {
    const match: ItemMatch = matches?.[category].get(key) ?? {};
    if (untouched(category, match)) return false;
    return selection[itemId(category, key)] ?? match.match !== "name";
  };

  const data = useMemo(
    () =>
      eppo && matches
        ? buildImportData(
            eppo,
            existing,
            matches,
            project,
            datasource ?? null,
            (category, key) =>
              selection[itemId(category, key)] ??
              matches[category].get(key)?.match !== "name",
          )
        : null,
    [eppo, matches, existing, project, datasource, selection],
  );

  const getItems = (category: EppoCategory): ImportItem<unknown>[] =>
    (data?.[category] ?? []).map((item) => ({
      ...item,
      ...results[itemId(category, item.key)],
    }));
  const selectable = (category: EppoCategory) =>
    getItems(category).filter(
      (item) => item.status !== "invalid" && !untouched(category, item),
    );
  const selectedItems = CATEGORIES.flatMap(({ key }) =>
    selectable(key)
      .filter((item) => isSelected(key, item.key))
      .map((item) => ({ category: key, item })),
  );
  const selectedCount = selectedItems.length;
  const updating = selectedItems.filter(
    ({ category, item }) => item.existingId && !UNTOUCHED.includes(category),
  );
  const updateCount = updating.filter(
    ({ item }) => item.match === "run",
  ).length;
  const overwriteCount = updating.filter(
    ({ item }) => item.match === "name",
  ).length;
  const setSelected = (ids: string[], selected: boolean) =>
    setSelection((prev) => {
      const next = { ...prev };
      ids.forEach((id) => (next[id] = selected));
      return next;
    });

  const fetchData = async () => {
    track("Eppo import fetch started", { source: "eppo" });
    setBusy("fetching");
    setError(null);
    try {
      const [data] = await Promise.all([
        fetchEppoData(apiKey, apiCall, {
          createdSince: createdSince ? new Date(createdSince) : null,
        }),
        mutateDefinitions(),
        mutateFeatures(),
        mutateExperiments(),
        mutateRuns(),
      ]);
      setEppo(data);
      setResults({});
      setSelection({});
    } catch (e) {
      setError(e.message);
    }
    setBusy(null);
  };

  const runImport = async () => {
    if (!data || !eppo) return;
    track("Eppo import started", { source: "eppo", items: selectedCount });
    setBusy("importing");
    setError(null);

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
              description: "Created by the Eppo importer",
            }),
          },
        );
        projectId = created.project.id;
      }
      const outcome = await runEppoImport({
        data,
        eppo,
        isSelected,
        existing,
        project: projectId,
        datasource: datasource ?? null,
        attributeSchema,
        apiCall,
        setItem: (category, key, update) => {
          const id = itemId(category, key);
          pending[id] = { ...pending[id], ...update };
        },
      });
      runId = outcome.runId;
      track("Eppo import finished", {
        source: "eppo",
        completed: outcome.completed,
        failed: outcome.failed,
      });
    } catch (e) {
      setError(e.message);
    }
    window.clearInterval(timer);
    flush();
    await Promise.all([
      mutateDefinitions(),
      mutateFeatures(),
      mutateExperiments(),
      mutateRuns(),
      refreshOrganization(),
    ]);
    setBusy(null);
    if (runId) router.push(`/auto-runs/${runId}`);
  };

  const nonStringFlags = eppo?.flags.some((f) => f.variation_type !== "STRING");

  return (
    <Box>
      <Frame>
        <Grid columns={{ initial: "1", md: "2" }} gap="4">
          <TextField
            label="API key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            helpText="REST API key from Eppo Admin > API Keys"
          />
          <TextField
            label="GrowthBook Project"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="All Projects"
            helpText={
              newProjectName
                ? `"${newProjectName}" will be created`
                : "An existing Project, or a new one to create. Leave blank for All Projects."
            }
          />
          <SelectField
            label="Data Source"
            value={datasourceId}
            initialOption="None"
            options={datasources.map((ds) => ({
              label: ds.name,
              value: ds.id,
            }))}
            onChange={setDatasourceId}
            helpText="Required to import Fact Tables, Fact Metrics and experiment results"
          />
          <DatePicker
            label="Created on or after"
            size="md"
            containerClassName=""
            date={createdSince ? new Date(createdSince) : undefined}
            setDate={changeCreatedSince}
            precision="date"
            timeZone="local"
            disableAfter={new Date()}
            clearButton
            helpText="Only experiments and Feature Flags created on or after this day. Flags with no created date are kept. Leave blank for all."
          />
        </Grid>
        <Flex gap="3" mt="4">
          <Button
            variant={data ? "outline" : "solid"}
            disabled={!apiKey || !!busy}
            loading={busy === "fetching"}
            onClick={fetchData}
          >
            Fetch from Eppo
          </Button>
          <Button
            disabled={!selectedCount || !!busy}
            loading={busy === "importing"}
            onClick={runImport}
          >
            {`Import ${selectedCount} item${selectedCount === 1 ? "" : "s"}`}
          </Button>
        </Flex>
      </Frame>

      {error ? (
        <Callout status="error" mb="4">
          {error}
        </Callout>
      ) : null}

      {updateCount ? (
        <Callout status="info" mb="4">
          {`${updateCount} selected ${
            updateCount === 1 ? "item" : "items"
          } from earlier imports will be updated to match Eppo.`}
          {updating.some(({ category }) => category === "flags")
            ? " Rules on an existing Feature Flag are replaced; owners, tags and Projects are kept."
            : ""}
        </Callout>
      ) : null}

      {overwriteCount ? (
        <Callout status="warning" mb="4">
          {`${overwriteCount} selected ${
            overwriteCount === 1 ? "item was" : "items were"
          } not created by an Eppo import and only ${
            overwriteCount === 1 ? "shares" : "share"
          } a name or key with the Eppo item. Importing overwrites ${
            overwriteCount === 1 ? "it" : "them"
          } with Eppo's definition.`}
        </Callout>
      ) : null}

      {nonStringFlags ? (
        <Callout status="info" mb="4">
          Eppo&apos;s API doesn&apos;t return variation values, so each
          variation uses its key as the value. Non-string Feature Flags whose
          keys aren&apos;t values of their type are marked &quot;Can&apos;t
          import&quot;.
        </Callout>
      ) : null}

      {data && CATEGORIES.every(({ key }) => !data[key].length) ? (
        <Callout status="info" mb="4">
          Eppo returned nothing to import for this API key.
        </Callout>
      ) : null}

      {data
        ? CATEGORIES.map(({ key: category, label }) => {
            const items = getItems(category);
            if (!items.length) return null;
            const ids = selectable(category).map((i) =>
              itemId(category, i.key),
            );
            const selected = selectable(category).filter((i) =>
              isSelected(category, i.key),
            ).length;
            const href = HREFS[category];
            const unchanged = items.filter((item) =>
              untouched(category, item),
            ).length;
            return (
              <Frame key={category}>
                <Checkbox
                  label={`${label} (${ids.length})${
                    unchanged > 0 ? ` · ${unchanged} unchanged` : ""
                  }`}
                  value={
                    selected === ids.length && selected > 0
                      ? true
                      : selected
                        ? "indeterminate"
                        : false
                  }
                  setValue={(v) => setSelected(ids, v)}
                  disabled={!ids.length}
                  mb="3"
                />
                <Box style={{ maxHeight: 600, overflowY: "auto" }}>
                  <Table size="sm">
                    <TableHeader>
                      <TableRow>
                        <TableColumnHeader style={{ width: 40 }}>
                          <VisuallyHidden>Select</VisuallyHidden>
                        </TableColumnHeader>
                        <TableColumnHeader>Name</TableColumnHeader>
                        <TableColumnHeader style={{ width: 140 }}>
                          Status
                        </TableColumnHeader>
                        <TableColumnHeader style={{ width: 100 }}>
                          <VisuallyHidden>Preview</VisuallyHidden>
                        </TableColumnHeader>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item) => {
                        const id = itemId(category, item.key);
                        return (
                          <Fragment key={id}>
                            <TableRow>
                              <TableCell>
                                {untouched(category, item) ? null : (
                                  <Checkbox
                                    size="sm"
                                    label={
                                      <VisuallyHidden>
                                        {item.name}
                                      </VisuallyHidden>
                                    }
                                    value={
                                      item.status !== "invalid" &&
                                      isSelected(category, item.key)
                                    }
                                    setValue={(v) => setSelected([id], v)}
                                    disabled={item.status === "invalid"}
                                  />
                                )}
                              </TableCell>
                              <TableRowHeaderCell>
                                {item.name}
                                {item.existingId && href ? (
                                  <HelperText status="info" size="sm">
                                    {item.match === "name"
                                      ? "Same name as "
                                      : "Imported before as "}
                                    <Link href={href(item.existingId)} external>
                                      {item.name}
                                    </Link>
                                  </HelperText>
                                ) : item.existingId ? (
                                  <HelperText status="info" size="sm">
                                    Already in GrowthBook
                                  </HelperText>
                                ) : null}
                                {item.error ? (
                                  <HelperText status="error" size="sm">
                                    {item.error}
                                  </HelperText>
                                ) : null}
                              </TableRowHeaderCell>
                              <TableCell>
                                <StatusBadge item={item} category={category} />
                              </TableCell>
                              <TableCell>
                                <Link
                                  aria-expanded={expanded === id}
                                  onClick={() =>
                                    setExpanded(expanded === id ? null : id)
                                  }
                                >
                                  {expanded === id ? "Hide JSON" : "View JSON"}
                                </Link>
                              </TableCell>
                            </TableRow>
                            {expanded === id ? (
                              <TableRow>
                                <TableCell colSpan={4}>
                                  <Grid
                                    columns={{ initial: "1", md: "2" }}
                                    gap="3"
                                  >
                                    <Code
                                      language="json"
                                      filename="Eppo"
                                      code={JSON.stringify(item.eppo, null, 2)}
                                      maxHeight="400px"
                                    />
                                    <Code
                                      language="json"
                                      filename="GrowthBook"
                                      code={JSON.stringify(
                                        item.preview ?? null,
                                        null,
                                        2,
                                      )}
                                      maxHeight="400px"
                                    />
                                  </Grid>
                                </TableCell>
                              </TableRow>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Box>
              </Frame>
            );
          })
        : null}
    </Box>
  );
}
