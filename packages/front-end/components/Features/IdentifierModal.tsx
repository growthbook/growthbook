import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { SDKAttribute, SDKAttributeType } from "shared/types/organization";
import { getDefaultProjectsForNewResource } from "shared/demo-datasource";
import {
  attributeMatchesDatasourceProjects,
  attributeToUserIdTypeName,
  findSimilarUserIdType,
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
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import AttributeFormLayout, {
  DescriptionField,
} from "@/components/Features/AttributeFormLayout";
import { Select, SelectItem, SelectSeparator } from "@/ui/Select";
import TagsInput from "@/components/Tags/TagsInput";
import CustomFieldInput from "@/components/CustomFields/CustomFieldInput";
import AddAttributeSnippet from "@/components/SyntaxHighlighting/Snippets/AddAttributeSnippet";

const PLACEHOLDER_NAME = "newIdentifier";
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

export default function IdentifierModal({
  close,
  onSave,
  existing,
  defaultProjects,
  source,
}: {
  close: () => void;
  onSave?: (property: string) => void;
  existing?: SDKAttribute;
  defaultProjects?: string[];
  source: string;
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
  // A rename has to move every link, so links the user can't edit block it.
  const lockedLinks = renamed
    ? datasources.filter(
        (d) =>
          !!linkedType(d) && !syncsIdentifiersAutomatically(d) && !canEdit(d),
      )
    : [];
  const automatic = shown.filter(syncsIdentifiersAutomatically);
  const mappable = shown.filter((d) => !syncsIdentifiersAutomatically(d));

  const pickedType = (d: DataSourceInterfaceWithParams) => {
    const pick = picks[d.id];
    return pick === NEW_TYPE ? defaultType : (pick ?? null);
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
    return [{ id: d.id, userIdType: pickedType(d) ?? defaultType }];
  });

  const shownTypes = [
    ...new Set([
      ...mappable.flatMap((d) => linkedType(d) ?? []),
      ...links.map((l) => l.userIdType).filter(Boolean),
    ]),
  ];

  // Links to an existing type with a similar name, or else creates one.
  const defaultPick = (d: DataSourceInterfaceWithParams) =>
    findSimilarUserIdType(userIdTypeNames(d), newProperty) ?? NEW_TYPE;

  return (
    <ModalStandard
      open={true}
      header={isEdit ? "Edit Identifier" : "Add Identifier"}
      cta={isEdit ? "Save" : "Add Identifier"}
      size="xl"
      ctaEnabled={canSave && !!name.trim() && lockedLinks.length === 0}
      trackingEventModalType={isEdit ? "edit-identifier" : "add-identifier"}
      trackingEventModalSource={source}
      close={close}
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
      <AttributeFormLayout
        panel={
          <>
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
          </>
        }
      >
        <TextField
          label="Name"
          autoComplete="off"
          data-1p-ignore
          required
          markRequired
          autoFocus={!isEdit}
          value={name}
          placeholder={PLACEHOLDER_NAME}
          onChange={(e) => setName(e.target.value)}
          helpText="Must match the key your SDK passes in."
          error={
            lockedLinks.length > 0
              ? `Can't rename: it's linked in ${new Intl.ListFormat(
                  "en",
                ).format(
                  lockedLinks.map((d) => d.name),
                )}, which you don't have permission to edit.`
              : undefined
          }
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
        <DescriptionField
          value={description}
          setValue={setDescription}
          placeholder="Add notes about this identifier (markdown supported)"
        />
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
          size="md"
          legacyLabelFormatting={false}
          placeholder="All Projects"
          value={projects}
          options={projectOptions}
          onChange={setProjects}
        />
        <TagsInput
          label="Tags"
          size="md"
          legacyLabelFormatting={false}
          value={tags}
          onChange={setTags}
          autoFocus={false}
        />
        {availableCustomFields.length > 0 && (
          <CustomFieldInput
            fields={availableCustomFields}
            mt="0"
            value={customFieldValues}
            onChange={setCustomFields}
          />
        )}

        {shown.length > 0 && (
          <Flex direction="column" gap="2">
            <Box>
              <Text weight="semibold">Data Sources</Text>
              <Text as="div" size="sm" color="text-low">
                {isEdit ? (
                  <>
                    Link this identifier in more Data Sources so experiments
                    using it pick the right assignment query. Change existing
                    links from the Data Source.
                  </>
                ) : (
                  <>
                    Adds the identifier type <code>{defaultType}</code> to each
                    Data Source you check.
                  </>
                )}
              </Text>
            </Box>
            {mappable.length > 0 && (
              <Table variant="surface" size="sm">
                <TableHeader>
                  <TableRow>
                    <TableColumnHeader>Data Source</TableColumnHeader>
                    {isEdit && (
                      <TableColumnHeader style={{ width: 240 }}>
                        Identifier type
                      </TableColumnHeader>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappable.map((d) => {
                    const editable = canEdit(d);
                    const linked = linkedType(d);
                    const isChecked = isEdit
                      ? !!linked || d.id in picks
                      : editable && !uncheckedIds.includes(d.id);
                    return (
                      <TableRow
                        key={d.id}
                        style={
                          linked ? { background: "var(--gray-a2)" } : undefined
                        }
                      >
                        <TableCell>
                          {linked ? (
                            // Lines up with the names of the checkbox rows.
                            <Flex align="center" gap="2" pl="5">
                              <PiDatabase />
                              <Text weight="medium" color="text-mid">
                                {d.name}
                              </Text>
                            </Flex>
                          ) : (
                            <Checkbox
                              label={
                                <Flex align="center" gap="2">
                                  <PiDatabase />
                                  <Text>{d.name}</Text>
                                </Flex>
                              }
                              weight="medium"
                              align="center"
                              description={
                                !isEdit &&
                                userIdTypeNames(d).includes(defaultType)
                                  ? `Already has ${defaultType}`
                                  : undefined
                              }
                              value={isChecked}
                              disabled={!editable}
                              disabledMessage="You don't have permission to edit this Data Source"
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
                          )}
                        </TableCell>
                        {isEdit && (
                          <>
                            <TableCell>
                              {linked ? (
                                <Flex align="center" gap="2">
                                  <Text size="sm" color="text-mid" mono>
                                    {linked}
                                  </Text>
                                  <Badge label="Linked" color="gray" />
                                </Flex>
                              ) : !(d.id in picks) ? (
                                <Text color="text-low">—</Text>
                              ) : (
                                <Select
                                  size="sm"
                                  value={picks[d.id]}
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
                                  {!userIdTypeNames(d).includes(
                                    defaultType,
                                  ) && (
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
                              )}
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            {automatic.length > 0 && (
              <HelperText status="info" icon={<PiLockSimple />}>
                {new Intl.ListFormat("en").format(automatic.map((d) => d.name))}{" "}
                {automatic.length === 1
                  ? "updates its identifiers automatically."
                  : "update their identifiers automatically."}
              </HelperText>
            )}
          </Flex>
        )}
      </AttributeFormLayout>
    </ModalStandard>
  );
}
