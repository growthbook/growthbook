import { ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Box } from "@radix-ui/themes";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "shared/types/datasource";
import {
  getClusterSubUnitIdentifierTypes,
  getExposureQueryIdentifierTypes,
  isManagedWarehouse,
} from "shared/util";
import { PiInfo, PiWarningFill } from "react-icons/pi";
import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  AssignmentQueryNotice,
  getDefaultIdentifierType,
  getExposureQueriesInScope,
  getGroupedIdentifierTypeOptions,
  getHashAttributeIdentifierTypeMap,
  getIdentifierTypeForHashAttribute,
  getSelectableIdentifierTypes,
  isIdentifierUndeclared,
} from "@/services/datasources";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import HelperText from "@/ui/HelperText";
import SetupFieldRow from "@/components/Experiment/TabbedPage/SetupFieldRow";

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
  /** A Holdout's Projects; empty means it covers all Projects. */
  holdoutProjects: string[] | undefined;
  hasExposureQueries: boolean;
  setExposureQueryId: (exposureQueryId: string) => void;
  changeIdentifierType: (identifierType: string) => void;
};

export function useAssignmentQuerySelection({
  datasource,
  project,
  holdoutProjects,
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
  /** A holdout's Projects, which the query must all cover. Overrides `project`. */
  holdoutProjects?: string[];
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
        ? getExposureQueriesInScope(datasource, project, holdoutProjects)
        : [],
    [datasource, project, holdoutProjects],
  );
  const keptQuery = keptQueryId
    ? datasource?.settings?.queries?.exposure?.find((q) => q.id === keptQueryId)
    : undefined;
  const outOfScope =
    !!keptQuery && !scopedQueries.some((q) => q.id === keptQuery.id);
  const identifierUndeclared = isIdentifierUndeclared(
    keptQuery,
    identifierType,
  );
  const exposureQueries = useMemo(
    () =>
      keptQuery && outOfScope ? [...scopedQueries, keptQuery] : scopedQueries,
    [scopedQueries, keptQuery, outOfScope],
  );
  const hashAttributeIdentifierTypeMap = useMemo(
    () =>
      useHashAttribute
        ? getHashAttributeIdentifierTypeMap(datasource)
        : new Map<string, string[]>(),
    [useHashAttribute, datasource],
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
    holdoutProjects,
    hasExposureQueries: !!datasource?.settings?.queries?.exposure?.length,
    setExposureQueryId: selectExposureQueryId,
    changeIdentifierType,
  };
}

type DriftState = Pick<
  Selection,
  "outOfScope" | "identifierUndeclared" | "identifierType" | "holdoutProjects"
>;

function getDriftNotice({
  outOfScope,
  identifierUndeclared,
  identifierType,
  holdoutProjects,
}: DriftState): {
  status: "warning" | "info";
  message: MessageDescriptor;
} | null {
  if (identifierUndeclared) {
    // Set whenever the identifier is undeclared.
    const undeclaredIdentifier = identifierType ?? "";
    return {
      status: "warning",
      message: msg`This assignment query no longer declares "${undeclaredIdentifier}", so results can't update.`,
    };
  }
  if (outOfScope) {
    return {
      status: "info",
      message: holdoutProjects
        ? msg`This assignment query isn't available to every Project in this Holdout. Results still update.`
        : msg`This assignment query isn't scoped to this Project. Results still update.`,
    };
  }
  return null;
}

// Monospace like code, in the surrounding text color.
export function IdentifierCode({ children }: { children: ReactNode }) {
  return (
    <code style={{ color: "inherit", textTransform: "none" }}>{children}</code>
  );
}

/** Why no identifier type can be chosen. */
// Without `i18n` the message is English, for callers not translated yet.
export function getNoAssignmentQueriesMessage(
  {
    hasExposureQueries,
    holdoutProjects,
  }: Pick<Selection, "hasExposureQueries" | "holdoutProjects">,
  i18n?: I18n,
): string {
  const text = (message: MessageDescriptor, english: string) =>
    i18n ? i18n._(message) : english;
  if (!hasExposureQueries) {
    return text(
      msg`This Data Source has no assignment queries. Add one in the Data Source settings.`,
      "This Data Source has no assignment queries. Add one in the Data Source settings.",
    );
  }
  if (!holdoutProjects) {
    return text(
      msg`No assignment queries are scoped to this Project. Add one in the Data Source settings.`,
      "No assignment queries are scoped to this Project. Add one in the Data Source settings.",
    );
  }
  // Only a query with no Project limit, its own or its Data Source's, fits.
  if (!holdoutProjects.length) {
    return text(
      msg`No assignment queries are available to a Holdout that covers all Projects. Add one that isn't limited to specific Projects.`,
      "No assignment queries are available to a Holdout that covers all Projects. Add one that isn't limited to specific Projects.",
    );
  }
  return text(
    msg`No assignment queries cover every Project this Holdout includes. Add one in the Data Source settings.`,
    "No assignment queries cover every Project this Holdout includes. Add one in the Data Source settings.",
  );
}

export function AssignmentQueryDriftWarning({
  selection,
  as = "callout",
}: {
  selection: DriftState;
  // Under the assignment query field rather than above the form.
  as?: "callout" | "helperText";
}) {
  const { i18n } = useLingui();
  const drift = getDriftNotice(selection);
  if (!drift) return null;
  return as === "helperText" ? (
    <HelperText status={drift.status} size="sm" mt="2">
      {i18n._(drift.message)}
    </HelperText>
  ) : (
    <Callout status={drift.status} size="sm" mb="3">
      {i18n._(drift.message)}
    </Callout>
  );
}

export function AssignmentQueryDriftIcon({
  selection,
}: {
  selection: DriftState;
}) {
  const { i18n } = useLingui();
  const drift = getDriftNotice(selection);
  if (!drift) return null;
  return (
    <Tooltip body={i18n._(drift.message)}>
      {drift.status === "warning" ? (
        <PiWarningFill style={{ color: "var(--amber-11)" }} />
      ) : (
        <PiInfo />
      )}
    </Tooltip>
  );
}

const IDENTIFIER_TYPE_TIP = msg`The unit this experiment is analyzed on. Should correspond to the attribute used to randomize units for this experiment.`;
const ASSIGNMENT_TABLE_TIP = msg`The query that records which units saw which variation.`;

export default function AssignmentQueryFields({
  selection,
  initialOption,
  placeholder,
  size,
  disabled,
  notice,
  autoFocus = false,
  progressive = false,
  asRows = false,
}: {
  selection: Selection;
  initialOption?: string;
  placeholder?: string;
  size?: "legacy";
  disabled?: boolean;
  notice?: AssignmentQueryNotice | null;
  /** Focuses the assignment table when it mounts. */
  autoFocus?: boolean;
  /** Holds the assignment table back until an identifier type is chosen. */
  progressive?: boolean;
  /** Each field beside its label, as on the experiment's setup page. */
  asRows?: boolean;
}) {
  const { t, i18n } = useLingui();
  const identifierTypeTip = i18n._(IDENTIFIER_TYPE_TIP);
  const assignmentTableTip = i18n._(ASSIGNMENT_TABLE_TIP);
  const {
    exposureQueryId,
    identifierType,
    identifierTypes,
    groupedIdentifierTypes,
    exposureQueryOptions,
    setExposureQueryId,
    changeIdentifierType,
  } = selection;
  const field = (
    label: string,
    tooltip: string,
    select: ReactNode,
    note?: ReactNode,
  ) =>
    asRows ? (
      <SetupFieldRow label={label} tooltip={tooltip}>
        {select}
        {note}
      </SetupFieldRow>
    ) : (
      select
    );
  return (
    <>
      {asRows ? null : <AssignmentQueryDriftWarning selection={selection} />}
      {notice ? (
        <Callout status={notice.status} mb="3">
          {notice.message}
        </Callout>
      ) : null}
      {field(
        t`Identifier type`,
        identifierTypeTip,
        <SelectField
          size={size}
          label={
            asRows ? undefined : (
              <>
                <Trans>Identifier Type</Trans>{" "}
                <Tooltip body={identifierTypeTip} />
              </>
            )
          }
          labelClassName="font-weight-bold"
          helpText={
            identifierTypes.length === 0
              ? getNoAssignmentQueriesMessage(selection, i18n)
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
        />,
      )}
      {progressive && !identifierType
        ? null
        : field(
            t`Assignment query`,
            assignmentTableTip,
            <SelectField
              size={size}
              label={
                asRows ? undefined : (
                  <>
                    <Trans>Experiment Assignment Table</Trans>{" "}
                    <Tooltip body={assignmentTableTip} />
                  </>
                )
              }
              labelClassName="font-weight-bold"
              helpText={
                identifierType && exposureQueryOptions.length === 0
                  ? t`No assignment queries declare the "${identifierType}" identifier type.`
                  : undefined
              }
              value={exposureQueryId ?? ""}
              onChange={setExposureQueryId}
              autoFocus={autoFocus}
              initialOption={initialOption}
              placeholder={placeholder}
              required
              disabled={disabled}
              sort={false}
              options={exposureQueryOptions}
            />,
            <AssignmentQueryDriftWarning
              selection={selection}
              as="helperText"
            />,
          )}
    </>
  );
}

export const POST_STRATIFICATION_CLUSTER_MESSAGE = msg`Post-stratification isn't supported for cluster experiments.`;

export function useClusterSubUnitOptions(
  datasource: DataSourceInterfaceWithParams | null | undefined,
  exposureQuery: ExposureQuery | undefined,
  identifierType: string | undefined,
): string[] {
  return useMemo(
    () =>
      exposureQuery
        ? getClusterSubUnitIdentifierTypes(
            exposureQuery,
            datasource,
            identifierType,
          )
        : [],
    [datasource, exposureQuery, identifierType],
  );
}

export const CLUSTER_OFF_FOR_DATASOURCE_MESSAGE = msg`This Data Source has no assignment queries, so this experiment will no longer be analyzed as a cluster experiment. Make sure that still matches how traffic was randomized.`;

const CLUSTER_MODE_CHANGE_MESSAGE = msg`This experiment has already started. Turning Cluster experiment on or off changes how results are analyzed, so make sure it still matches how traffic was randomized.`;

export type ClusterChangeAfterLaunch = "mode" | "subunit" | null;

// A started experiment can still change its cluster settings, but should be
// told which one it changed.
export function getClusterChangeAfterLaunch(
  experiment: Pick<
    ExperimentInterfaceStringDates,
    "status" | "isClusterExperiment" | "clusterSubUnitIdentifier"
  >,
  next: { isClusterExperiment: boolean; clusterSubUnitIdentifier: string },
): ClusterChangeAfterLaunch {
  if (experiment.status === "draft") return null;
  if (next.isClusterExperiment !== !!experiment.isClusterExperiment) {
    return "mode";
  }
  return next.isClusterExperiment &&
    next.clusterSubUnitIdentifier !==
      (experiment.clusterSubUnitIdentifier ?? "")
    ? "subunit"
    : null;
}

export function ClusterExperimentFields({
  datasource,
  exposureQuery,
  identifierType,
  isClusterExperiment,
  subUnitIdentifier,
  setIsClusterExperiment,
  setSubUnitIdentifier,
  disabled,
  changedAfterLaunch,
  asRows = false,
}: {
  datasource: DataSourceInterfaceWithParams | null | undefined;
  exposureQuery: ExposureQuery | undefined;
  identifierType: string | undefined;
  isClusterExperiment: boolean;
  subUnitIdentifier: string;
  setIsClusterExperiment: (value: boolean) => void;
  setSubUnitIdentifier: (value: string) => void;
  disabled?: boolean;
  changedAfterLaunch?: ClusterChangeAfterLaunch;
  // Each field beside its label, as on the experiment's setup page.
  asRows?: boolean;
}) {
  const { t, i18n } = useLingui();
  const { hasCommercialFeature } = useUser();
  const subUnitOptions = useClusterSubUnitOptions(
    datasource,
    exposureQuery,
    identifierType,
  );
  // A new query or identifier can leave the chosen subunit off the list.
  useEffect(() => {
    if (!isClusterExperiment || disabled) return;
    if (subUnitOptions.includes(subUnitIdentifier)) return;
    const next = subUnitOptions[0] ?? "";
    // The form's setter re-renders even when the value is unchanged.
    if (next !== subUnitIdentifier) setSubUnitIdentifier(next);
  }, [
    isClusterExperiment,
    disabled,
    subUnitOptions,
    subUnitIdentifier,
    setSubUnitIdentifier,
  ]);
  // Kept visible on a cluster experiment so it can still be turned off after
  // its query stops declaring a second identifier.
  if (!subUnitOptions.length && !isClusterExperiment) return null;

  const explanation = (
    <Trans>
      Every unit in a <IdentifierCode>{identifierType}</IdentifierCode> gets the
      same variation, and metrics are analyzed on a smaller unit inside it.
    </Trans>
  );
  const premiumLabel = (label: ReactNode) => (
    <PremiumTooltip commercialFeature="cluster-experiments">
      {label}
    </PremiumTooltip>
  );
  const checkbox = (
    <Checkbox
      label={
        asRows
          ? // PremiumTooltip lays its children out in a row, so the sentence
            // goes in as one piece to wrap as text.
            premiumLabel(<span>{explanation}</span>)
          : premiumLabel(t`Cluster experiment`)
      }
      weight={asRows ? "regular" : undefined}
      description={asRows ? undefined : explanation}
      value={isClusterExperiment}
      setValue={setIsClusterExperiment}
      disabled={
        disabled ||
        (!isClusterExperiment && !hasCommercialFeature("cluster-experiments"))
      }
    />
  );
  const launchWarning = (kind: ClusterChangeAfterLaunch, message: ReactNode) =>
    changedAfterLaunch === kind ? (
      <HelperText status="warning" size="sm" mt="2">
        {message}
      </HelperText>
    ) : null;
  const modeWarning = launchWarning(
    "mode",
    i18n._(CLUSTER_MODE_CHANGE_MESSAGE),
  );
  const subUnitWarning = launchWarning(
    "subunit",
    <Trans>
      This experiment has already started. Changing the subunit identifier type
      changes which unit its metrics are analyzed on, so check that they can be
      analyzed per <IdentifierCode>{subUnitIdentifier}</IdentifierCode>.
    </Trans>,
  );
  const exposureQueryName = exposureQuery?.name ?? "";
  const subUnitSelect = (
    <SelectField
      label={asRows ? undefined : t`Subunit identifier type`}
      labelClassName={asRows ? undefined : "font-weight-bold"}
      value={subUnitIdentifier}
      onChange={setSubUnitIdentifier}
      placeholder={t`Choose...`}
      required
      disabled={disabled}
      sort={false}
      options={subUnitOptions.map((type) => ({
        label: type,
        value: type,
      }))}
      helpText={
        subUnitOptions.length ? (
          <Trans>
            Metrics are analyzed per{" "}
            <IdentifierCode>{subUnitIdentifier}</IdentifierCode> wherever they
            can be.
          </Trans>
        ) : datasource && isManagedWarehouse(datasource) ? (
          t`This Data Source has no other identifier type to analyze on.`
        ) : exposureQuery ? (
          t`${exposureQueryName} doesn't declare another identifier type to analyze on.`
        ) : (
          t`Choose an assignment query to pick a subunit.`
        )
      }
    />
  );

  if (asRows) {
    return (
      <>
        <SetupFieldRow label={t`Cluster experiment`} content="text">
          {checkbox}
          {modeWarning}
        </SetupFieldRow>
        {isClusterExperiment && (
          <SetupFieldRow label={t`Subunit identifier type`}>
            {subUnitSelect}
            {subUnitWarning}
          </SetupFieldRow>
        )}
      </>
    );
  }
  return (
    <Box mb="4">
      {checkbox}
      {modeWarning}
      {isClusterExperiment && (
        <Box ml="5" mt="3">
          {subUnitSelect}
          {subUnitWarning}
        </Box>
      )}
    </Box>
  );
}
