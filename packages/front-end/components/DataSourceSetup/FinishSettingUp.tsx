import {
  CSSProperties,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Box, Flex, Grid, IconButton, Progress } from "@radix-ui/themes";
import { PiCheck, PiMinus, PiPencilSimple, PiPlus } from "react-icons/pi";
import cloneDeep from "lodash/cloneDeep";
import isEqual from "lodash/isEqual";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
  UserIdType,
} from "shared/types/datasource";
import { SDKAttribute } from "shared/types/organization";
import {
  attributeMatchesDatasourceProjects,
  attributeToUserIdTypeName,
  getExposureQueryIdentifierTypes,
  isEventForwarderManaged,
  isEventForwarderSetupStepComplete,
} from "shared/util";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import AttributeModal from "@/components/Features/AttributeModal";
import Link from "@/ui/Link";
import { ExperimentAssignmentQueryModal } from "@/components/Settings/EditDataSource/ExperimentAssignmentQueries/ExperimentAssignmentQueryModal";
import NewFactTableModal from "@/components/FactTables/NewFactTableModal";
import { EventForwarderManagedBadge } from "@/components/Settings/EditDataSource/EventForwarderManaged";
import { dataSourceConnections } from "@/services/eventSchema";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Checkbox from "@/ui/Checkbox";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import ConfigureEventForwarderStep from "./ConfigureEventForwarderStep";

type StepId = "connect" | "forwarder" | "identifiers" | "queries" | "factTable";

type IdentifierMode = "view" | "edit";

// One row per identifier type this Data Source could use: every attribute the
// org marked as a unique identifier, plus any saved type with no linked
// attribute (legacy or Event Forwarder managed).
type IdentifierRow = {
  key: string;
  // Null for saved types that aren't linked to an attribute.
  attribute: string | null;
  // The identifier type already saved on this Data Source, if any. Its name
  // can't change because assignment queries reference it.
  saved: UserIdType | null;
  name: string;
  description: string;
  // Whether this Data Source has (or will have, once confirmed) the type.
  included: boolean;
  managed: boolean;
  // Created from this page and not saved yet.
  isNew: boolean;
};

// Open the attribute modal to create a new identifier or edit an existing one.
type AttributeModalState = { attribute: string | null } | null;

// Index of the exposure query being edited, or null to add a new one that
// starts with the given identifier types.
type QueryModal =
  | { index: number; identifierTypes?: never }
  | { index: null; identifierTypes: string[] }
  | null;

const EXPANDABLE_STEPS: StepId[] = ["forwarder", "identifiers", "queries"];

// Status icon or checkbox, identifier type, description, row actions.
const IDENTIFIER_COLUMNS = "24px minmax(0, 1fr) minmax(0, 2fr) 56px";

const IDENTIFIER_ROW_BORDER = { borderTop: "1px solid var(--gray-a5)" };

const attributeKey = (property: string) => `attribute:${property}`;
const savedTypeKey = (userIdType: string) => `type:${userIdType}`;

// Only the identifier types GrowthBook defaults to get a suggested description.
const DEFAULT_IDENTIFIER_DESCRIPTIONS: Record<string, string> = {
  user_id: "Logged-in users",
  anonymous_id: "Anonymous visitors",
};

function exposureQuerySkipKey(dataSourceId: string) {
  return `gb-finish-setting-up-skip-exposure:${dataSourceId}`;
}

function readExposureQuerySkipped(dataSourceId: string): boolean {
  try {
    return localStorage.getItem(exposureQuerySkipKey(dataSourceId)) === "1";
  } catch {
    return false;
  }
}

// Per browser, per Data Source. An org that does not run experiments can
// finish setup without an exposure query.
export function useExposureQuerySkipped(dataSourceId: string | undefined): {
  skipped: boolean;
  skip: () => void;
} {
  const [skipped, setSkipped] = useState(false);
  useEffect(() => {
    setSkipped(!!dataSourceId && readExposureQuerySkipped(dataSourceId));
  }, [dataSourceId]);

  const skip = useCallback(() => {
    if (!dataSourceId) return;
    try {
      localStorage.setItem(exposureQuerySkipKey(dataSourceId), "1");
    } catch {
      // Private mode can reject the write. The step still completes this session.
    }
    setSkipped(true);
  }, [dataSourceId]);

  return { skipped, skip };
}

function getCompletion(
  dataSource: DataSourceInterfaceWithParams,
  factTableCount: number,
  exposureQuerySkipped: boolean,
): Partial<Record<StepId, boolean>> {
  const identifierTypes = dataSource.settings?.userIdTypes ?? [];
  const exposureQueries = dataSource.settings?.queries?.exposure ?? [];
  const steps: Partial<Record<StepId, boolean>> = {
    connect: true,
  };
  if (dataSource.eventForwarderConfig) {
    steps.forwarder = isEventForwarderSetupStepComplete(
      dataSource.eventForwarderConfig,
    );
  }
  steps.identifiers = identifierTypes.length > 0;
  // One exposure query is enough. Identifier types are also used for joins
  // and metrics, so they don't each need to appear in an exposure query.
  // Skipping is enough too, for orgs that do not run experiments.
  steps.queries = exposureQueries.length > 0 || exposureQuerySkipped;
  steps.factTable = factTableCount > 0;
  return steps;
}

// On a Data Source that already has identifiers, attributes it never mapped
// are listed under "Not in this Data Source" until the user checks them. A
// Data Source with none yet starts with every attribute checked.
function getExcludedKeys(
  dataSource: DataSourceInterfaceWithParams,
  hashAttributes: string[],
): string[] {
  const identifierTypes = dataSource.settings?.userIdTypes ?? [];
  if (!identifierTypes.length) return [];
  return hashAttributes
    .filter(
      (attribute) =>
        !identifierTypes.some((type) => type.attributes?.includes(attribute)),
    )
    .map(attributeKey);
}

export function isDataSourceSetupComplete(
  dataSource: DataSourceInterfaceWithParams,
  factTableCount: number,
  exposureQuerySkipped = false,
): boolean {
  return Object.values(
    getCompletion(dataSource, factTableCount, exposureQuerySkipped),
  ).every(Boolean);
}

export default function FinishSettingUp({
  dataSource,
  factTableCount,
  canEdit,
  onSave,
  exposureQuerySkipped,
  onSkipExposureQuery,
  onRefresh,
}: {
  dataSource: DataSourceInterfaceWithParams;
  factTableCount: number;
  canEdit: boolean;
  onSave: (dataSource: DataSourceInterfaceWithParams) => Promise<void>;
  exposureQuerySkipped: boolean;
  onSkipExposureQuery: () => void;
  onRefresh: () => Promise<void>;
}) {
  const hasEventForwarder = Boolean(dataSource.eventForwarderConfig);
  const completion = useMemo(
    () => getCompletion(dataSource, factTableCount, exposureQuerySkipped),
    [dataSource, factTableCount, exposureQuerySkipped],
  );
  const stepIds = Object.keys(completion) as StepId[];
  const stepNumber = (id: StepId) => stepIds.indexOf(id) + 1;
  const completed = stepIds.filter((id) => completion[id]).length;
  const currentStep = stepIds.find((id) => !completion[id]) ?? null;

  const { attributeSchema } = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();
  const hashAttributes = useMemo<SDKAttribute[]>(
    () =>
      (attributeSchema ?? []).filter(
        (attribute) =>
          attribute.hashAttribute &&
          attributeMatchesDatasourceProjects(attribute, dataSource.projects),
      ),
    [attributeSchema, dataSource.projects],
  );
  const hashAttributeNames = useMemo(
    () => hashAttributes.map(({ property }) => property),
    [hashAttributes],
  );
  const canCreateAttribute = permissionsUtil.canCreateAttribute({
    projects: dataSource.projects ?? [],
  });
  const canCreateFactTable = permissionsUtil.canCreateFactTable({
    projects: dataSource.projects ?? [],
  });

  const [expandedStep, setExpandedStep] = useState<StepId | null>(() =>
    currentStep &&
    EXPANDABLE_STEPS.includes(currentStep) &&
    !(hasEventForwarder && !completion.forwarder && currentStep === "queries")
      ? currentStep
      : null,
  );
  // localStorage is read after mount. Close a step that was only open because
  // the skipped exposure query had not loaded yet.
  useEffect(() => {
    if (exposureQuerySkipped) {
      setExpandedStep((step) => (step === "queries" ? null : step));
    }
  }, [exposureQuerySkipped]);
  const [identifierMode, setIdentifierMode] = useState<IdentifierMode>("view");
  // Rows the user has left out of this Data Source. Checkboxes write this
  // directly. A snapshot taken when editing starts is restored on cancel.
  const [excludedKeys, setExcludedKeys] = useState<string[]>(() =>
    getExcludedKeys(dataSource, hashAttributeNames),
  );
  const [excludedBeforeEdit, setExcludedBeforeEdit] = useState<string[] | null>(
    null,
  );
  // Attributes created from this page get a "New" badge until saved.
  const [initialAttributes] = useState(() => hashAttributeNames);
  const [identifierError, setIdentifierError] = useState<string | null>(null);
  const [attributeModal, setAttributeModal] =
    useState<AttributeModalState>(null);
  const [queryModal, setQueryModal] = useState<QueryModal>(null);
  const [factTableOpen, setFactTableOpen] = useState(false);

  const identifierTypes = dataSource.settings?.userIdTypes ?? [];
  const exposureQueries = dataSource.settings?.queries?.exposure ?? [];
  const hasIdentifiers = identifierTypes.length > 0;
  // Identifier types no exposure query returns yet. A new query starts with
  // these so one query can cover everything.
  const uncoveredIdentifierTypes = identifierTypes
    .map(({ userIdType }) => userIdType)
    .filter(
      (userIdType) =>
        !exposureQueries.some((query) =>
          getExposureQueryIdentifierTypes(query).includes(userIdType),
        ),
    );

  const attributeTypes = new Set<UserIdType>();
  const identifierRows: IdentifierRow[] = [
    ...hashAttributes.map(({ property, description }) => {
      const key = attributeKey(property);
      const saved =
        identifierTypes.find((type) => type.attributes?.includes(property)) ??
        null;
      if (saved) attributeTypes.add(saved);
      const name = saved?.userIdType ?? attributeToUserIdTypeName(property);
      return {
        key,
        attribute: property,
        saved,
        name,
        description: saved
          ? (saved.description ?? "")
          : (description ?? DEFAULT_IDENTIFIER_DESCRIPTIONS[name] ?? ""),
        included: !excludedKeys.includes(key),
        managed: !!saved && isEventForwarderManaged(saved),
        isNew: !saved && !initialAttributes.includes(property),
      };
    }),
    // Saved types no attribute row represents: legacy, Event Forwarder managed,
    // or a second type linked to an attribute another type already shows.
    ...identifierTypes
      .filter((type) => !attributeTypes.has(type))
      .map((type) => {
        const key = savedTypeKey(type.userIdType);
        return {
          key,
          attribute: null,
          saved: type,
          name: type.userIdType,
          description: type.description ?? "",
          included: !excludedKeys.includes(key),
          managed: isEventForwarderManaged(type),
          isNew: false,
        };
      }),
  ];
  const includedRows = identifierRows.filter((row) => row.included);
  const excludedRows = identifierRows.filter((row) => !row.included);

  const dataSourceName =
    dataSourceConnections.find((c) => c.type === dataSource.type)?.display ??
    "Data Source";

  const openIdentifiers = () => {
    setExcludedKeys(getExcludedKeys(dataSource, hashAttributeNames));
    setExcludedBeforeEdit(null);
    setIdentifierMode("view");
    setIdentifierError(null);
    setExpandedStep("identifiers");
  };

  const startEditing = () => {
    setIdentifierError(null);
    setExcludedBeforeEdit([...excludedKeys]);
    setIdentifierMode("edit");
  };

  const cancelEditing = () => {
    if (excludedBeforeEdit !== null) setExcludedKeys(excludedBeforeEdit);
    setExcludedBeforeEdit(null);
    setIdentifierMode("view");
  };

  const buildIdentifierTypes = (): UserIdType[] => {
    if (!includedRows.length) {
      throw new Error("Select at least one identifier type");
    }

    // Several attributes may share one column; they share one identifier
    // type with every attribute linked.
    const byName = new Map<string, UserIdType>();
    for (const row of includedRows) {
      const existing = byName.get(row.name);
      if (row.attribute === null) {
        if (!existing && row.saved) byName.set(row.name, { ...row.saved });
        continue;
      }
      if (existing) {
        existing.attributes = [...(existing.attributes ?? []), row.attribute];
        continue;
      }
      const saved =
        row.saved ??
        identifierTypes.find((type) => type.userIdType === row.name) ??
        null;
      byName.set(row.name, {
        ...saved,
        userIdType: row.name,
        description: saved?.description ?? row.description,
        // Keep links to attributes outside this Data Source's projects.
        attributes: [
          ...(saved?.attributes ?? []).filter(
            (a) => !hashAttributeNames.includes(a),
          ),
          row.attribute,
        ],
      });
    }
    return Array.from(byName.values());
  };

  const confirmIdentifiers = async () => {
    const userIdTypes = buildIdentifierTypes();
    const copy = cloneDeep(dataSource);
    copy.settings = { ...copy.settings, userIdTypes };
    // Confirming an unchanged list just closes the step.
    if (!isEqual(userIdTypes, identifierTypes)) {
      await onSave(copy);
    }
    setExcludedKeys(getExcludedKeys(copy, hashAttributeNames));
    setExpandedStep(
      getCompletion(copy, factTableCount, exposureQuerySkipped).queries
        ? null
        : "queries",
    );
  };

  const identifierDescription =
    "Tell us how you identify your users (for example, user_id or id). This determines how you can split traffic for experiments and track metric conversions. Uncheck any that aren't relevant, and add any that might be missing.";

  const saveQuery = async (exposureQuery: ExposureQuery) => {
    if (!queryModal) return;
    const copy = cloneDeep(dataSource);
    const queries = copy.settings?.queries ?? {};
    const exposure = [...(queries.exposure ?? [])];
    if (queryModal.index === null) {
      exposure.push(exposureQuery);
    } else {
      exposure[queryModal.index] = exposureQuery;
    }
    copy.settings = { ...copy.settings, queries: { ...queries, exposure } };
    await onSave(copy);
    setQueryModal(null);
  };

  const stepCta = (
    step: StepId,
    label: string,
    onClick: () => void,
    requiresIdentifiers: boolean,
    permission: { allowed: boolean; deniedMessage: string } | null = null,
  ) => {
    const blocked = requiresIdentifiers && !hasIdentifiers;
    const allowed = permission?.allowed ?? canEdit;
    const reason = blocked
      ? "Needs an identifier type"
      : !allowed && permission
        ? permission.deniedMessage
        : null;
    return (
      <Flex direction="column" align="end" gap="1">
        <Button
          variant={step === currentStep ? "solid" : "outline"}
          disabled={!allowed || blocked}
          onClick={onClick}
        >
          {label}
        </Button>
        {reason && (
          <Text size="sm" color="text-mid">
            {reason}
          </Text>
        )}
      </Flex>
    );
  };

  const doneActions = (onEdit?: () => void) => (
    <Flex align="center" gap="3">
      {onEdit && canEdit && (
        <Button variant="ghost" onClick={onEdit}>
          Edit
        </Button>
      )}
      <Badge label="Done" color="green" />
    </Flex>
  );

  return (
    <>
      <Flex justify="between" gap="6" px="6" py="4">
        <Box flexGrow="1" minWidth="0">
          <Heading as="h2" size="md" mb="1">
            Finish Setting Up
          </Heading>
          <Text as="p" color="text-mid" mb="0">
            {hasEventForwarder
              ? "Configure the Event Forwarder. GrowthBook then creates identifier types, an exposure query, and an Events fact table from the forwarded events."
              : "Tell GrowthBook how you identify your users and where events are stored in your warehouse."}
          </Text>
        </Box>
        <Flex direction="column" align="end" gap="1" flexShrink="0">
          <Text size="sm" weight="medium">
            {completed} of {stepIds.length} complete
          </Text>
          <Box width="145px">
            <Progress
              value={(completed / stepIds.length) * 100}
              color="violet"
              size="1"
            />
          </Box>
        </Flex>
      </Flex>

      <SetupStepRow
        number={stepNumber("connect")}
        complete
        current={false}
        expanded={false}
        title={`Connect to ${dataSourceName}`}
        description="Connection and read access verified"
        actions={doneActions()}
      />

      {hasEventForwarder && completion.forwarder !== undefined ? (
        <SetupStepRow
          number={stepNumber("forwarder")}
          complete={!!completion.forwarder}
          current={currentStep === "forwarder"}
          expanded={expandedStep === "forwarder"}
          title="Configure Event Forwarder"
          description={
            dataSource.eventForwarderConfig?.status === "error"
              ? "The Event Forwarder was not set up."
              : "Define where GrowthBook should write forwarded events in your warehouse."
          }
          actions={
            expandedStep === "forwarder" || completion.forwarder
              ? null
              : stepCta(
                  "forwarder",
                  "Configure Event Forwarder",
                  () => setExpandedStep("forwarder"),
                  false,
                )
          }
        >
          {expandedStep === "forwarder" && !completion.forwarder ? (
            <ConfigureEventForwarderStep
              dataSource={dataSource}
              canEdit={canEdit}
              onRefresh={onRefresh}
              onConfigured={async () => {
                await onRefresh();
                setExpandedStep(null);
              }}
            />
          ) : null}
        </SetupStepRow>
      ) : null}

      <SetupStepRow
        number={stepNumber("identifiers")}
        complete={!!completion.identifiers}
        current={currentStep === "identifiers"}
        expanded={expandedStep === "identifiers"}
        title="Identifier types"
        description={identifierDescription}
        actions={
          expandedStep === "identifiers"
            ? null
            : completion.identifiers
              ? doneActions(openIdentifiers)
              : stepCta(
                  "identifiers",
                  "Add identifier types",
                  openIdentifiers,
                  false,
                )
        }
      >
        {expandedStep === "identifiers" && (
          <Box mt="3">
            <Box
              style={{
                border: "1px solid var(--gray-a5)",
                borderRadius: "var(--radius-3)",
                overflow: "hidden",
              }}
            >
              {identifierMode === "edit" && (
                <Grid
                  columns={IDENTIFIER_COLUMNS}
                  gapX="4"
                  px="4"
                  py="2"
                  style={{ background: "var(--gray-a2)" }}
                >
                  <Box />
                  <Text size="sm" weight="medium" color="text-mid">
                    Identifier type
                  </Text>
                  <Text size="sm" weight="medium" color="text-mid">
                    Description
                  </Text>
                  <Box />
                </Grid>
              )}
              {identifierRows.length === 0 && (
                <Box px="4" py="3">
                  <Text as="p" color="text-mid" mb="0">
                    No attributes are marked as unique identifiers yet. Add one
                    to use it as an identifier type.
                  </Text>
                </Box>
              )}
              {identifierMode === "edit" ? (
                identifierRows.map((row, i) => (
                  <IdentifierTableRow
                    key={row.key}
                    row={row}
                    muted={false}
                    style={i > 0 ? IDENTIFIER_ROW_BORDER : undefined}
                    leading={
                      <Checkbox
                        size="sm"
                        value={row.included}
                        disabled={row.managed}
                        setValue={(checked) =>
                          setExcludedKeys((keys) =>
                            checked
                              ? keys.filter((key) => key !== row.key)
                              : keys.includes(row.key)
                                ? keys
                                : [...keys, row.key],
                          )
                        }
                      />
                    }
                    actions={
                      // Only types created from this page are editable here.
                      row.isNew && row.attribute !== null ? (
                        <IconButton
                          variant="ghost"
                          color="gray"
                          size="1"
                          aria-label={`Edit ${row.name}`}
                          onClick={() =>
                            setAttributeModal({ attribute: row.attribute })
                          }
                        >
                          <PiPencilSimple />
                        </IconButton>
                      ) : null
                    }
                  />
                ))
              ) : (
                <>
                  {includedRows.map((row, i) => (
                    <IdentifierTableRow
                      key={row.key}
                      row={row}
                      muted={false}
                      style={i > 0 ? IDENTIFIER_ROW_BORDER : undefined}
                      leading={<PiCheck color="var(--green-11)" />}
                    />
                  ))}
                  {excludedRows.length > 0 && (
                    <>
                      <Box
                        px="4"
                        py="2"
                        style={{
                          background: "var(--gray-a2)",
                          ...(includedRows.length > 0
                            ? IDENTIFIER_ROW_BORDER
                            : {}),
                        }}
                      >
                        <Text size="sm" weight="medium" color="text-mid">
                          Not used by this Data Source
                        </Text>
                      </Box>
                      {excludedRows.map((row) => (
                        <IdentifierTableRow
                          key={row.key}
                          row={row}
                          muted
                          style={IDENTIFIER_ROW_BORDER}
                          leading={<PiMinus color="var(--gray-9)" />}
                        />
                      ))}
                    </>
                  )}
                </>
              )}
            </Box>
            {canEdit && canCreateAttribute && (
              <Box mt="2">
                <Button
                  variant="ghost"
                  icon={<PiPlus />}
                  onClick={() => setAttributeModal({ attribute: null })}
                >
                  Add identifier type
                </Button>
              </Box>
            )}
            {identifierError && (
              <HelperText status="error" mt="2">
                {identifierError}
              </HelperText>
            )}
            <Flex mt="3" gap="3" align="center" justify="between">
              {identifierMode === "edit" ? (
                <>
                  <Flex gap="3" align="center">
                    <Button
                      onClick={() => {
                        setExcludedBeforeEdit(null);
                        setIdentifierMode("view");
                      }}
                    >
                      Save
                    </Button>
                    <Button variant="ghost" onClick={cancelEditing}>
                      Cancel
                    </Button>
                  </Flex>
                  <Text size="sm" color="text-mid">
                    {includedRows.length} of {identifierRows.length} selected
                  </Text>
                </>
              ) : (
                <>
                  {canEdit ? (
                    <Flex gap="3" align="center">
                      <Button
                        onClick={confirmIdentifiers}
                        setError={setIdentifierError}
                        disabled={identifierRows.length === 0}
                      >
                        Confirm and continue
                      </Button>
                      {identifierRows.length > 0 && (
                        <Button variant="ghost" onClick={startEditing}>
                          Edit
                        </Button>
                      )}
                    </Flex>
                  ) : (
                    <Box />
                  )}
                  <Text size="sm" color="text-mid">
                    Shared across all Data Sources.{" "}
                    <Link size="sm" href="/attributes">
                      Manage attributes
                    </Link>
                  </Text>
                </>
              )}
            </Flex>
          </Box>
        )}
      </SetupStepRow>

      <SetupStepRow
        number={stepNumber("queries")}
        complete={!!completion.queries}
        current={currentStep === "queries"}
        expanded={expandedStep === "queries"}
        title="Add exposure queries"
        description={
          hasEventForwarder && !completion.queries && completion.forwarder
            ? "A managed exposure query was not created. Add one to continue."
            : hasEventForwarder
              ? "GrowthBook creates a managed exposure query from your identifier types after the Event Forwarder is configured."
              : "SQL that tells GrowthBook who saw which variation of an experiment, and when. One query is enough to continue. Add another if identifier types live in different tables."
        }
        actions={
          expandedStep === "queries"
            ? null
            : completion.queries
              ? doneActions(() => setExpandedStep("queries"))
              : hasEventForwarder && !completion.forwarder
                ? null
                : stepCta(
                    "queries",
                    "Set up queries",
                    () => setExpandedStep("queries"),
                    true,
                  )
        }
      >
        {expandedStep === "queries" &&
          (!hasEventForwarder ||
            completion.forwarder ||
            completion.queries) && (
            <Box mt="3">
              <Box
                style={{
                  border: "1px solid var(--gray-a5)",
                  borderRadius: "var(--radius-3)",
                  overflow: "hidden",
                }}
              >
                {exposureQueries.length === 0 && (
                  <Box px="4" py="3">
                    <Text as="p" color="text-mid" mb="0">
                      No exposure queries yet. Add a query to start running
                      experiments.
                    </Text>
                  </Box>
                )}
                {exposureQueries.map((query, index) => (
                  <Flex
                    key={query.id}
                    align="center"
                    justify="between"
                    gap="3"
                    px="4"
                    py="3"
                    style={index > 0 ? IDENTIFIER_ROW_BORDER : undefined}
                  >
                    <Flex align="center" gap="2" wrap="wrap" minWidth="0">
                      <Text weight="medium">{query.name}</Text>
                      {isEventForwarderManaged(query) && (
                        <EventForwarderManagedBadge type="assignment query" />
                      )}
                      {getExposureQueryIdentifierTypes(query).map(
                        (userIdType) => (
                          <Badge
                            key={userIdType}
                            label={<Text mono>{userIdType}</Text>}
                            color="gray"
                          />
                        ),
                      )}
                    </Flex>
                    {canEdit && !isEventForwarderManaged(query) && (
                      <Button
                        variant="outline"
                        onClick={() => setQueryModal({ index })}
                      >
                        Edit query
                      </Button>
                    )}
                  </Flex>
                ))}
              </Box>
              {canEdit && (
                <Box mt="2">
                  <Button
                    variant="ghost"
                    icon={<PiPlus />}
                    disabled={!hasIdentifiers}
                    onClick={() =>
                      setQueryModal({
                        index: null,
                        identifierTypes: uncoveredIdentifierTypes.length
                          ? uncoveredIdentifierTypes
                          : identifierTypes.map((t) => t.userIdType),
                      })
                    }
                  >
                    Add query
                  </Button>
                </Box>
              )}
              <Flex align="center" justify="between" gap="3" mt="3">
                <Flex align="center" gap="3" flexShrink="0">
                  <Button
                    disabled={exposureQueries.length === 0}
                    onClick={() => setExpandedStep(null)}
                  >
                    Continue
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      onSkipExposureQuery();
                      setExpandedStep(null);
                    }}
                  >
                    Skip for now
                  </Button>
                </Flex>
                {exposureQueries.length > 0 &&
                  uncoveredIdentifierTypes.length > 0 && (
                    <HelperText status="warning" icon={null}>
                      No query returns{" "}
                      {uncoveredIdentifierTypes.map((userIdType, i) => (
                        <span key={userIdType}>
                          {i > 0 && ", "}
                          <Text mono>{userIdType}</Text>
                        </span>
                      ))}{" "}
                      yet. Add{" "}
                      {uncoveredIdentifierTypes.length === 1 ? "it" : "them"} to
                      an existing query or write a new one.
                    </HelperText>
                  )}
              </Flex>
            </Box>
          )}
      </SetupStepRow>

      <SetupStepRow
        number={stepNumber("factTable")}
        complete={!!completion.factTable}
        current={currentStep === "factTable"}
        expanded={false}
        title="Add a fact table"
        description={
          hasEventForwarder && !completion.factTable && completion.forwarder
            ? "An Events fact table was not created. Add one to continue."
            : hasEventForwarder
              ? "GrowthBook creates an Events fact table from the forwarded events once the Event Forwarder is configured and identifier types exist."
              : "A fact table is the first step to creating metrics. Tell us where and how your events (like an order, a page view, etc) are stored. This will be the basis for your metrics."
        }
        actions={
          completion.factTable
            ? doneActions()
            : hasEventForwarder && !completion.forwarder
              ? null
              : stepCta(
                  "factTable",
                  "Add fact table",
                  () => setFactTableOpen(true),
                  true,
                  {
                    allowed: canCreateFactTable,
                    deniedMessage:
                      "You don't have permission to add a fact table",
                  },
                )
        }
      />

      {queryModal && (
        <ExperimentAssignmentQueryModal
          dataSource={dataSource}
          exposureQuery={
            queryModal.index === null
              ? undefined
              : exposureQueries[queryModal.index]
          }
          defaultIdentifierTypes={queryModal.identifierTypes}
          onCancel={() => setQueryModal(null)}
          onSave={saveQuery}
        />
      )}
      {factTableOpen && (
        <NewFactTableModal
          datasourceId={dataSource.id}
          lockDatasource
          close={() => setFactTableOpen(false)}
        />
      )}
      {attributeModal && (
        <AttributeModal
          attribute={attributeModal.attribute ?? undefined}
          defaultHashAttribute
          defaultProjects={dataSource.projects ?? []}
          close={() => {
            setAttributeModal(null);
            if (hasEventForwarder) {
              void onRefresh();
            }
          }}
        />
      )}
    </>
  );
}

function IdentifierTableRow({
  row,
  muted,
  leading,
  actions,
  style,
}: {
  row: IdentifierRow;
  // Rows not in this Data Source read as unavailable.
  muted: boolean;
  leading: ReactNode;
  actions?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <Grid
      columns={IDENTIFIER_COLUMNS}
      gapX="4"
      align="center"
      px="4"
      py="3"
      style={style}
    >
      <Flex align="center" justify="center">
        {leading}
      </Flex>
      <Flex align="center" gap="2" minWidth="0">
        <Text mono truncate color={muted ? "text-low" : undefined}>
          {row.name}
        </Text>
        {row.isNew && <Badge label="New" color="violet" />}
      </Flex>
      <Text truncate color={muted ? "text-low" : "text-mid"}>
        {row.description}
      </Text>
      <Flex align="center" justify="end" gap="1">
        {actions}
      </Flex>
    </Grid>
  );
}

function SetupStepRow({
  number,
  complete,
  current,
  expanded,
  title,
  description,
  actions,
  children,
}: {
  number: number;
  complete: boolean;
  current: boolean;
  expanded: boolean;
  title: string;
  description: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Flex
      align="start"
      gap="3"
      px="6"
      py="4"
      style={{
        borderTop: "1px solid var(--gray-a4)",
        backgroundColor: expanded ? "var(--violet-a2)" : undefined,
      }}
    >
      <StepIndicator number={number} complete={complete} current={current} />
      <Box flexGrow="1" minWidth="0">
        <Flex align="center" justify="between" gap="4">
          <Box>
            <Text as="p" weight="semibold" mb="0">
              {title}
            </Text>
            <Text as="p" color="text-mid" mb="0">
              {description}
            </Text>
          </Box>
          {actions && <Box flexShrink="0">{actions}</Box>}
        </Flex>
        {children}
      </Box>
    </Flex>
  );
}

function StepIndicator({
  number,
  complete,
  current,
}: {
  number: number;
  complete: boolean;
  current: boolean;
}) {
  const style = complete
    ? { backgroundColor: "var(--green-a3)", color: "var(--green-11)" }
    : current
      ? { backgroundColor: "var(--violet-9)", color: "white" }
      : {
          boxShadow: "inset 0 0 0 1px var(--gray-a7)",
          color: "var(--gray-11)",
        };

  return (
    <Flex
      align="center"
      justify="center"
      flexShrink="0"
      style={{ width: 24, height: 24, borderRadius: "50%", ...style }}
    >
      {complete ? (
        <PiCheck size={15} />
      ) : (
        <Text size="sm" weight="semibold">
          {number}
        </Text>
      )}
    </Flex>
  );
}
