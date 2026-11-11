import { useState } from "react";
import { Box, Flex, VisuallyHidden } from "@radix-ui/themes";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import {
  SDKAttribute,
  SDKAttributeFormat,
  SDKAttributeType,
} from "shared/types/organization";
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
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import AttributeFormLayout, {
  AdvancedSettings,
  DescriptionField,
  RenameWarning,
  isSecureDatatype,
  STRING_FORMATS,
  StringFormatField,
  ATTRIBUTE_DATA_TYPES,
  DataTypeField,
  IDENTIFIER_DATA_TYPES,
} from "@/components/Features/AttributeFormLayout";
import { Select, SelectItem, SelectSeparator } from "@/ui/Select";
import TagsInput from "@/components/Tags/TagsInput";
import CustomFieldInput from "@/components/CustomFields/CustomFieldInput";
import AddAttributeSnippet from "@/components/SyntaxHighlighting/Snippets/AddAttributeSnippet";

const PLACEHOLDER_NAME = "userId";
// Select value for creating a type named after the identifier.
const NEW_TYPE = "__new__";

// These rebuild their identifier types from the attribute schema on their own.
export function syncsIdentifiersAutomatically(
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
  // Editing a targeting attribute here turns it into an identifier.
  const converting = !!existing && !existing.hashAttribute;

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
  const [format, setFormat] = useState<SDKAttributeFormat>(
    existing?.format ?? "",
  );
  const [disableEqualityConditions, setDisableEqualityConditions] = useState(
    !!existing?.disableEqualityConditions,
  );
  const [tags, setTags] = useState<string[]>(existing?.tags ?? []);
  const [description, setDescription] = useState(existing?.description ?? "");
  const [customFields, setCustomFields] = useState<Record<string, string>>(
    existing?.customFields ?? {},
  );
  // Add: Data Sources the user unchecked. Edit: the type picked per Data Source.
  const [uncheckedIds, setUncheckedIds] = useState<string[]>([]);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [savedWithErrors, setSavedWithErrors] = useState<string | null>(null);

  const renamed = isEdit && name.trim() !== existing.property;
  const { references } = useAttributeReferences(
    renamed ? [existing.property] : [],
  );
  const refs = existing ? references?.[existing.property] : undefined;

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
  // Add and convert start with every Data Source checked that has a type to
  // link to; editing an identifier starts with none.
  const preChecked = !isEdit || converting;
  const isChecked = (d: DataSourceInterfaceWithParams) =>
    !!linkedType(d) ||
    (preChecked
      ? canEdit(d) &&
        !uncheckedIds.includes(d.id) &&
        (!settledName || pickFor(d) !== null)
      : d.id in picks);
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
  // A live preview, like the snippet. The table waits for the name to settle
  // so its rows don't flicker.
  const links = linksFor(newProperty);

  const setChecked = (d: DataSourceInterfaceWithParams, v: boolean) => {
    if (!preChecked) {
      setPicks((p) => {
        const next = { ...p };
        if (v) next[d.id] = pickOnCheck(d);
        else delete next[d.id];
        return next;
      });
    } else {
      setUncheckedIds((ids) =>
        v ? ids.filter((id) => id !== d.id) : [...ids, d.id],
      );
      if (v && pickFor(d) === null) {
        setPicks((p) => ({ ...p, [d.id]: pickOnCheck(d) }));
      }
    }
  };
  const selectable = mappable.filter((d) => canEdit(d) && !linkedType(d));
  const selectedCount = selectable.filter(isChecked).length;

  const shownTypes = [
    ...new Set([
      ...mappable.flatMap((d) => linkedType(d) ?? []),
      ...links.map((l) => l.userIdType),
    ]),
  ];

  const finishSave = async (property: string) => {
    await Promise.all([refreshOrganization(), mutateDefinitions()]);
    onSave?.(property);
  };

  return (
    <ModalStandard
      open={true}
      header={
        converting
          ? "Convert to Identifier"
          : isEdit
            ? "Edit Identifier"
            : "Add Identifier"
      }
      cta={converting ? "Convert" : isEdit ? "Save" : "Add Identifier"}
      size="xl"
      ctaEnabled={
        canSave && !!name.trim() && lockedLinks.length === 0 && !savedWithErrors
      }
      trackingEventModalType={
        converting
          ? "convert-to-identifier"
          : isEdit
            ? "edit-identifier"
            : "add-identifier"
      }
      trackingEventModalSource={source}
      close={async () => {
        if (savedWithErrors) await finishSave(savedWithErrors);
        close();
      }}
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
              // Same rules as the Attribute modal: string-only, and a format
              // replaces equality comparisons with its own operators.
              ...(datatype === "string" && {
                format,
                disableEqualityConditions: !format && disableEqualityConditions,
              }),
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
        if (res.failedDatasources.length > 0) {
          // Refreshing now could unmount this modal (the detail page loses the
          // old name) before the error shows, so it waits until close.
          setSavedWithErrors(property);
          throw new Error(
            `${property} was saved, but ${res.failedDatasources.join(", ")} couldn't be updated. Link it from each Data Source's identifier types.`,
          );
        }
        await finishSave(property);
      }}
    >
      <AttributeFormLayout
        panel={
          <>
            <AddAttributeSnippet
              property={newProperty}
              value={
                datatype === "number"
                  ? 123
                  : datatype === "string"
                    ? (STRING_FORMATS.find((f) => f.value === format)
                        ?.example ?? "foo")
                    : "foo"
              }
              projects={projects}
              secure={isSecureDatatype(datatype)}
            />
            {shownTypes.length > 0 && (
              <Flex direction="column" gap="2">
                <Flex align="center" gap="2">
                  <PiDatabase />
                  <Text weight="semibold" color="text-mid">
                    In your Data Sources
                  </Text>
                </Flex>
                <Text size="sm">
                  Each Data Source links <code>{newProperty}</code> to an
                  identifier type (
                  {shownTypes.map((t, i) => (
                    <span key={t}>
                      {i > 0 && (i === shownTypes.length - 1 ? " or " : ", ")}
                      <code>{t}</code>
                    </span>
                  ))}
                  ). In your assignment queries and fact tables, map{" "}
                  {shownTypes.length === 1 ? (
                    <code>{shownTypes[0]}</code>
                  ) : (
                    "that type"
                  )}{" "}
                  to the column that holds it, which can have any name.
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
          <RenameWarning
            references={refs}
            hasJsonManagedWarehouse={datasources.some(
              (d) =>
                d.type === "growthbook_clickhouse" &&
                !!d.settings.useJsonColumns,
            )}
            secure={isSecureDatatype(existing.datatype)}
            identifier
          />
        )}
        <DescriptionField
          value={description}
          setValue={setDescription}
          placeholder="Where this value comes from, e.g. set at login from the account ID"
        />
        <DataTypeField
          value={datatype}
          setValue={setDatatype}
          options={ATTRIBUTE_DATA_TYPES.filter((d) =>
            IDENTIFIER_DATA_TYPES.includes(d.value),
          )}
        />
        {datatype === "string" && (
          <Box pl="4" style={{ borderLeft: "2px solid var(--gray-a5)" }}>
            <StringFormatField value={format} setValue={setFormat} />
          </Box>
        )}
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
            <Text as="div" size="sm" color="text-mid">
              Data Sources are managed in <code>config.yml</code>, so this
              identifier isn&apos;t linked to them here.
            </Text>
          </Box>
        )}
        {!fileConfig && shown.length > 0 && (
          <Flex direction="column" gap="2">
            <Box>
              <Text weight="semibold">Data Sources</Text>
              <Text as="div" size="sm" color="text-mid">
                {isEdit && !converting ? (
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
                    <TableColumnHeader>
                      {selectable.length > 1 ? (
                        <Checkbox
                          label={
                            <>
                              Data Source
                              <VisuallyHidden> (select all)</VisuallyHidden>
                            </>
                          }
                          weight="medium"
                          value={
                            selectedCount === selectable.length
                              ? true
                              : selectedCount > 0
                                ? "indeterminate"
                                : false
                          }
                          setValue={(v) =>
                            selectable
                              .filter((d) => isChecked(d) !== v)
                              .forEach((d) => setChecked(d, v))
                          }
                        />
                      ) : (
                        "Data Source"
                      )}
                    </TableColumnHeader>
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
                            setValue={(v) => setChecked(d, v)}
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
        {datatype === "string" && !format && (
          <AdvancedSettings
            disableEqualityConditions={disableEqualityConditions}
            setDisableEqualityConditions={setDisableEqualityConditions}
          />
        )}
      </AttributeFormLayout>
    </ModalStandard>
  );
}
