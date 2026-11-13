import { useState } from "react";
import { useForm } from "react-hook-form";
import { Flex, Grid } from "@radix-ui/themes";
import { upperFirst } from "lodash";
import { PiPlus } from "react-icons/pi";
import { populationEndpoints } from "shared/api-endpoints";
import {
  getPopulationRuleViolations,
  getRowFilterViolation,
} from "shared/populations";
import type { ApiPopulation } from "shared/validators";
import type { RowFilter } from "shared/types/fact-table";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import MultiSelectField from "@/ui/MultiSelectField";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import Tooltip from "@/ui/Tooltip";
import Field from "@/components/Forms/Field";
import DataSourcePicker from "@/components/DataSourcePicker";
import { RowFilterInput } from "@/components/FactTables/RowFilterInput";
import ThresholdBasisRow from "@/components/FactTables/MetricEditor/typeFields/ThresholdBasisRow";
import PopulationPreview from "@/components/Populations/PopulationPreview";
import {
  type PopulationFormValues,
  toFormValues,
  toStep,
} from "@/components/Populations/populationUtils";
import useFullFactTable from "@/hooks/useFullFactTable";
import useDebouncedValue from "@/hooks/useDebouncedValue";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { getNewExperimentDatasourceDefaults } from "@/services/datasources";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useRestApiCall } from "@/services/restApi";

export default function PopulationEditor({
  existing,
  onSaved,
  onCancel,
}: {
  existing: ApiPopulation | null;
  onSaved: (population: ApiPopulation) => Promise<unknown> | void;
  onCancel: () => void;
}) {
  const { datasources, factTables, project, getFactTableById } =
    useDefinitions();
  const restApiCall = useRestApiCall();
  const permissionsUtil = usePermissionsUtil();
  const settings = useOrgSettings();
  const [error, setError] = useState<string | null>(null);

  const isNew = !existing;
  // Like the metric editor, the selected Project doesn't narrow the list. A new
  // Population takes its fact table's Projects, so only offer fact tables the
  // user can create a Population from.
  const availableFactTables = isNew
    ? factTables.filter((ft) =>
        permissionsUtil.canCreatePopulation({ projects: ft.projects }),
      )
    : factTables;
  const datasourcesWithFactTables = datasources.filter((d) =>
    availableFactTables.some((ft) => ft.datasource === d.id),
  );

  const form = useForm<PopulationFormValues>({
    defaultValues: toFormValues(
      existing,
      // Same default as a new metric, falling back to any Data Source with a
      // usable fact table.
      getNewExperimentDatasourceDefaults({
        datasources: datasourcesWithFactTables,
        settings,
        project,
      }).datasource ||
        datasourcesWithFactTables[0]?.id ||
        "",
    ),
  });
  const values = form.watch();
  const [showDescription, setShowDescription] = useState(!!values.description);
  const [showThreshold, setShowThreshold] = useState(!!values.aggregateFilter);

  const { factTable } = useFullFactTable(values.factTableId || null);
  const factTablesInDatasource = availableFactTables.filter(
    (ft) => ft.datasource === values.datasource,
  );
  // The definitions list leaves out archived fact tables, so add the saved one
  // back or the select shows nothing.
  const selectedFactTable = getFactTableById(values.factTableId);
  const factTableOptions = selectedFactTable?.archived
    ? [...factTablesInDatasource, selectedFactTable]
    : factTablesInDatasource;
  // Keep saved identifier types the fact table no longer supports, so they
  // show up and can be removed.
  const idTypeOptions = factTable
    ? [...new Set([...factTable.userIdTypes, ...values.userIdTypes])]
    : [];
  const isFilterComplete = (filter: RowFilter) =>
    getRowFilterViolation(filter, factTable ?? undefined) === null;
  // A saved filter deleted from the fact table still looks filled in, so the
  // cue says where to look.
  const hasUnfinishedSavedFilter = values.rowFilters.some(
    (filter) => filter.operator === "saved_filter" && !isFilterComplete(filter),
  );
  const missing = {
    name: !values.name.trim(),
    factTable: !values.factTableId,
    // Only asked for once a fact table is chosen, since choosing one fills it in.
    identifierType: !!values.factTableId && values.userIdTypes.length === 0,
    // An unfinished filter adds no SQL, so the query would ignore it.
    rowFilters: !values.rowFilters.every(isFilterComplete),
    // toStep drops a threshold with no comparison.
    comparison: showThreshold && !values.aggregateFilter.trim(),
  };

  // The same rules the server enforces on save. They need a fact table and
  // identifier types to check against.
  const problems =
    missing.factTable || missing.identifierType
      ? []
      : getPopulationRuleViolations({
          datasource: values.datasource,
          userIdTypes: values.userIdTypes,
          // Unfinished filters already block Save through missing.rowFilters
          // and get their own cue, so the rules only see finished ones.
          steps: [
            toStep({
              ...values,
              rowFilters: values.rowFilters.filter(isFilterComplete),
            }),
          ],
          factTables: factTable ? [factTable] : [],
        });

  // The preview runs without a name; saving needs one.
  const canPreview =
    !missing.factTable &&
    !missing.identifierType &&
    !missing.rowFilters &&
    !missing.comparison &&
    problems.length === 0;
  const canSave = canPreview && !missing.name;

  // Explains a disabled Save. Rule problems are already listed under
  // Definition.
  const missingFields: string[] = [];
  if (missing.name) missingFields.push("enter a name");
  if (missing.factTable) missingFields.push("select a fact table");
  if (missing.identifierType) missingFields.push("select an identifier type");
  if (missing.rowFilters) {
    missingFields.push("finish or remove unfinished row filters");
  }
  if (missing.comparison) missingFields.push("enter a threshold comparison");
  const missingMessage = missingFields.length
    ? upperFirst(
        new Intl.ListFormat("en", { type: "conjunction" }).format(
          missingFields,
        ),
      )
    : null;
  // Save reacts at once, but new problems wait until typing pauses so a
  // half-typed comparison like ">" doesn't flash an error. Fixes clear at once.
  const debouncedProblems = useDebouncedValue(
    JSON.stringify(problems),
    problems,
  );
  const visibleProblems = problems.length ? debouncedProblems : [];

  const liveDraft = {
    datasource: values.datasource,
    userIdTypes: values.userIdTypes,
    steps: canPreview ? [toStep(values)] : [],
  };
  const debouncedDraft = useDebouncedValue(
    JSON.stringify(liveDraft),
    liveDraft,
  );
  // Like the metric editor, an invalid draft disables the preview at once
  // instead of after the delay.
  const draft = canPreview ? debouncedDraft : liveDraft;

  function changeDatasource(datasource: string) {
    form.reset({
      ...toFormValues(null, datasource),
      name: values.name,
      description: values.description,
    });
    setShowThreshold(false);
  }

  function removeThreshold() {
    form.setValue("aggregateFilterColumn", "");
    form.setValue("aggregateFilter", "");
    setShowThreshold(false);
  }

  function changeFactTable(factTableId: string) {
    const supportedIdTypes = getFactTableById(factTableId)?.userIdTypes ?? [];
    const keptIdTypes = values.userIdTypes.filter((t) =>
      supportedIdTypes.includes(t),
    );
    form.setValue("factTableId", factTableId);
    form.setValue(
      "userIdTypes",
      keptIdTypes.length ? keptIdTypes : supportedIdTypes.slice(0, 1),
    );
    form.setValue("rowFilters", []);
    // The threshold's column belongs to the old fact table, and keeping only
    // its comparison would quietly turn it into a row count.
    removeThreshold();
  }

  async function save() {
    const body = {
      name: values.name.trim(),
      description: values.description,
      userIdTypes: values.userIdTypes,
      steps: [toStep(values)],
    };
    if (existing) {
      const { population } = await restApiCall(
        populationEndpoints.updatePopulation,
        { params: { id: existing.id }, body },
      );
      await onSaved(population);
    } else {
      // Like new Fact Metrics, a new Population starts in its fact table's Projects.
      const { population } = await restApiCall(
        populationEndpoints.createPopulation,
        {
          body: {
            ...body,
            datasource: values.datasource,
            projects: factTable?.projects ?? [],
          },
        },
      );
      await onSaved(population);
    }
  }

  return (
    <Flex direction="column" gap="3">
      <Flex align="center" justify="between" gap="3" wrap="wrap">
        <Flex align="center" gap="3" wrap="wrap">
          <Heading as="h1" mb="0">
            {isNew ? "New Population" : `Edit ${existing.name}`}
          </Heading>
          {isNew && (
            <Badge label="Draft" color="pink" variant="solid" radius="full" />
          )}
        </Flex>
        <Flex gap="2">
          <Button variant="soft" color="gray" onClick={onCancel}>
            Cancel
          </Button>
          <Tooltip content={missingMessage} enabled={!!missingMessage}>
            {/* A disabled button gets no hover events, so the span triggers the tooltip. */}
            <span tabIndex={missingMessage ? 0 : undefined}>
              <Button onClick={save} setError={setError} disabled={!canSave}>
                Save Population
              </Button>
            </span>
          </Tooltip>
        </Flex>
      </Flex>

      {isNew && (
        <Flex mt="-2">
          <DataSourcePicker
            value={values.datasource}
            options={datasourcesWithFactTables}
            onChange={changeDatasource}
            confirmMessage={
              values.factTableId
                ? (name) =>
                    `Changing the Data Source clears the definition. Switch to "${name}"?`
                : null
            }
          />
        </Flex>
      )}

      {error && <Callout status="error">{error}</Callout>}

      {isNew && !datasourcesWithFactTables.length ? (
        <Callout status="info">
          There are no fact tables you can create a Population from.{" "}
          <Link href="/fact-tables">Go to fact tables</Link>
        </Callout>
      ) : (
        <Grid columns={{ initial: "1", md: "minmax(0, 1fr) 420px" }} gap="4">
          <Flex direction="column" gap="4" minWidth="0">
            <Frame px="4" py="4" mb="0">
              <Heading as="h4" size="sm" mb="3">
                Details
              </Heading>
              <Flex direction="column" gap="3">
                <TextField
                  label="Name"
                  autoFocus
                  markRequired
                  value={values.name}
                  onChange={(e) => form.setValue("name", e.target.value)}
                />
                {showDescription ? (
                  <Field
                    label="Description"
                    textarea
                    value={values.description}
                    onChange={(e) =>
                      form.setValue("description", e.target.value)
                    }
                  />
                ) : (
                  <Flex direction="column" align="start" gap="3">
                    <Text weight="semibold">Description</Text>
                    <Link size="sm" onClick={() => setShowDescription(true)}>
                      + Add a description
                    </Link>
                  </Flex>
                )}
              </Flex>
            </Frame>

            <Frame px="4" py="4" mb="0">
              <Heading as="h4" size="sm" mb="3">
                Definition
              </Heading>
              <Flex direction="column" gap="3">
                <Text color="text-mid">
                  Include every unit with matching rows in a fact table.
                </Text>
                <Select
                  label="Fact table"
                  placeholder="Select a fact table"
                  value={values.factTableId}
                  setValue={changeFactTable}
                >
                  {factTableOptions.map((ft) => (
                    <SelectItem key={ft.id} value={ft.id}>
                      {ft.archived ? `${ft.name} (archived)` : ft.name}
                    </SelectItem>
                  ))}
                </Select>
                {factTable && (
                  <>
                    <MultiSelectField
                      label="Identifier types"
                      value={values.userIdTypes}
                      options={idTypeOptions.map((t) => ({
                        label: t,
                        value: t,
                      }))}
                      onChange={(userIdTypes) =>
                        form.setValue("userIdTypes", userIdTypes)
                      }
                    />
                    <RowFilterInput
                      factTable={factTable}
                      value={values.rowFilters}
                      setValue={(rowFilters) =>
                        form.setValue("rowFilters", rowFilters)
                      }
                    />
                    {missing.rowFilters && (
                      <Text size="sm" color="text-mid" as="p">
                        Finish or remove any unfinished filters.
                        {hasUnfinishedSavedFilter &&
                          " Select a saved filter, or check whether the selected one was deleted from the fact table."}
                      </Text>
                    )}
                    {showThreshold ? (
                      <Flex direction="column" gap="1">
                        <Flex align="end" gap="3" wrap="wrap">
                          <ThresholdBasisRow
                            value={{
                              aggregateFilterColumn:
                                values.aggregateFilterColumn,
                              aggregateFilter: values.aggregateFilter,
                            }}
                            onChange={(threshold) => {
                              form.setValue(
                                "aggregateFilterColumn",
                                threshold.aggregateFilterColumn ?? "",
                              );
                              form.setValue(
                                "aggregateFilter",
                                threshold.aggregateFilter ?? "",
                              );
                            }}
                            factTable={factTable}
                          />
                          <Link size="sm" mb="2" onClick={removeThreshold}>
                            Remove
                          </Link>
                        </Flex>
                        {missing.comparison && (
                          <Text size="sm" color="text-mid" as="p">
                            Enter a comparison, such as &quot;&gt;=3&quot;, or
                            remove the threshold.
                          </Text>
                        )}
                      </Flex>
                    ) : (
                      <Flex direction="column" align="start" gap="2">
                        <Text weight="semibold">Threshold</Text>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<PiPlus size={14} />}
                          onClick={() => setShowThreshold(true)}
                        >
                          Add threshold
                        </Button>
                      </Flex>
                    )}
                  </>
                )}
                {visibleProblems.length > 0 && (
                  <Callout status="error">
                    {visibleProblems.map((problem) => (
                      <div key={problem}>{problem}</div>
                    ))}
                  </Callout>
                )}
              </Flex>
            </Frame>
          </Flex>

          <Frame
            px="5"
            py="5"
            mb="0"
            minWidth="0"
            style={{
              position: "sticky",
              top: "calc(var(--page-top-offset) + 16px)",
              alignSelf: "start",
            }}
          >
            <PopulationPreview population={draft} />
          </Frame>
        </Grid>
      )}
    </Flex>
  );
}
