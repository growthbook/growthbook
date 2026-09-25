import { useCallback, useEffect, useMemo, useRef } from "react";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { getExposureQueryIdentifierTypes } from "shared/util";
import { PiWarningFill } from "react-icons/pi";
import {
  getAssignmentQueryDrift,
  getDefaultIdentifierType,
  getGroupedIdentifierTypeOptions,
  getHashAttributeIdentifierTypeMap,
  getIdentifierTypeForHashAttribute,
  getSelectableIdentifierTypes,
} from "@/services/datasources";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import Callout from "@/ui/Callout";

type Selection = {
  exposureQueryId: string | undefined;
  identifierType: string | undefined;
  identifierTypes: string[];
  groupedIdentifierTypes: (GroupedValue | SingleValue)[];
  exposureQueryOptions: SingleValue[];
  // A kept selection whose query no longer declares its identifier.
  identifierUndeclared: boolean;
  setExposureQueryId: (exposureQueryId: string) => void;
  changeIdentifierType: (identifierType: string) => void;
};

export function useAssignmentQuerySelection({
  datasource,
  hashAttribute,
  exposureQueryId,
  identifierType,
  setExposureQueryId,
  setIdentifierType,
  autoRepair = true,
  keepCurrentSelection = false,
}: {
  datasource: DataSourceInterfaceWithParams | null | undefined;
  hashAttribute: string | undefined;
  exposureQueryId: string | undefined;
  identifierType: string | undefined;
  setExposureQueryId: (exposureQueryId: string) => void;
  setIdentifierType: (identifierType: string | undefined) => void;
  // New records repair an invalid selection as inputs change; existing records
  // must not have saved settings rewritten on load.
  autoRepair?: boolean;
  // Keep a drifted selection listed so existing records show what they use.
  keepCurrentSelection?: boolean;
}): Selection {
  const keptQueryId = keepCurrentSelection ? exposureQueryId : undefined;
  const exposureQueries = useMemo(
    () => datasource?.settings?.queries?.exposure ?? [],
    [datasource],
  );
  const keptQuery = keptQueryId
    ? exposureQueries.find((q) => q.id === keptQueryId)
    : undefined;
  const { identifierUndeclared } = getAssignmentQueryDrift(
    keptQuery,
    identifierType,
  );
  const hashAttributeIdentifierTypeMap = useMemo(
    () => getHashAttributeIdentifierTypeMap(datasource?.settings?.userIdTypes),
    [datasource?.settings?.userIdTypes],
  );
  const identifierTypes = useMemo(() => {
    const selectable = getSelectableIdentifierTypes(exposureQueries);
    return keepCurrentSelection &&
      identifierType &&
      !selectable.includes(identifierType)
      ? [...selectable, identifierType]
      : selectable;
  }, [exposureQueries, keepCurrentSelection, identifierType]);
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
            query.id === keptQueryId ||
            !identifierType ||
            getExposureQueryIdentifierTypes(query).includes(identifierType),
        )
        .map((query) => ({ label: query.name, value: query.id })),
    [exposureQueries, identifierType, keptQueryId],
  );

  const changeIdentifierType = useCallback(
    (value: string) => {
      if (value === identifierType) return;
      setIdentifierType(value);
      const current = exposureQueries.find((q) => q.id === exposureQueryId);
      if (
        !current ||
        !getExposureQueryIdentifierTypes(current).includes(value)
      ) {
        setExposureQueryId(
          exposureQueries.find((q) =>
            getExposureQueryIdentifierTypes(q).includes(value),
          )?.id ?? "",
        );
      }
    },
    [
      identifierType,
      exposureQueryId,
      exposureQueries,
      setIdentifierType,
      setExposureQueryId,
    ],
  );

  // A hash attribute switch means the units changed, so follow it to a linked
  // identifier. The first value is the loaded one, not a switch, so saved
  // selections are left alone.
  const previousHashAttributeRef = useRef(hashAttribute);
  useEffect(() => {
    const previous = previousHashAttributeRef.current;
    previousHashAttributeRef.current = hashAttribute;
    if (!previous || previous === hashAttribute) return;
    const next = getIdentifierTypeForHashAttribute({
      identifierTypes,
      hashAttributeIdentifierTypeMap,
      hashAttribute,
      currentIdentifierType: identifierType,
    });
    if (next) changeIdentifierType(next);
  }, [
    hashAttribute,
    identifierTypes,
    hashAttributeIdentifierTypeMap,
    identifierType,
    changeIdentifierType,
  ]);

  // Repair the identifier before the query; selectable queries depend on it.
  useEffect(() => {
    if (!autoRepair) return;
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
    autoRepair,
    exposureQueryId,
    identifierType,
    exposureQueryOptions,
    identifierTypes,
    hashAttributeIdentifierTypeMap,
    hashAttribute,
    setExposureQueryId,
    setIdentifierType,
  ]);

  return {
    exposureQueryId,
    identifierType,
    identifierTypes,
    groupedIdentifierTypes,
    exposureQueryOptions,
    identifierUndeclared,
    setExposureQueryId,
    changeIdentifierType,
  };
}

type DriftState = Pick<Selection, "identifierUndeclared" | "identifierType">;

function getAssignmentQueryDriftMessage({
  identifierUndeclared,
  identifierType,
}: DriftState): string | null {
  if (identifierUndeclared) {
    return `The assignment query no longer declares the "${identifierType}" identifier type, so results can't update until another identifier or query is chosen.`;
  }
  return null;
}

// Shown wherever a saved selection is edited, including collapsed summaries.
export function AssignmentQueryDriftWarning({
  selection,
}: {
  selection: DriftState;
}) {
  const message = getAssignmentQueryDriftMessage(selection);
  if (!message) return null;
  return (
    <Callout status="warning" mb="3">
      {message}
    </Callout>
  );
}

// Compact form for read-only displays of a saved selection.
export function AssignmentQueryDriftIcon({
  selection,
}: {
  selection: DriftState;
}) {
  const message = getAssignmentQueryDriftMessage(selection);
  if (!message) return null;
  return (
    <Tooltip body={message}>
      <PiWarningFill style={{ color: "var(--amber-11)" }} />
    </Tooltip>
  );
}

export default function AssignmentQueryFields({
  selection,
  initialOption,
  placeholder,
  size,
  disabled,
  notice,
}: {
  selection: Selection;
  initialOption?: string;
  placeholder?: string;
  size?: "legacy";
  disabled?: boolean;
  notice?: string | null;
}) {
  const {
    exposureQueryId,
    identifierType,
    identifierTypes,
    groupedIdentifierTypes,
    exposureQueryOptions,
    setExposureQueryId,
    changeIdentifierType,
  } = selection;
  return (
    <>
      <AssignmentQueryDriftWarning selection={selection} />
      {notice ? (
        <Callout status="info" mb="3">
          {notice}
        </Callout>
      ) : null}
      <SelectField
        size={size}
        label={
          <>
            Identifier Type{" "}
            <Tooltip body="The unit this experiment is analyzed on. Should correspond to the attribute used to randomize units for this experiment." />
          </>
        }
        labelClassName="font-weight-bold"
        helpText={
          identifierTypes.length === 0
            ? "This Data Source has no assignment queries. Add one in the Data Source settings."
            : undefined
        }
        value={identifierType ?? ""}
        onChange={changeIdentifierType}
        initialOption={initialOption}
        placeholder={placeholder}
        required
        disabled={disabled}
        sort={false}
        options={groupedIdentifierTypes}
      />
      <SelectField
        size={size}
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
        placeholder={placeholder}
        required
        disabled={disabled}
        sort={false}
        options={exposureQueryOptions}
      />
    </>
  );
}
