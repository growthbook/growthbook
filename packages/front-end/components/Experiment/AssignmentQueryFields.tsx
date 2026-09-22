import { useEffect, useMemo } from "react";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import {
  getDefaultIdentifierType,
  getExposureQueriesForProject,
  getExposureQueryIdentifierTypes,
  getGroupedIdentifierTypeOptions,
  getHashAttributeIdentifierTypeMap,
  getSelectableIdentifierTypes,
} from "@/services/datasources";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";

type Selection = {
  identifierTypes: string[];
  groupedIdentifierTypes: (GroupedValue | SingleValue)[];
  exposureQueryOptions: SingleValue[];
};

export function useAssignmentQuerySelection({
  datasource,
  project,
  hashAttribute,
  exposureQueryId,
  identifierType,
  setExposureQueryId,
  setIdentifierType,
  enabled = true,
}: {
  datasource: DataSourceInterfaceWithParams | null | undefined;
  project: string | undefined;
  hashAttribute: string | undefined;
  exposureQueryId: string | undefined;
  identifierType: string | undefined;
  setExposureQueryId: (exposureQueryId: string) => void;
  setIdentifierType: (identifierType: string | undefined) => void;
  enabled?: boolean;
}): Selection {
  const exposureQueries = useMemo(
    () =>
      getExposureQueriesForProject(
        datasource?.settings?.queries?.exposure ?? [],
        project,
      ),
    [datasource?.settings?.queries?.exposure, project],
  );
  const hashAttributeIdentifierTypeMap = useMemo(
    () => getHashAttributeIdentifierTypeMap(datasource?.settings?.userIdTypes),
    [datasource?.settings?.userIdTypes],
  );
  const identifierTypes = useMemo(
    () => getSelectableIdentifierTypes(exposureQueries),
    [exposureQueries],
  );
  const groupedIdentifierTypes = useMemo(
    () =>
      getGroupedIdentifierTypeOptions({
        identifierTypes,
        hashAttributeIdentifierTypeMap,
        hashAttribute,
      }),
    [identifierTypes, hashAttributeIdentifierTypeMap, hashAttribute],
  );
  const exposureQueryOptions = useMemo(
    () =>
      exposureQueries
        .filter(
          (query) =>
            !identifierType ||
            getExposureQueryIdentifierTypes(query).includes(identifierType),
        )
        .map((query) => ({ label: query.name, value: query.id })),
    [exposureQueries, identifierType],
  );

  // Repair the identifier before the query; selectable queries depend on it.
  useEffect(() => {
    if (!enabled) return;
    if (!identifierType || !identifierTypes.includes(identifierType)) {
      setIdentifierType(
        getDefaultIdentifierType({
          identifierTypes,
          hashAttributeIdentifierTypeMap,
          hashAttribute,
        }),
      );
      return;
    }
    if (
      !exposureQueryOptions.some((option) => option.value === exposureQueryId)
    ) {
      setExposureQueryId(exposureQueryOptions[0]?.value ?? "");
    }
  }, [
    enabled,
    exposureQueryId,
    identifierType,
    exposureQueryOptions,
    identifierTypes,
    hashAttributeIdentifierTypeMap,
    hashAttribute,
    setExposureQueryId,
    setIdentifierType,
  ]);

  return { identifierTypes, groupedIdentifierTypes, exposureQueryOptions };
}

export default function AssignmentQueryFields({
  selection,
  exposureQueryId,
  identifierType,
  setExposureQueryId,
  setIdentifierType,
  initialOption,
}: {
  selection: Selection;
  exposureQueryId: string | undefined;
  identifierType: string | undefined;
  setExposureQueryId: (exposureQueryId: string) => void;
  setIdentifierType: (identifierType: string) => void;
  initialOption?: string;
}) {
  const { identifierTypes, groupedIdentifierTypes, exposureQueryOptions } =
    selection;
  return (
    <>
      <SelectField
        label={
          <>
            Identifier type{" "}
            <Tooltip body="The unit this experiment is analyzed on. Should correspond to the attribute used to randomize units for this experiment." />
          </>
        }
        labelClassName="font-weight-bold"
        helpText={
          identifierTypes.length === 0
            ? "No assignment queries are scoped to this project. Add one in the Data Source settings."
            : undefined
        }
        value={identifierType ?? ""}
        onChange={(value) => {
          // The repair effect picks a query for the new identifier.
          if (value !== identifierType) setIdentifierType(value);
        }}
        initialOption={initialOption}
        required
        sort={false}
        options={groupedIdentifierTypes}
      />
      <SelectField
        label={
          <>
            Experiment Assignment Table{" "}
            <Tooltip body="The query that records which units saw which variation." />
          </>
        }
        labelClassName="font-weight-bold"
        helpText={
          identifierType && exposureQueryOptions.length === 0
            ? `No assignment queries declare the "${identifierType}" identifier type.`
            : undefined
        }
        value={exposureQueryId ?? ""}
        onChange={setExposureQueryId}
        initialOption={initialOption}
        required
        sort={false}
        options={exposureQueryOptions}
      />
    </>
  );
}
