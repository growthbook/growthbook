import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Flex, Grid } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import { populationEndpoints } from "shared/api-endpoints";
import { isProjectListValidForProject } from "shared/util";
import type { ApiPopulation, PopulationStep } from "shared/validators";
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
import Field from "@/components/Forms/Field";
import DataSourcePicker from "@/components/DataSourcePicker";
import { RowFilterInput } from "@/components/FactTables/RowFilterInput";
import ThresholdBasisRow from "@/components/FactTables/MetricEditor/typeFields/ThresholdBasisRow";
import PopulationPreview from "@/components/Populations/PopulationPreview";
import useFullFactTable from "@/hooks/useFullFactTable";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useRestApiCall } from "@/services/restApi";

type PopulationFormValues = {
  name: string;
  description: string;
  datasource: string;
  userIdTypes: string[];
  factTableId: string;
  rowFilters: RowFilter[];
  aggregateFilterColumn: string;
  aggregateFilter: string;
};

// The MVP edits a single step, so the form flattens it into top-level fields.
function toFormValues(
  existing: ApiPopulation | null,
  defaultDatasource: string,
): PopulationFormValues {
  const step = existing?.steps[0];
  return {
    name: existing?.name ?? "",
    description: existing?.description ?? "",
    datasource: existing?.datasource ?? defaultDatasource,
    userIdTypes: existing?.userIdTypes ?? [],
    factTableId: step?.source.factTableId ?? "",
    rowFilters: step?.rowFilters ?? [],
    aggregateFilterColumn: step?.aggregateFilterColumn ?? "",
    aggregateFilter: step?.aggregateFilter ?? "",
  };
}

function toStep(values: PopulationFormValues): PopulationStep {
  const hasThreshold = values.aggregateFilter.trim() !== "";
  return {
    source: { type: "factTable", factTableId: values.factTableId },
    rowFilters: values.rowFilters,
    ...(hasThreshold && {
      aggregateFilter: values.aggregateFilter.trim(),
      aggregateFilterColumn: values.aggregateFilterColumn || "$$count",
    }),
  };
}

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
  const [error, setError] = useState<string | null>(null);

  const isNew = !existing;
  // An existing Population keeps access to its fact table even when it sits
  // outside the selected Project.
  const availableFactTables = isNew
    ? factTables.filter((ft) =>
        isProjectListValidForProject(ft.projects, project),
      )
    : factTables;
  const datasourcesWithFactTables = datasources.filter((d) =>
    availableFactTables.some((ft) => ft.datasource === d.id),
  );

  const form = useForm<PopulationFormValues>({
    defaultValues: toFormValues(
      existing,
      datasourcesWithFactTables[0]?.id ?? "",
    ),
  });
  const values = form.watch();
  const [showDescription, setShowDescription] = useState(!!values.description);
  const [showThreshold, setShowThreshold] = useState(!!values.aggregateFilter);

  const { factTable } = useFullFactTable(values.factTableId || null);
  const factTablesInDatasource = availableFactTables.filter(
    (ft) => ft.datasource === values.datasource,
  );
  const isComplete = !!values.factTableId && values.userIdTypes.length > 0;

  // Rebuilt only when the definition changes, so the preview doesn't see a new
  // draft on every render.
  const draftKey = JSON.stringify([
    values.datasource,
    values.userIdTypes,
    isComplete ? toStep(values) : null,
  ]);
  const draft = useMemo(
    () => ({
      datasource: values.datasource,
      userIdTypes: values.userIdTypes,
      steps: isComplete ? [toStep(values)] : [],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draftKey],
  );

  function changeDatasource(datasource: string) {
    form.reset({ ...toFormValues(null, datasource), name: values.name });
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
    form.setValue("aggregateFilterColumn", "");
  }

  async function save() {
    if (!values.name.trim()) throw new Error("Name is required");
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
            projects: getFactTableById(values.factTableId)?.projects ?? [],
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
          <Button onClick={save} setError={setError} disabled={!isComplete}>
            Save Population
          </Button>
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
                  onChange={(e) => form.setValue("description", e.target.value)}
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
                {factTablesInDatasource.map((ft) => (
                  <SelectItem key={ft.id} value={ft.id}>
                    {ft.name}
                  </SelectItem>
                ))}
              </Select>
              {factTable && (
                <>
                  <MultiSelectField
                    label="Identifier types"
                    value={values.userIdTypes}
                    options={factTable.userIdTypes.map((t) => ({
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
                  {showThreshold ? (
                    <Flex align="end" gap="3" wrap="wrap">
                      <ThresholdBasisRow
                        value={{
                          aggregateFilterColumn: values.aggregateFilterColumn,
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
            </Flex>
          </Frame>
        </Flex>

        <Frame
          px="5"
          py="5"
          mb="0"
          minWidth="0"
          style={{ position: "sticky", top: 72, alignSelf: "start" }}
        >
          <PopulationPreview population={draft} />
        </Frame>
      </Grid>
    </Flex>
  );
}
