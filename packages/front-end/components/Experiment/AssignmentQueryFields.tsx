import { useCallback, useEffect, useMemo, useRef } from "react";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { getExposureQueryIdentifierTypes } from "shared/util";
import { PiInfoFill, PiWarningFill } from "react-icons/pi";
import {
  AssignmentQueryNotice,
  getAssignmentQueryDrift,
  getDefaultIdentifierType,
  getExposureQueriesInScope,
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
  /** A kept selection the current scope or query no longer allows. */
  outOfScope: boolean;
  /** A kept selection whose query no longer declares its identifier. */
  identifierUndeclared: boolean;
  scopeKind: AssignmentQueryScopeKind;
  hasExposureQueries: boolean;
  setExposureQueryId: (exposureQueryId: string) => void;
  changeIdentifierType: (identifierType: string) => void;
};

/** One Project, a Holdout's Projects, or a Holdout covering all Projects. */
export type AssignmentQueryScopeKind =
  | "project"
  | "holdoutProjects"
  | "holdoutAllProjects";

export function getAssignmentQueryScopeKind(
  projects: string[] | undefined,
): AssignmentQueryScopeKind {
  if (!projects) return "project";
  return projects.length ? "holdoutProjects" : "holdoutAllProjects";
}

export function useAssignmentQuerySelection({
  datasource,
  project,
  projects,
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
  project: string | undefined;
  // Multi-project owners (holdouts): only queries covering all of them. Takes
  // precedence over `project`.
  projects?: string[];
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
  const scopedQueries = useMemo(
    () =>
      datasource
        ? getExposureQueriesInScope(datasource, project, projects)
        : [],
    [datasource, project, projects],
  );
  const keptQuery = keptQueryId
    ? datasource?.settings?.queries?.exposure?.find((q) => q.id === keptQueryId)
    : undefined;
  const { outOfScope, identifierUndeclared } = getAssignmentQueryDrift(
    keptQuery,
    identifierType,
    scopedQueries,
  );
  const exposureQueries = useMemo(
    () =>
      keptQuery && outOfScope ? [...scopedQueries, keptQuery] : scopedQueries,
    [scopedQueries, keptQuery, outOfScope],
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
    outOfScope,
    identifierUndeclared,
    scopeKind: getAssignmentQueryScopeKind(projects),
    hasExposureQueries: !!datasource?.settings?.queries?.exposure?.length,
    setExposureQueryId: selectExposureQueryId,
    changeIdentifierType,
  };
}

type DriftState = Pick<
  Selection,
  "outOfScope" | "identifierUndeclared" | "identifierType" | "scopeKind"
>;

const OUT_OF_SCOPE_MESSAGES: Record<AssignmentQueryScopeKind, string> = {
  project:
    "The selected assignment query is no longer scoped to this Project. Results still update. Switch to a query that is scoped to this Project.",
  holdoutProjects:
    "The selected assignment query is no longer scoped to every Project this Holdout covers. Results still update. Switch to a query that covers all of them.",
  holdoutAllProjects:
    "This assignment query is limited to specific Projects, but this Holdout covers all Projects. Results still update. Switch to a query that isn't limited to specific Projects.",
};

function getDriftNotice({
  outOfScope,
  identifierUndeclared,
  identifierType,
  scopeKind,
}: DriftState): { status: "warning" | "info"; message: string } | null {
  if (identifierUndeclared) {
    return {
      status: "warning",
      message: `The assignment query no longer declares the "${identifierType}" identifier type, so results can't update until another identifier or query is chosen.`,
    };
  }
  if (outOfScope) {
    return { status: "info", message: OUT_OF_SCOPE_MESSAGES[scopeKind] };
  }
  return null;
}

/** Why no identifier type can be chosen. */
export function getNoAssignmentQueriesMessage({
  hasExposureQueries,
  scopeKind,
}: Pick<Selection, "hasExposureQueries" | "scopeKind">): string {
  if (!hasExposureQueries) {
    return "This Data Source has no assignment queries. Add one in the Data Source settings.";
  }
  switch (scopeKind) {
    case "holdoutProjects":
      return "No assignment queries cover every Project this Holdout includes. Add one in the Data Source settings.";
    case "holdoutAllProjects":
      return "No assignment queries are available to a Holdout that covers all Projects. Add one that isn't limited to specific Projects.";
    case "project":
      return "No assignment queries are scoped to this Project. Add one in the Data Source settings.";
  }
}

export function AssignmentQueryDriftWarning({
  selection,
}: {
  selection: DriftState;
}) {
  const drift = getDriftNotice(selection);
  if (!drift) return null;
  return (
    <Callout status={drift.status} mb="3">
      {drift.message}
    </Callout>
  );
}

export function AssignmentQueryDriftIcon({
  selection,
}: {
  selection: DriftState;
}) {
  const drift = getDriftNotice(selection);
  if (!drift) return null;
  return (
    <Tooltip body={drift.message}>
      {drift.status === "warning" ? (
        <PiWarningFill style={{ color: "var(--amber-11)" }} />
      ) : (
        <PiInfoFill style={{ color: "var(--violet-11)" }} />
      )}
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
            ? getNoAssignmentQueriesMessage(selection)
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
