import { ReactNode, useMemo, useState } from "react";
import { Box, Flex, Grid, IconButton, Progress } from "@radix-ui/themes";
import { PiCheck, PiPlus, PiX } from "react-icons/pi";
import cloneDeep from "lodash/cloneDeep";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
  UserIdType,
} from "shared/types/datasource";
import {
  attributeMatchesDatasourceProjects,
  getExposureQueryIdentifierTypes,
  isEventForwarderManaged,
} from "shared/util";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import AttributeModal from "@/components/Features/AttributeModal";
import Modal from "@/ui/Modal";
import SchemaBrowser from "@/components/SchemaBrowser/SchemaBrowser";
import Link from "@/ui/Link";
import { AddEditExperimentAssignmentQueryModal } from "@/components/Settings/EditDataSource/ExperimentAssignmentQueries/AddEditExperimentAssignmentQueryModal";
import NewFactTableModal from "@/components/FactTables/NewFactTableModal";
import { dataSourceConnections } from "@/services/eventSchema";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import { TextField } from "@/ui/TextField";

type StepId = "connect" | "identifiers" | "queries" | "factTable";

// One row per attribute the org marked as a unique identifier. The user maps
// each to the column that holds it in this Data Source.
type IdentifierRow = {
  attribute: string;
  // The identifier type already linked to this attribute, if any. Its column
  // can't be renamed because assignment queries reference it.
  saved: UserIdType | null;
};

type QueryModal = { identifierType: string; index: number | null } | null;

const EXPANDABLE_STEPS: StepId[] = ["identifiers", "queries"];

const IDENTIFIER_PATTERN = /^[a-z_]+$/;

// Attribute name, column input, remove button.
const IDENTIFIER_COLUMNS = "minmax(0, 1fr) minmax(0, 2fr) 32px";

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
    queries:
      identifierTypes.length > 0 &&
      identifierTypes.every(({ userIdType }) =>
        exposureQueries.some((query) =>
          getExposureQueryIdentifierTypes(query).includes(userIdType),
        ),
      ),
    factTable: factTableCount > 0,
  };
}

// The column a "deviceId" or "Device-ID" attribute most likely lives in: device_id.
function defaultColumnName(attribute: string): string {
  return attribute
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// On a Data Source that already has identifiers, attributes it never mapped
// stay out of the table until the user adds them back.
function getUnmappedAttributes(
  dataSource: DataSourceInterfaceWithParams,
  hashAttributes: string[],
): string[] {
  const identifierTypes = dataSource.settings?.userIdTypes ?? [];
  if (!identifierTypes.length) return [];
  return hashAttributes.filter(
    (attribute) =>
      !identifierTypes.some((type) => type.attributes?.includes(attribute)),
  );
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
  const hashAttributes = useMemo(
    () =>
      (attributeSchema ?? [])
        .filter(
          (attribute) =>
            attribute.hashAttribute &&
            attributeMatchesDatasourceProjects(attribute, dataSource.projects),
        )
        .map(({ property }) => property),
    [attributeSchema, dataSource.projects],
  );
  const canCreateAttribute = permissionsUtil.canCreateAttribute({
    projects: dataSource.projects ?? [],
  });

  const [expandedStep, setExpandedStep] = useState<StepId | null>(() =>
    currentStep && EXPANDABLE_STEPS.includes(currentStep) ? currentStep : null,
  );
  // Column names typed per attribute; anything not typed yet falls back to the
  // saved identifier type or the attribute's own name.
  const [columnDrafts, setColumnDrafts] = useState<Record<string, string>>({});
  // Attributes the org tracks but doesn't want as identifiers in this Data Source.
  const [removedAttributes, setRemovedAttributes] = useState<string[]>(() =>
    getUnmappedAttributes(dataSource, hashAttributes),
  );
  const [identifierError, setIdentifierError] = useState<string | null>(null);
  const [attributeModalOpen, setAttributeModalOpen] = useState(false);
  const [schemaBrowserOpen, setSchemaBrowserOpen] = useState(false);
  const [queryModal, setQueryModal] = useState<QueryModal>(null);
  const [factTableOpen, setFactTableOpen] = useState(false);

  const identifierTypes = dataSource.settings?.userIdTypes ?? [];
  const exposureQueries = dataSource.settings?.queries?.exposure ?? [];
  const hasIdentifiers = identifierTypes.length > 0;

  const identifierRows: IdentifierRow[] = hashAttributes
    .filter((attribute) => !removedAttributes.includes(attribute))
    .map((attribute) => ({
      attribute,
      saved:
        identifierTypes.find((type) => type.attributes?.includes(attribute)) ??
        null,
    }));
  // Identifier types with no linked attribute (legacy or Event Forwarder
  // managed) are kept as-is on save.
  const unlinkedIdentifierTypes = identifierTypes.filter(
    (type) => !type.attributes?.some((a) => hashAttributes.includes(a)),
  );

  const dataSourceName =
    dataSourceConnections.find((c) => c.type === dataSource.type)?.display ??
    "Data Source";

  // Lets the user check real table and column names while filling in a step.
  const browseTablesLink = dataSource.properties?.supportsInformationSchema ? (
    <Text size="sm" color="text-mid">
      Not sure about table or column names?{" "}
      <Link size="sm" onClick={() => setSchemaBrowserOpen(true)}>
        Browse data source
      </Link>
    </Text>
  ) : null;

  const openIdentifiers = () => {
    setColumnDrafts({});
    setRemovedAttributes(getUnmappedAttributes(dataSource, hashAttributes));
    setIdentifierError(null);
    setExpandedStep("identifiers");
  };

  const removeAttribute = (attribute: string) => {
    setIdentifierError(null);
    setRemovedAttributes((prev) => [...prev, attribute]);
  };

  const restoreAttribute = (attribute: string) => {
    setIdentifierError(null);
    setRemovedAttributes((prev) => prev.filter((a) => a !== attribute));
  };

  const getColumn = ({ attribute, saved }: IdentifierRow) =>
    columnDrafts[attribute] ?? saved?.userIdType ?? "";

  const saveIdentifiers = async () => {
    if (!identifierRows.length) {
      throw new Error("Add at least one identifier");
    }

    // Several attributes may point at the same column; they share one
    // identifier type with every attribute linked.
    const byColumn = new Map<string, UserIdType>();
    for (const row of identifierRows) {
      const column = getColumn(row).trim() || defaultColumnName(row.attribute);
      if (!IDENTIFIER_PATTERN.test(column)) {
        throw new Error(
          `The column for "${row.attribute}" can only contain lowercase letters and underscores`,
        );
      }
      const existing = byColumn.get(column);
      if (existing) {
        existing.attributes = [...(existing.attributes ?? []), row.attribute];
        continue;
      }
      const saved =
        row.saved ??
        identifierTypes.find((type) => type.userIdType === column) ??
        null;
      byColumn.set(column, {
        ...saved,
        userIdType: column,
        description:
          saved?.description ?? DEFAULT_IDENTIFIER_DESCRIPTIONS[column] ?? "",
        // Keep links to attributes outside this Data Source's projects.
        attributes: [
          ...(saved?.attributes ?? []).filter(
            (a) => !hashAttributes.includes(a),
          ),
          row.attribute,
        ],
      });
    }
    for (const type of unlinkedIdentifierTypes) {
      if (!byColumn.has(type.userIdType)) byColumn.set(type.userIdType, type);
    }

    const copy = cloneDeep(dataSource);
    copy.settings = {
      ...copy.settings,
      userIdTypes: Array.from(byColumn.values()),
    };
    await onSave(copy);
    setColumnDrafts({});
    setRemovedAttributes(getUnmappedAttributes(copy, hashAttributes));
    setExpandedStep(
      getCompletion(copy, factTableCount).queries ? null : "queries",
    );
  };

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
            {/* We don&apos;t assume anything about your data. Tell GrowthBook where
            to find experiment exposures and metrics. You can change all of this
            later. */}
            Tell GrowthBook a bit more about how you identifier your users,
            where `events` are stored in your warehouse.
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
        title="Add identifier types"
        description={
          expandedStep !== "identifiers" && hasIdentifiers
            ? identifierTypes.map((t) => t.userIdType).join(", ")
            : "Tell us how you identify your users. E.G. Do you use userid or user_id? You can add multiple identifiers, but you must add atleast one."
        }
        actions={
          expandedStep === "identifiers"
            ? null
            : completion.identifiers
              ? doneActions(openIdentifiers)
              : stepCta(
                  "identifiers",
                  "Add identifiers",
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
              <Grid
                columns={IDENTIFIER_COLUMNS}
                gapX="4"
                px="4"
                py="3"
                style={{ background: "var(--gray-a2)" }}
              >
                <Text size="sm" color="text-mid">
                  Identifier
                </Text>
                <Text size="sm" color="text-mid">
                  Column in this data source
                </Text>
                <Box />
              </Grid>
              {identifierRows.length === 0 && (
                <Box px="4" py="3">
                  <Text as="p" color="text-mid" mb="0">
                    {hashAttributes.length
                      ? "No identifiers in this Data Source. Add one to map it to a column."
                      : "No attributes are marked as unique identifiers yet. Add one to map it to a column."}
                  </Text>
                </Box>
              )}
              {identifierRows.map((row) => {
                const managed =
                  !!row.saved && isEventForwarderManaged(row.saved);
                return (
                  <Grid
                    key={row.attribute}
                    columns={IDENTIFIER_COLUMNS}
                    gapX="4"
                    align="center"
                    px="4"
                    py="3"
                    style={{ borderTop: "1px solid var(--gray-a5)" }}
                  >
                    <Text mono>{row.attribute}</Text>
                    <TextField
                      value={getColumn(row)}
                      placeholder={defaultColumnName(row.attribute)}
                      readOnly={!!row.saved}
                      disabled={!canEdit}
                      style={{ fontFamily: "var(--code-font-family)" }}
                      aria-label={`Column for ${row.attribute}`}
                      onChange={(e) => {
                        setIdentifierError(null);
                        setColumnDrafts((prev) => ({
                          ...prev,
                          [row.attribute]: e.target.value,
                        }));
                      }}
                    />
                    {canEdit && !managed && identifierRows.length > 1 ? (
                      <IconButton
                        variant="ghost"
                        color="gray"
                        aria-label={`Remove ${row.attribute}`}
                        onClick={() => removeAttribute(row.attribute)}
                      >
                        <PiX />
                      </IconButton>
                    ) : (
                      <Box />
                    )}
                  </Grid>
                );
              })}
            </Box>
            <Flex align="center" justify="between" gap="3" mt="2">
              {canEdit &&
              (canCreateAttribute || removedAttributes.length > 0) ? (
                <Box>
                  {removedAttributes.length > 0 ? (
                    <DropdownMenu
                      trigger={
                        <Button variant="ghost" icon={<PiPlus />}>
                          Add identifier
                        </Button>
                      }
                    >
                      {removedAttributes.map((attribute) => (
                        <DropdownMenuItem
                          key={attribute}
                          onClick={() => restoreAttribute(attribute)}
                        >
                          <Text mono>{attribute}</Text>
                        </DropdownMenuItem>
                      ))}
                      {canCreateAttribute && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setAttributeModalOpen(true)}
                          >
                            Create new
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenu>
                  ) : (
                    <Button
                      variant="ghost"
                      icon={<PiPlus />}
                      onClick={() => setAttributeModalOpen(true)}
                    >
                      Add identifier
                    </Button>
                  )}
                </Box>
              ) : (
                <Box />
              )}
              {browseTablesLink}
            </Flex>
            {identifierError && (
              <HelperText status="error" mt="2">
                {identifierError}
              </HelperText>
            )}
            {canEdit && (
              <Flex mt="3" gap="3" align="center">
                <Button onClick={saveIdentifiers} setError={setIdentifierError}>
                  Save and continue
                </Button>
                {hasIdentifiers && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setIdentifierError(null);
                      setExpandedStep(null);
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </Flex>
            )}
          </Box>
        )}
      </SetupStepRow>

      <SetupStepRow
        number={3}
        complete={completion.queries}
        current={currentStep === "queries"}
        expanded={expandedStep === "queries"}
        title="Add exposure queries"
        description="SQL that tells GrowthBook who saw which variation, and when. Add one for each identifier you run experiments on. Most teams start with one."
        actions={
          expandedStep === "queries"
            ? null
            : completion.queries
              ? doneActions(() => setExpandedStep("queries"))
              : stepCta(
                  "queries",
                  "Write queries",
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
              {identifierTypes.map(({ userIdType }, i) => {
                const index = exposureQueries.findIndex((query) =>
                  getExposureQueryIdentifierTypes(query).includes(userIdType),
                );
                const query = index === -1 ? null : exposureQueries[index];
                return (
                  <Flex
                    key={userIdType}
                    align="center"
                    justify="between"
                    gap="3"
                    px="4"
                    py="3"
                    style={
                      i > 0
                        ? { borderTop: "1px solid var(--gray-a5)" }
                        : undefined
                    }
                  >
                    <Flex align="center" gap="2">
                      <Text mono>{userIdType}</Text>
                      {query ? (
                        <Text size="sm" color="text-mid">
                          {query.name}
                        </Text>
                      ) : (
                        <Badge label="No query yet" color="gray" />
                      )}
                    </Flex>
                    {canEdit && (
                      <Button
                        variant="outline"
                        onClick={() =>
                          setQueryModal({
                            identifierType: userIdType,
                            index: query ? index : null,
                          })
                        }
                      >
                        {query ? "Edit query" : "Write query"}
                      </Button>
                    )}
                  </Flex>
                );
              })}
            </Box>
            {browseTablesLink && (
              <Flex justify="end" mt="2">
                {browseTablesLink}
              </Flex>
            )}
            <Flex align="center" justify="between" gap="3" mt="3">
              <Box>
                {!completion.queries && (
                  <HelperText status="warning" icon={null}>
                    {exposureQueries.length ? (
                      "Every identifier type needs an exposure query before you can run experiments on it."
                    ) : (
                      <>
                        Add at least one exposure query to run experiments. Most
                        teams start with <Text mono>user_id</Text>.
                      </>
                    )}
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
          defaultIdentifierType={queryModal.identifierType}
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
      {attributeModalOpen && (
        <AttributeModal
          initialValues={{ hashAttribute: true }}
          close={() => setAttributeModalOpen(false)}
        />
      )}
      {schemaBrowserOpen && (
        <Modal.Root
          open
          onOpenChange={(open) => {
            if (!open) setSchemaBrowserOpen(false);
          }}
          size="lg"
          dismissible
          trackingEventModalType="finish-setting-up-schema-browser"
        >
          <Modal.Header>
            <Modal.Title>Browse Data Source</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Box height="600px" style={{ maxHeight: "calc(100vh - 240px)" }}>
              <SchemaBrowser datasource={dataSource} />
            </Box>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" onClick={() => setSchemaBrowserOpen(false)}>
              Close
            </Button>
          </Modal.Footer>
        </Modal.Root>
      )}
    </>
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
