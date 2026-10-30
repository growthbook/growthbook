import { useState } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { SDKAttribute, SDKAttributeType } from "shared/types/organization";
import { getDefaultProjectsForNewResource } from "shared/demo-datasource";
import {
  attributeMatchesDatasourceProjects,
  attributeToUserIdTypeName,
} from "shared/util";
import { PiDatabase, PiLockSimple } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useProjectOptions from "@/hooks/useProjectOptions";
import { useReconciledCustomFields } from "@/hooks/useReconciledCustomFields";
import { useAttributeReferences } from "@/hooks/useAttributeReferences";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import TextField from "@/ui/TextField";
import MultiSelectField from "@/ui/MultiSelectField";
import Checkbox from "@/ui/Checkbox";
import Text from "@/ui/Text";
import HelperText from "@/ui/HelperText";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import { Select, SelectItem, SelectSeparator } from "@/ui/Select";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import TagsInput from "@/components/Tags/TagsInput";
import CustomFieldInput from "@/components/CustomFields/CustomFieldInput";
import AddAttributeSnippet from "@/components/SyntaxHighlighting/Snippets/AddAttributeSnippet";

const ADD_COLUMNS = "minmax(0, 1fr) 160px";
const EDIT_COLUMNS = "minmax(0, 1fr) 200px 140px";
const ROW_BORDER = { borderTop: "1px solid var(--gray-a5)" };
const PLACEHOLDER_NAME = "newIdentifier";
const PANEL_WIDTH = 380;
// Select value for creating a type named after the identifier.
const NEW_TYPE = "__new__";

// The data types an attribute can be a unique identifier with.
const IDENTIFIER_DATATYPES: { value: SDKAttributeType; label: string }[] = [
  { value: "string", label: "String" },
  { value: "number", label: "Number" },
  { value: "secureString", label: "Secure string" },
];

// These rebuild their identifier types from the attribute schema on their own.
function syncsIdentifiersAutomatically(
  datasource: DataSourceInterfaceWithParams,
) {
  return (
    datasource.type === "growthbook_clickhouse" ||
    !!datasource.eventForwarderConfig
  );
}

function userIdTypeNames(datasource: DataSourceInterfaceWithParams) {
  return (datasource.settings.userIdTypes ?? []).map((t) => t.userIdType);
}

function UsageBadge({
  datasource,
  userIdType,
}: {
  datasource: DataSourceInterfaceWithParams;
  userIdType: string | null;
}) {
  if (!userIdType || !userIdTypeNames(datasource).includes(userIdType)) {
    return <Badge label="New" color="violet" variant="soft" />;
  }
  const count = (datasource.settings.queries?.exposure ?? []).filter(
    (q) => q.userIdType === userIdType || q.userIdTypes?.includes(userIdType),
  ).length;
  return count > 0 ? (
    <Badge
      label={`Used in ${count} ${count === 1 ? "query" : "queries"}`}
      color="green"
      variant="soft"
    />
  ) : (
    <Badge label="Not used yet" color="gray" variant="soft" />
  );
}

export default function IdentifierModal({
  close,
  onSave,
  existing,
  defaultProjects,
  source,
  onOpenAttributeSettings,
}: {
  close: () => void;
  onSave?: (property: string) => void;
  existing?: SDKAttribute;
  defaultProjects?: string[];
  source: string;
  // Opens the settings identifiers don't show, like turning the identifier off.
  onOpenAttributeSettings?: () => void;
}) {
  const { project, datasources, mutateDefinitions } = useDefinitions();
  const { refreshOrganization } = useUser();
  const { apiCall, orgId } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const isEdit = !!existing;

  const [name, setName] = useState(existing?.property ?? "");
  const [projects, setProjects] = useState<string[]>(
    () =>
      existing?.projects ??
      defaultProjects ??
      getDefaultProjectsForNewResource({
        project,
        organizationId: orgId || undefined,
      }),
  );
  const [datatype, setDatatype] = useState<SDKAttributeType>(
    existing?.datatype ?? "string",
  );
  const [tags, setTags] = useState<string[]>(existing?.tags ?? []);
  const [description, setDescription] = useState(existing?.description ?? "");
  const [customFields, setCustomFields] = useState<Record<string, string>>(
    existing?.customFields ?? {},
  );
  // Add: Data Sources the user unchecked. Edit: the type picked per Data Source.
  const [uncheckedIds, setUncheckedIds] = useState<string[]>([]);
  const [picks, setPicks] = useState<Record<string, string>>({});

  const renamed = isEdit && name.trim() !== existing.property;
  const { references } = useAttributeReferences(
    renamed ? [existing.property] : [],
  );
  const refs = existing ? references?.[existing.property] : undefined;
  const refCount = refs
    ? refs.features.length + refs.experiments.length + refs.savedGroups.length
    : 0;

  const projectOptions = useProjectOptions(
    (p) =>
      existing
        ? permissionsUtil.canUpdateAttribute({ projects: [p] }, {})
        : permissionsUtil.canCreateAttribute({ projects: [p] }),
    projects,
  );
  const canSave = existing
    ? permissionsUtil.canUpdateAttribute(existing, { projects })
    : permissionsUtil.canCreateAttribute({ projects });

  const { availableFields: availableCustomFields, value: customFieldValues } =
    useReconciledCustomFields({
      section: "attribute",
      projects,
      value: customFields,
      setValue: setCustomFields,
    });

  const newProperty = name.trim() || PLACEHOLDER_NAME;
  const defaultType = attributeToUserIdTypeName(newProperty);
  const linkedType = (d: DataSourceInterfaceWithParams) =>
    existing
      ? (d.settings.userIdTypes?.find((t) =>
          t.attributes?.includes(existing.property),
        )?.userIdType ?? null)
      : null;
  const canEdit = (d: DataSourceInterfaceWithParams) =>
    permissionsUtil.canUpdateDataSourceSettings(d);

  const shown = datasources.filter(
    (d) =>
      !!linkedType(d) ||
      attributeMatchesDatasourceProjects(
        { property: name, datatype: "string", projects },
        d.projects,
      ),
  );
  const automatic = shown.filter(syncsIdentifiersAutomatically);
  const mappable = shown.filter((d) => !syncsIdentifiersAutomatically(d));

  const pickedType = (d: DataSourceInterfaceWithParams) => {
    const pick = picks[d.id];
    return pick === NEW_TYPE ? defaultType : pick || null;
  };
  // Add links every checked Data Source to the default type. Edit links each
  // checked Data Source to the type picked for it.
  const links = mappable.flatMap((d) => {
    if (!canEdit(d)) return [];
    if (!isEdit) {
      return uncheckedIds.includes(d.id)
        ? []
        : [{ id: d.id, userIdType: defaultType }];
    }
    if (linkedType(d) || !(d.id in picks)) return [];
    return [{ id: d.id, userIdType: pickedType(d) ?? "" }];
  });
  const missingPick = links.some((l) => !l.userIdType);

  const shownTypes = [
    ...new Set([
      ...mappable.flatMap((d) => linkedType(d) ?? []),
      ...links.map((l) => l.userIdType).filter(Boolean),
    ]),
  ];

  // Picks the type named after the identifier when the Data Source has one,
  // and leaves the choice to the user when it has other types.
  const defaultPick = (d: DataSourceInterfaceWithParams) => {
    const types = userIdTypeNames(d);
    if (types.includes(defaultType)) return defaultType;
    return types.length ? "" : NEW_TYPE;
  };

  const columns = isEdit ? EDIT_COLUMNS : ADD_COLUMNS;

  return (
    <ModalStandard
      open={true}
      header={isEdit ? "Edit Identifier" : "Add Identifier"}
      cta={isEdit ? "Save" : "Add Identifier"}
      size="xl"
      ctaEnabled={canSave && !!name.trim() && !missingPick}
      trackingEventModalType={isEdit ? "edit-identifier" : "add-identifier"}
      trackingEventModalSource={source}
      close={close}
      secondaryAction={
        onOpenAttributeSettings && (
          <Button variant="ghost" onClick={onOpenAttributeSettings}>
            All attribute settings
          </Button>
        )
      }
      submit={async () => {
        const property = name.trim();
        const res = await apiCall<{ failedDatasources: string[] }>(
          "/attribute/identifier",
          {
            method: isEdit ? "PUT" : "POST",
            body: JSON.stringify({
              property,
              ...(renamed && { previousName: existing.property }),
              datatype,
              description,
              tags,
              ...(availableCustomFields.length > 0 && {
                customFields: customFieldValues,
              }),
              projects,
              datasources: links,
            }),
          },
        );
        await Promise.all([refreshOrganization(), mutateDefinitions()]);
        onSave?.(property);
        if (res.failedDatasources.length > 0) {
          throw new Error(
            `${property} was saved, but ${res.failedDatasources.join(", ")} couldn't be updated. Link it from each Data Source's identifier types.`,
          );
        }
      }}
    >
      <Grid columns={`minmax(0, 1fr) ${PANEL_WIDTH}px`} gap="6">
        <Flex direction="column" gap="5" style={{ minWidth: 0 }}>
          <TextField
            label="Name"
            required
            markRequired
            autoFocus={!isEdit}
            value={name}
            placeholder={PLACEHOLDER_NAME}
            onChange={(e) => setName(e.target.value)}
            helpText="Must match the key your SDK passes in."
          />
          {renamed && (
            <Callout status="warning">
              Renaming doesn&apos;t update targeting that uses{" "}
              <code>{existing.property}</code>
              {refCount > 0 &&
                ` (${refCount} ${refCount === 1 ? "reference" : "references"})`}
              . It keeps using the old name until you change it.
            </Callout>
          )}
          <Flex direction="column" gap="2">
            <Text weight="medium">Description</Text>
            <MarkdownInput value={description} setValue={setDescription} />
          </Flex>
          <Select
            label="Data type"
            value={datatype}
            setValue={(v) =>
              setDatatype(
                IDENTIFIER_DATATYPES.find((d) => d.value === v)?.value ??
                  "string",
              )
            }
          >
            {IDENTIFIER_DATATYPES.map((d) => (
              <SelectItem key={d.value} value={d.value}>
                {d.label}
              </SelectItem>
            ))}
          </Select>
          <MultiSelectField
            label="Projects"
            placeholder="All Projects"
            value={projects}
            options={projectOptions}
            onChange={setProjects}
          />
          <TagsInput
            label="Tags"
            value={tags}
            onChange={setTags}
            autoFocus={false}
          />
          {availableCustomFields.length > 0 && (
            <CustomFieldInput
              fields={availableCustomFields}
              value={customFieldValues}
              onChange={setCustomFields}
            />
          )}

          {shown.length > 0 && (
            <Flex direction="column" gap="2">
              <Box>
                <Text weight="semibold">Data Sources</Text>
                <Text as="p" size="sm" color="text-low">
                  {isEdit ? (
                    <>
                      Link this identifier in more Data Sources so experiments
                      using it pick the right assignment query. Change existing
                      links from the Data Source.
                    </>
                  ) : (
                    <>
                      Adds the identifier type <code>{defaultType}</code> to
                      each Data Source you check.
                    </>
                  )}
                </Text>
              </Box>
              {mappable.length > 0 && (
                <Box
                  style={{
                    border: "1px solid var(--gray-a5)",
                    borderRadius: "var(--radius-3)",
                  }}
                >
                  <Grid
                    columns={columns}
                    gap="3"
                    px="3"
                    py="2"
                    style={{ background: "var(--gray-a2)" }}
                  >
                    <Box pl="5">
                      <Text size="sm" color="text-mid">
                        Data Source
                      </Text>
                    </Box>
                    {isEdit && (
                      <Text size="sm" color="text-mid">
                        Identifier type
                      </Text>
                    )}
                    <Text size="sm" color="text-mid">
                      Assignment queries
                    </Text>
                  </Grid>
                  {mappable.map((d) => {
                    const editable = canEdit(d);
                    const linked = linkedType(d);
                    const isChecked = isEdit
                      ? !!linked || d.id in picks
                      : editable && !uncheckedIds.includes(d.id);
                    const type = isEdit
                      ? (linked ?? pickedType(d))
                      : defaultType;
                    return (
                      <Grid
                        key={d.id}
                        columns={columns}
                        gap="3"
                        px="3"
                        py="2"
                        align="center"
                        style={ROW_BORDER}
                      >
                        <Checkbox
                          label={
                            <Flex align="center" gap="2">
                              <PiDatabase />
                              <Text color={isChecked ? undefined : "text-low"}>
                                {d.name}
                              </Text>
                            </Flex>
                          }
                          weight="medium"
                          align="center"
                          description={
                            !isEdit && userIdTypeNames(d).includes(defaultType)
                              ? `Already has ${defaultType}`
                              : undefined
                          }
                          value={isChecked}
                          disabled={!!linked || !editable}
                          disabledMessage={
                            linked
                              ? undefined
                              : "You don't have permission to edit this Data Source"
                          }
                          setValue={(v) => {
                            if (isEdit) {
                              setPicks((p) => {
                                const next = { ...p };
                                if (v) next[d.id] = defaultPick(d);
                                else delete next[d.id];
                                return next;
                              });
                            } else {
                              setUncheckedIds((ids) =>
                                v
                                  ? ids.filter((id) => id !== d.id)
                                  : [...ids, d.id],
                              );
                            }
                          }}
                        />
                        {isEdit &&
                          (linked ? (
                            <Text size="sm" color="text-mid">
                              <code>{linked}</code>
                            </Text>
                          ) : (
                            <Select
                              size="sm"
                              value={picks[d.id] || undefined}
                              placeholder="Choose a type"
                              disabled={!(d.id in picks)}
                              aria-label={`Identifier type in ${d.name}`}
                              setValue={(v) =>
                                setPicks((p) => ({ ...p, [d.id]: v }))
                              }
                            >
                              {userIdTypeNames(d).map((t) => (
                                <SelectItem key={t} value={t}>
                                  {t}
                                </SelectItem>
                              ))}
                              {!userIdTypeNames(d).includes(defaultType) && (
                                <>
                                  {userIdTypeNames(d).length > 0 && (
                                    <SelectSeparator />
                                  )}
                                  <SelectItem value={NEW_TYPE}>
                                    New type: {defaultType}
                                  </SelectItem>
                                </>
                              )}
                            </Select>
                          ))}
                        <Box>
                          {isChecked && (
                            <UsageBadge datasource={d} userIdType={type} />
                          )}
                        </Box>
                      </Grid>
                    );
                  })}
                </Box>
              )}
              {automatic.length > 0 && (
                <Flex align="center" gap="2">
                  <PiLockSimple color="var(--gray-11)" />
                  <HelperText status="info">
                    {new Intl.ListFormat("en").format(
                      automatic.map((d) => d.name),
                    )}{" "}
                    {automatic.length === 1
                      ? "updates its identifiers automatically."
                      : "update their identifiers automatically."}
                  </HelperText>
                </Flex>
              )}
            </Flex>
          )}
        </Flex>

        <Flex
          direction="column"
          gap="5"
          p="4"
          style={{
            alignSelf: "start",
            position: "sticky",
            top: 0,
            minWidth: 0,
            background: "var(--gray-a2)",
            border: "1px solid var(--gray-a4)",
            borderRadius: "var(--radius-3)",
          }}
        >
          <AddAttributeSnippet
            property={newProperty}
            value={datatype === "number" ? 123 : "foo"}
            projects={projects}
          />
          {shownTypes.length > 0 && (
            <Flex direction="column" gap="2">
              <Flex align="center" gap="2">
                <PiDatabase />
                <Text weight="semibold" color="text-mid">
                  In your assignment queries &amp; fact tables
                </Text>
              </Flex>
              <Text size="sm">
                When you set up an assignment query or fact table, map{" "}
                {shownTypes.map((t, i) => (
                  <span key={t}>
                    {i > 0 && (i === shownTypes.length - 1 ? " and " : ", ")}
                    <code>{t}</code>
                  </span>
                ))}{" "}
                to the column that holds it. The column can have any name.
              </Text>
            </Flex>
          )}
        </Flex>
      </Grid>
    </ModalStandard>
  );
}
