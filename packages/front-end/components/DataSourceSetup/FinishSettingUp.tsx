import { CSSProperties, ReactNode, useMemo, useState } from "react";
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
  isValidUserIdTypeName,
  USER_ID_TYPE_NAME_RULE,
} from "shared/util";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import AttributeModal from "@/components/Features/AttributeModal";
import Link from "@/ui/Link";
import { AddEditExperimentAssignmentQueryModal } from "@/components/Settings/EditDataSource/ExperimentAssignmentQueries/AddEditExperimentAssignmentQueryModal";
import NewFactTableModal from "@/components/FactTables/NewFactTableModal";
import { dataSourceConnections } from "@/services/eventSchema";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Checkbox from "@/ui/Checkbox";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";

type StepId = "connect" | "identifiers" | "queries" | "factTable";

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

const EXPANDABLE_STEPS: StepId[] = ["identifiers", "queries"];

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

function getCompletion(
  dataSource: DataSourceInterfaceWithParams,
  factTableCount: number,
): Record<StepId, boolean> {
  const identifierTypes = dataSource.settings?.userIdTypes ?? [];
  const exposureQueries = dataSource.settings?.queries?.exposure ?? [];
  return {
    connect: true,
    identifiers: identifierTypes.length > 0,
    // One exposure query is enough. Identifier types are also used for joins
    // and metrics, so they don't each need to appear in an exposure query.
    queries: exposureQueries.length > 0,
    factTable: factTableCount > 0,
  };
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
): boolean {
  return Object.values(getCompletion(dataSource, factTableCount)).every(
    Boolean,
  );
}

export default function FinishSettingUp({
  dataSource,
  factTableCount,
  canEdit,
  onSave,
}: {
  dataSource: DataSourceInterfaceWithParams;
  factTableCount: number;
  canEdit: boolean;
  onSave: (dataSource: DataSourceInterfaceWithParams) => Promise<void>;
}) {
  const completion = useMemo(
    () => getCompletion(dataSource, factTableCount),
    [dataSource, factTableCount],
  );
  const stepIds = Object.keys(completion) as StepId[];
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

  const [expandedStep, setExpandedStep] = useState<StepId | null>(() =>
    currentStep && EXPANDABLE_STEPS.includes(currentStep) ? currentStep : null,
  );
  const [identifierMode, setIdentifierMode] = useState<IdentifierMode>("view");
  // Rows the user has left out of this Data Source.
  const [excludedKeys, setExcludedKeys] = useState<string[]>(() =>
    getExcludedKeys(dataSource, hashAttributeNames),
  );
  // Checkbox state while editing; discarded on cancel.
  const [editSelection, setEditSelection] = useState<Record<string, boolean>>(
    {},
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

  const identifierRows: IdentifierRow[] = [
    ...hashAttributes.map(({ property, description }) => {
      const key = attributeKey(property);
      const saved =
        identifierTypes.find((type) => type.attributes?.includes(property)) ??
        null;
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
    // Saved types with no linked attribute (legacy or Event Forwarder managed).
    ...identifierTypes
      .filter(
        (type) => !type.attributes?.some((a) => hashAttributeNames.includes(a)),
      )
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
  const selectedCount = identifierRows.filter(
    (row) => editSelection[row.key],
  ).length;

  const dataSourceName =
    dataSourceConnections.find((c) => c.type === dataSource.type)?.display ??
    "Data Source";

  const openIdentifiers = () => {
    setExcludedKeys(getExcludedKeys(dataSource, hashAttributeNames));
    setIdentifierMode("view");
    setIdentifierError(null);
    setExpandedStep("identifiers");
  };

  const startEditing = () => {
    setIdentifierError(null);
    setEditSelection(
      Object.fromEntries(identifierRows.map((row) => [row.key, row.included])),
    );
    setIdentifierMode("edit");
  };

  const applySelection = () => {
    setExcludedKeys(
      identifierRows
        .filter((row) => !editSelection[row.key])
        .map((row) => row.key),
    );
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
      if (!isValidUserIdTypeName(row.name)) {
        throw new Error(
          `"${row.name}" is not a valid identifier type name. ${USER_ID_TYPE_NAME_RULE}`,
        );
      }
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
      getCompletion(copy, factTableCount).queries ? null : "queries",
    );
  };

  const identifierDescription =
    expandedStep === "identifiers"
      ? "Identifier types let you split traffic in an experiment and track metric conversions. Click Edit to uncheck any that aren't relevant for this Data Source."
      : hasIdentifiers
        ? identifierTypes.map((t) => t.userIdType).join(", ")
        : "Tell us how you identify your users, such as user_id or anonymous_id. You can add several identifier types, but you need at least one.";

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
  ) => {
    const blocked = requiresIdentifiers && !hasIdentifiers;
    return (
      <Flex direction="column" align="end" gap="1">
        <Button
          variant={step === currentStep ? "solid" : "outline"}
          disabled={!canEdit || blocked}
          onClick={onClick}
        >
          {label}
        </Button>
        {blocked && (
          <Text size="sm" color="text-mid">
            Needs an identifier type
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
            Tell GrowthBook how you identify your users and where events are
            stored in your warehouse.
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
        number={1}
        complete
        current={false}
        expanded={false}
        title={`Connect to ${dataSourceName}`}
        description="Connection and read access verified"
        actions={doneActions()}
      />

      <SetupStepRow
        number={2}
        complete={completion.identifiers}
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
                        value={!!editSelection[row.key]}
                        disabled={row.managed}
                        setValue={(checked) =>
                          setEditSelection((prev) => ({
                            ...prev,
                            [row.key]: checked,
                          }))
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
                    <Button onClick={applySelection}>Save</Button>
                    <Button
                      variant="ghost"
                      onClick={() => setIdentifierMode("view")}
                    >
                      Cancel
                    </Button>
                  </Flex>
                  <Text size="sm" color="text-mid">
                    {selectedCount} of {identifierRows.length} selected
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
                      Manage Attributes
                    </Link>
                  </Text>
                </>
              )}
            </Flex>
          </Box>
        )}
      </SetupStepRow>

      <SetupStepRow
        number={3}
        complete={completion.queries}
        current={currentStep === "queries"}
        expanded={expandedStep === "queries"}
        title="Add exposure queries"
        description="SQL that tells GrowthBook who saw which variation of an experiment, and when. Every identifier type needs to be in at least one query; a single query can cover several."
        actions={
          expandedStep === "queries"
            ? null
            : completion.queries
              ? doneActions(() => setExpandedStep("queries"))
              : stepCta(
                  "queries",
                  "Write query",
                  () => setExpandedStep("queries"),
                  true,
                )
        }
      >
        {expandedStep === "queries" && (
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
                    No exposure queries yet.{" "}
                    {identifierTypes.length > 1
                      ? "Write one query that returns every identifier type, or split them across queries if they live in different tables."
                      : "Write one to start running experiments."}
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
                  {canEdit && (
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
                  onClick={() =>
                    setQueryModal({
                      index: null,
                      identifierTypes: uncoveredIdentifierTypes.length
                        ? uncoveredIdentifierTypes
                        : identifierTypes.map((t) => t.userIdType),
                    })
                  }
                >
                  {exposureQueries.length ? "Add query" : "Write query"}
                </Button>
              </Box>
            )}
            <Flex align="center" justify="between" gap="3" mt="3">
              <Box>
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
              </Box>
              <Flex align="center" gap="3" flexShrink="0">
                <Button variant="ghost" onClick={() => setExpandedStep(null)}>
                  Close
                </Button>
                <Button
                  disabled={!completion.queries}
                  onClick={() => setExpandedStep(null)}
                >
                  Continue
                </Button>
              </Flex>
            </Flex>
          </Box>
        )}
      </SetupStepRow>

      <SetupStepRow
        number={4}
        complete={completion.factTable}
        current={currentStep === "factTable"}
        expanded={false}
        title="Add a fact table"
        description="A fact table is the first step to creating metrics. Tell us where and how your events (like an order, a page view, etc) are stored. This will be the basis for your metrics."
        actions={
          completion.factTable
            ? doneActions()
            : stepCta(
                "factTable",
                "Add fact table",
                () => setFactTableOpen(true),
                true,
              )
        }
      />

      {queryModal && (
        <AddEditExperimentAssignmentQueryModal
          dataSource={dataSource}
          mode={queryModal.index === null ? "add" : "edit"}
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
          close={() => setFactTableOpen(false)}
        />
      )}
      {attributeModal && (
        <AttributeModal
          attribute={attributeModal.attribute ?? undefined}
          defaultHashAttribute
          close={() => setAttributeModal(null)}
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
