import React, { Fragment, useMemo, useState } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import {
  buildImportData,
  CATEGORIES,
  EppoCategory,
  EppoData,
  ExistingIds,
  fetchEppoData,
  getColumnNames,
  ImportItem,
  ImportResult,
  runEppoImport,
} from "@/services/importing/eppo/eppo-importing";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAttributeSchema, useEnvironments } from "@/services/features";
import { useFeatureMetaInfo } from "@/hooks/useFeatureMetaInfo";
import { useExperiments } from "@/hooks/useExperiments";
import { useUser } from "@/services/UserContext";
import { useSessionStorage } from "@/hooks/useSessionStorage";
import track from "@/services/track";
import Heading from "@/ui/Heading";
import Frame from "@/ui/Frame";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import SelectField from "@/components/Forms/SelectField";
import Code from "@/components/SyntaxHighlighting/Code";

const itemId = (category: EppoCategory, key: string) => `${category}:${key}`;

function StatusBadge({ item }: { item: ImportItem<unknown> }) {
  switch (item.status) {
    case "invalid":
      return <Badge color="red" label="Can't import" />;
    case "failed":
      return <Badge color="red" label="Failed" />;
    case "completed":
      return <Badge color="green" label="Imported" />;
    case "pending":
      return (
        <Badge color="gray" label={item.existingId ? "Update" : "Create"} />
      );
  }
}

export default function ImportFromEppo() {
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
    mutateDefinitions,
  } = useDefinitions();
  const environments = useEnvironments();
  const attributeSchema = useAttributeSchema();
  const { features, mutate: mutateFeatures } = useFeatureMetaInfo();
  const { experiments, mutateExperiments } = useExperiments("", true);

  const [apiKey, setApiKey] = useSessionStorage("eppoApiKey", "");
  const [project, setProject] = useState("");
  const [datasourceId, setDatasourceId] = useState(datasources[0]?.id ?? "");
  const datasource = getDatasourceById(datasourceId);

  const [eppo, setEppo] = useState<EppoData | null>(null);
  const [busy, setBusy] = useState<"fetching" | "importing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ImportResult>>({});
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);

  const existing: ExistingIds = useMemo(
    () => ({
      environments: new Set(environments.map((e) => e.id)),
      tags: new Set(tags.map((t) => t.id)),
      savedGroups: new Map(savedGroups.map((sg) => [sg.groupName, sg.id])),
      features: new Set(features.map((f) => f.id)),
      factTables: new Map(
        factTables
          .filter((ft) => ft.datasource === datasourceId)
          .map((ft) => [ft.name, ft.id]),
      ),
      factTableColumns: new Map(
        factTables.map((ft) => [ft.id, getColumnNames(ft.columns)]),
      ),
      factMetrics: new Map(
        factMetrics
          .filter((m) => m.datasource === datasourceId)
          .map((m) => [m.name, m.id]),
      ),
      experiments: new Map(
        experiments
          .filter((e) => e.trackingKey)
          .map((e) => [e.trackingKey, e.id]),
      ),
    }),
    [
      environments,
      tags,
      savedGroups,
      features,
      factTables,
      factMetrics,
      experiments,
      datasourceId,
    ],
  );

  // Rebuilt when the project, Data Source, or existing GrowthBook data changes
  const data = useMemo(
    () =>
      eppo
        ? buildImportData(eppo, existing, project, datasource ?? null)
        : null,
    [eppo, existing, project, datasource],
  );

  const getItems = (category: EppoCategory): ImportItem<unknown>[] =>
    (data?.[category] ?? []).map((item) => ({
      ...item,
      ...results[itemId(category, item.key)],
    }));
  const isSelected = (category: EppoCategory, key: string) =>
    !deselected.has(itemId(category, key));
  const selectable = (category: EppoCategory) =>
    getItems(category).filter((item) => item.status !== "invalid");
  const selectedCount = CATEGORIES.reduce(
    (sum, { key }) =>
      sum + selectable(key).filter((i) => isSelected(key, i.key)).length,
    0,
  );
  const setSelected = (ids: string[], selected: boolean) =>
    setDeselected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (selected ? next.delete(id) : next.add(id)));
      return next;
    });

  const fetchData = async () => {
    track("Eppo import fetch started", { source: "eppo" });
    setBusy("fetching");
    setError(null);
    try {
      setEppo(await fetchEppoData(apiKey, apiCall));
      setResults({});
      setDeselected(new Set());
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

    // Apply progress a few times a second; re-rendering every table once per
    // finished item can't keep up on large imports
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

    try {
      await runEppoImport({
        data,
        eppo,
        isSelected,
        existing,
        project,
        datasource: datasource ?? null,
        attributeSchema,
        apiCall,
        setItem: (category, key, update) => {
          const id = itemId(category, key);
          pending[id] = { ...pending[id], ...update };
        },
      });
    } catch (e) {
      setError(e.message);
    }
    window.clearInterval(timer);
    flush();
    // Refresh existing ids so a re-run updates instead of duplicating
    await Promise.all([
      mutateDefinitions(),
      mutateFeatures(),
      mutateExperiments(),
      refreshOrganization(),
    ]);
    setBusy(null);
  };

  const missingVariationValues = eppo?.flags.some((f) =>
    f.variations?.some((v) => v.value === undefined),
  );

  return (
    <Box>
      <Heading as="h1" size="2xl" mb="4">
        Eppo Importer
      </Heading>
      <Frame>
        <Grid columns={{ initial: "1", md: "3" }} gap="4">
          <TextField
            label="API key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            helpText="REST API key from Eppo Admin > API Keys"
          />
          <SelectField
            label="GrowthBook Project"
            value={project}
            initialOption="All Projects"
            options={projects.map((p) => ({ label: p.name, value: p.id }))}
            onChange={setProject}
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
            helpText="Required to import fact sources and metrics"
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

      {missingVariationValues ? (
        <Callout status="warning" mb="4">
          Eppo&apos;s API doesn&apos;t return variation values, so each Feature
          Flag variation uses its key as the value. Check non-string Feature
          Flags after importing.
        </Callout>
      ) : null}

      {data
        ? CATEGORIES.map(({ key: category, label }) => {
            const items = getItems(category);
            if (!items.length) return null;
            const ids = selectable(category).map((i) =>
              itemId(category, i.key),
            );
            const selected = ids.filter((id) => !deselected.has(id)).length;
            return (
              <Frame key={category}>
                <Checkbox
                  label={`${label} (${items.length})`}
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
                        <TableColumnHeader style={{ width: 40 }} />
                        <TableColumnHeader>Name</TableColumnHeader>
                        <TableColumnHeader style={{ width: 140 }}>
                          Status
                        </TableColumnHeader>
                        <TableColumnHeader style={{ width: 80 }} />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item) => {
                        const id = itemId(category, item.key);
                        return (
                          <Fragment key={id}>
                            <TableRow>
                              <TableCell>
                                <Checkbox
                                  value={
                                    item.status !== "invalid" &&
                                    isSelected(category, item.key)
                                  }
                                  setValue={(v) => setSelected([id], v)}
                                  disabled={item.status === "invalid"}
                                />
                              </TableCell>
                              <TableCell>
                                {item.name}
                                {item.error ? (
                                  <Text as="div" size="sm" color="text-low">
                                    {item.error}
                                  </Text>
                                ) : null}
                              </TableCell>
                              <TableCell>
                                <StatusBadge item={item} />
                              </TableCell>
                              <TableCell>
                                <Link
                                  onClick={() =>
                                    setExpanded(expanded === id ? null : id)
                                  }
                                >
                                  {expanded === id ? "Hide" : "View"}
                                </Link>
                              </TableCell>
                            </TableRow>
                            {expanded === id ? (
                              <TableRow>
                                <TableCell colSpan={4}>
                                  <Grid columns="2" gap="3">
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
