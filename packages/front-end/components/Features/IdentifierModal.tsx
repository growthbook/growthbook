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
import { hasFileConfig } from "@/services/env";
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

const PLACEHOLDER_NAME = "userId";
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
    (datasource.type === "growthbook_clickhouse" &&
      !!datasource.settings.useJsonColumns) ||
    !!datasource.eventForwarderConfig
  );
}

// Older Managed Warehouses have fixed event columns, so they can only link to
// the identifier types they were created with.
function hasFixedUserIdTypes(datasource: DataSourceInterfaceWithParams) {
  return datasource.type === "growthbook_clickhouse";
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
  // The name once the user leaves the field. Data Source defaults follow this
  // rather than every keystroke, so they don't flicker while typing.
  const [settledName, setSettledName] = useState(existing?.property ?? "");
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
  const defaultType = attributeToUserIdTypeName(settledName);
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

  // Links to an existing type with a similar name, or else creates one. Null
  // when there's no match and the Data Source can't take a new type.
  const defaultPick = (d: DataSourceInterfaceWithParams, base = settledName) =>
    findSimilarUserIdType(userIdTypeNames(d), base) ??
    (hasFixedUserIdTypes(d) ? null : NEW_TYPE);
  const pickFor = (d: DataSourceInterfaceWithParams, base = settledName) =>
    picks[d.id] ?? defaultPick(d, base);
  // What checking a row selects when there's no default to fall back on.
  const pickOnCheck = (d: DataSourceInterfaceWithParams) =>
    defaultPick(d) ?? userIdTypeNames(d)[0] ?? NEW_TYPE;
  // Add starts with every Data Source checked that has a type to link to;
  // edit starts with none.
  const isChecked = (d: DataSourceInterfaceWithParams) =>
    isEdit
      ? !!linkedType(d) || d.id in picks
      : canEdit(d) &&
        !uncheckedIds.includes(d.id) &&
        (!settledName || pickFor(d) !== null);
  // The server can't update Data Sources defined in config.yml.
  const fileConfig = hasFileConfig();
  const linksFor = (base: string) =>
    (fileConfig ? [] : mappable).flatMap((d) => {
      if (!canEdit(d) || linkedType(d) || !isChecked(d)) return [];
      const pick = pickFor(d, base);
      if (pick === null) return [];
      return [
        {
          id: d.id,
          userIdType:
            pick === NEW_TYPE ? attributeToUserIdTypeName(base) : pick,
        },
      ];
    });
  const links = settledName ? linksFor(settledName) : [];

  const shownTypes = [
    ...new Set([
      ...mappable.flatMap((d) => linkedType(d) ?? []),
      ...links.map((l) => l.userIdType).filter(Boolean),
    ]),
  ];

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
              // Not the rendered links: Save can land before the name settles.
              datasources: linksFor(property),
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
          placeholder="e.g. userId"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setSettledName(name.trim())}
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
          placeholder="Where this value comes from, e.g. set at login from the account ID"
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

        {fileConfig && shown.length > 0 && (
          <Box>
            <Text weight="semibold">Data Sources</Text>
            <Text as="div" size="sm" color="text-low">
              Data Sources are managed in <code>config.yml</code>, so this
              identifier isn&apos;t linked to them here.
            </Text>
          </Box>
        )}
        {!fileConfig && shown.length > 0 && (
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
                    Links this identifier to an identifier type in each Data
                    Source you check, so experiments using it pick the right
                    assignment query.
                  </>
                )}
              </Text>
            </Box>
            {mappable.length > 0 && (
              <Table variant="surface" size="sm">
                <TableHeader>
                  <TableRow>
                    <TableColumnHeader>Data Source</TableColumnHeader>
                    <TableColumnHeader style={{ width: 240 }}>
                      Identifier type
                    </TableColumnHeader>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappable.map((d) => {
                    const editable = canEdit(d);
                    const linked = linkedType(d);
                    const locked = !!linked || !editable;
                    const checked = isChecked(d);
                    return (
                      <TableRow key={d.id}>
                        <TableCell>
                          <Checkbox
                            label={
                              <Flex
                                align="center"
                                gap="2"
                                style={
                                  locked
                                    ? { color: "var(--color-text-low)" }
                                    : undefined
                                }
                              >
                                <PiDatabase />
                                <Text color={locked ? "text-low" : undefined}>
                                  {d.name}
                                </Text>
                              </Flex>
                            }
                            weight="medium"
                            align="center"
                            description={
                              !editable && !linked
                                ? "You don't have permission to edit this Data Source"
                                : !linked && hasFixedUserIdTypes(d)
                                  ? "Can only link to its existing identifier types"
                                  : undefined
                            }
                            value={checked}
                            disabled={locked}
                            disabledMessage={
                              linked
                                ? `Linked as ${linked}. Change it from the Data Source.`
                                : "You don't have permission to edit this Data Source"
                            }
                            setValue={(v) => {
                              if (isEdit) {
                                setPicks((p) => {
                                  const next = { ...p };
                                  if (v) next[d.id] = pickOnCheck(d);
                                  else delete next[d.id];
                                  return next;
                                });
                              } else {
                                setUncheckedIds((ids) =>
                                  v
                                    ? ids.filter((id) => id !== d.id)
                                    : [...ids, d.id],
                                );
                                if (v && pickFor(d) === null) {
                                  setPicks((p) => ({
                                    ...p,
                                    [d.id]: pickOnCheck(d),
                                  }));
                                }
                              }
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          {linked ? (
                            <Flex align="center" gap="2">
                              <Text size="sm" color="text-mid" mono>
                                {linked}
                              </Text>
                              <Badge label="Linked" color="gray" />
                            </Flex>
                          ) : !checked || !settledName ? (
                            <Text color="text-low">—</Text>
                          ) : (
                            <Select
                              size="sm"
                              value={pickFor(d) ?? undefined}
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
                              {!hasFixedUserIdTypes(d) &&
                                !userIdTypeNames(d).includes(defaultType) && (
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
