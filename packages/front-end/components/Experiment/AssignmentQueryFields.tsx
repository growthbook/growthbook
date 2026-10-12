import { useCallback, useEffect, useMemo, useRef } from "react";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { getExposureQueryIdentifierTypes } from "shared/util";
import { PiWarningFill } from "react-icons/pi";
import {
  AssignmentQueryNotice,
  isIdentifierUndeclared,
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
  /** A kept selection whose query no longer declares its identifier. */
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
  copiedIdentifierType,
  useHashAttribute = true,
}: {
  datasource: DataSourceInterfaceWithParams | null | undefined;
  hashAttribute: string | undefined;
  exposureQueryId: string | undefined;
  identifierType: string | undefined;
  setExposureQueryId: (exposureQueryId: string) => void;
  setIdentifierType: (identifierType: string | undefined) => void;
  /**
   * New records repair an invalid selection as inputs change; existing records
   * must not have saved settings rewritten on load.
   */
  autoRepair?: boolean;
  /** Keep a drifted selection listed so existing records show what they use. */
  keepCurrentSelection?: boolean;
  /**
   * Group and follow the hash attribute. Off when that control isn't shown,
   * so the list isn't split into "Matches hash attribute".
   */
  useHashAttribute?: boolean;
  /**
   * A copy's source identifier. Repair keeps it when some query declares it,
   * else leaves the identifier for the user to choose instead of defaulting,
   * since a different identifier measures different units.
   */
  copiedIdentifierType?: string;
}): Selection {
  const keptQueryId = keepCurrentSelection ? exposureQueryId : undefined;
  const exposureQueries = useMemo(
    () => datasource?.settings?.queries?.exposure ?? [],
    [datasource],
  );
  const keptQuery = keptQueryId
    ? exposureQueries.find((q) => q.id === keptQueryId)
    : undefined;
  const identifierUndeclared = isIdentifierUndeclared(
    keptQuery,
    identifierType,
  );
  const hashAttributeIdentifierTypeMap = useMemo(
    () =>
      useHashAttribute
        ? getHashAttributeIdentifierTypeMap(datasource?.settings?.userIdTypes)
        : new Map<string, string[]>(),
    [useHashAttribute, datasource?.settings?.userIdTypes],
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

  /**
   * For a record saved before identifiers were stored, the shown identifier is
   * resolved rather than stored; commit it along with a new query so the save
   * keeps it.
   */
  const selectExposureQueryId = useCallback(
    (value: string) => {
      if (value !== exposureQueryId && identifierType) {
        setIdentifierType(identifierType);
      }
      setExposureQueryId(value);
    },
    [exposureQueryId, identifierType, setIdentifierType, setExposureQueryId],
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
  // Only write a value that differs: the setters re-render the form, which
  // can re-run this effect, so writing an unchanged value loops forever.
  useEffect(() => {
    if (!autoRepair) return;
    if (!identifierType || !identifierTypes.includes(identifierType)) {
      if (copiedIdentifierType !== undefined) {
        const kept = identifierTypes.includes(copiedIdentifierType)
          ? copiedIdentifierType
          : undefined;
        if (kept !== identifierType) setIdentifierType(kept);
        return;
      }
      const defaultIdentifierType = getDefaultIdentifierType({
        identifierTypes,
        hashAttributeIdentifierTypeMap,
        hashAttribute,
      });
      if (defaultIdentifierType !== identifierType) {
        setIdentifierType(defaultIdentifierType);
      }
      return;
    }
    if (
      !exposureQueryOptions.some((option) => option.value === exposureQueryId)
    ) {
      const defaultExposureQueryId = exposureQueryOptions[0]?.value ?? "";
      if (defaultExposureQueryId !== exposureQueryId) {
        setExposureQueryId(defaultExposureQueryId);
      }
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
    copiedIdentifierType,
  ]);

  return {
    exposureQueryId,
    identifierType,
    identifierTypes,
    groupedIdentifierTypes,
    exposureQueryOptions,
    identifierUndeclared,
    setExposureQueryId: selectExposureQueryId,
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
  notice?: AssignmentQueryNotice | null;
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
        <Callout status={notice.status} mb="3">
          {notice.message}
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
