import { useState } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { SDKLanguage } from "shared/types/sdk-connection";
import { SDKAttributeType } from "shared/types/organization";
import { getLatestSDKVersion } from "shared/sdk-versioning";
import { getDefaultProjectsForNewResource } from "shared/demo-datasource";
import {
  attributeMatchesDatasourceProjects,
  attributeToUserIdTypeName,
  isValidUserIdTypeName,
  USER_ID_TYPE_NAME_RULE,
} from "shared/util";
import { PiCode, PiDatabase, PiPlus } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useSDKConnections from "@/hooks/useSDKConnections";
import useProjectOptions from "@/hooks/useProjectOptions";
import { useReconciledCustomFields } from "@/hooks/useReconciledCustomFields";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import TextField from "@/ui/TextField";
import MultiSelectField from "@/ui/MultiSelectField";
import Checkbox from "@/ui/Checkbox";
import Text from "@/ui/Text";
import HelperText from "@/ui/HelperText";
import Button from "@/ui/Button";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
} from "@/ui/Select";
import Code from "@/components/SyntaxHighlighting/Code";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import TagsInput from "@/components/Tags/TagsInput";
import CustomFieldInput from "@/components/CustomFields/CustomFieldInput";
import {
  getAddAttributeCode,
  getSetAttributesCode,
} from "@/components/SyntaxHighlighting/Snippets/TargetingAttributeCodeSnippet";
import { languageMapping } from "@/components/Features/SDKConnections/SDKLanguageLogo";

const DATASOURCE_COLUMNS = "24px minmax(0, 1fr) 200px";
const ROW_BORDER = { borderTop: "1px solid var(--gray-a5)" };
const PLACEHOLDER_NAME = "newIdentifier";

// The data types an attribute can be a unique identifier with.
const IDENTIFIER_DATATYPES: { value: SDKAttributeType; label: string }[] = [
  { value: "string", label: "String" },
  { value: "number", label: "Number" },
  { value: "secureString", label: "Secure string" },
];

// No-code and edge SDKs set attributes another way, so they have no snippet.
const SNIPPET_LANGUAGES = (
  Object.keys(languageMapping) as SDKLanguage[]
).filter((language) => getSetAttributesCode(language, {}) !== null);

// These rebuild their identifier types from the attribute schema on their own.
function syncsIdentifiersAutomatically(
  datasource: DataSourceInterfaceWithParams,
) {
  return (
    datasource.type === "growthbook_clickhouse" ||
    !!datasource.eventForwarderConfig
  );
}

export default function AddIdentifierModal({
  close,
  onCreate,
  defaultProjects,
  source,
}: {
  close: () => void;
  onCreate?: (property: string) => void;
  defaultProjects?: string[];
  source: string;
}) {
  const { project, datasources, mutateDefinitions } = useDefinitions();
  const { refreshOrganization } = useUser();
  const { apiCall, orgId } = useAuth();
  const permissionsUtil = usePermissionsUtil();

  const [name, setName] = useState("");
  const [projects, setProjects] = useState<string[]>(
    () =>
      defaultProjects ??
      getDefaultProjectsForNewResource({
        project,
        organizationId: orgId || undefined,
      }),
  );
  const [uncheckedIds, setUncheckedIds] = useState<string[]>([]);
  const [columns, setColumns] = useState<Record<string, string>>({});
  const [datatype, setDatatype] = useState<SDKAttributeType>("string");
  const [tags, setTags] = useState<string[]>([]);
  const [description, setDescription] = useState<string | null>(null);
  const [customFields, setCustomFields] = useState<Record<string, string>>({});
  const [pickedLanguage, setPickedLanguage] = useState<SDKLanguage | null>(
    null,
  );
  const { data: sdkConnectionsData } = useSDKConnections();

  const projectOptions = useProjectOptions(
    (p) => permissionsUtil.canCreateAttribute({ projects: [p] }),
    projects,
  );
  const canCreate = permissionsUtil.canCreateAttribute({ projects });

  const { availableFields: availableCustomFields, value: customFieldValues } =
    useReconciledCustomFields({
      section: "attribute",
      projects,
      value: customFields,
      setValue: setCustomFields,
    });

  const inScope = datasources.filter((d) =>
    attributeMatchesDatasourceProjects(
      { property: name, datatype: "string", projects },
      d.projects,
    ),
  );
  const automatic = inScope.filter(syncsIdentifiersAutomatically);
  const mappable = inScope.filter((d) => !syncsIdentifiersAutomatically(d));

  const newProperty = name.trim() || PLACEHOLDER_NAME;
  const defaultColumn = attributeToUserIdTypeName(newProperty);
  const columnFor = (id: string) => columns[id] || defaultColumn;
  const canEdit = (d: DataSourceInterfaceWithParams) =>
    permissionsUtil.canUpdateDataSourceSettings(d);
  const checked = mappable.filter(
    (d) => canEdit(d) && !uncheckedIds.includes(d.id),
  );
  const checkedColumns = [...new Set(checked.map((d) => columnFor(d.id)))];

  const connectedLanguages = [
    ...new Set(
      (sdkConnectionsData?.connections ?? [])
        .filter(
          (c) =>
            !projects.length ||
            !c.projects.length ||
            c.projects.some((p) => projects.includes(p)),
        )
        .flatMap((c) => c.languages),
    ),
  ].filter((l) => SNIPPET_LANGUAGES.includes(l));
  const otherLanguages = SNIPPET_LANGUAGES.filter(
    (l) => !connectedLanguages.includes(l),
  );
  const language = pickedLanguage ?? connectedLanguages[0] ?? "javascript";

  const sdkCode = getAddAttributeCode(language, newProperty, {
    version: getLatestSDKVersion(language),
    value: datatype === "number" ? 123 : "foo",
  });
  const sqlLines = [
    "SELECT",
    "  -- ...your other columns",
    ...checkedColumns.map((column) => `  ${column},`),
    "  timestamp",
    "FROM ...",
  ];

  const invalidColumn = checked.find(
    (d) => !isValidUserIdTypeName(columnFor(d.id)),
  );

  return (
    <ModalStandard
      open={true}
      header="Add Identifier"
      cta="Add Identifier"
      size="xl"
      ctaEnabled={canCreate && !!name.trim() && !invalidColumn}
      trackingEventModalType="add-identifier"
      trackingEventModalSource={source}
      close={close}
      submit={async () => {
        const property = name.trim();
        const res = await apiCall<{ failedDatasources: string[] }>(
          "/attribute/identifier",
          {
            method: "POST",
            body: JSON.stringify({
              property,
              datatype,
              description: description ?? "",
              tags,
              ...(availableCustomFields.length > 0 && {
                customFields: customFieldValues,
              }),
              projects,
              datasources: checked.map((d) => ({
                id: d.id,
                column: columnFor(d.id),
              })),
            }),
          },
        );
        await Promise.all([refreshOrganization(), mutateDefinitions()]);
        onCreate?.(property);
        if (res.failedDatasources.length > 0) {
          throw new Error(
            `${property} was added, but ${res.failedDatasources.join(", ")} couldn't be updated. Add the column from each Data Source's settings.`,
          );
        }
      }}
    >
      <Grid columns="minmax(0, 1fr) 380px" gap="5">
        <Flex direction="column" gap="5">
          <Grid columns="2" gap="4">
            <TextField
              label="Name"
              required
              markRequired
              autoFocus
              value={name}
              placeholder={PLACEHOLDER_NAME}
              onChange={(e) => setName(e.target.value)}
              helpText="The attribute name used in the SDK"
            />
            <MultiSelectField
              label="Projects"
              placeholder="All Projects"
              value={projects}
              options={projectOptions}
              onChange={setProjects}
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
            <Flex direction="column" gap="2">
              <Text weight="medium">Tags</Text>
              <TagsInput value={tags} onChange={setTags} />
            </Flex>
          </Grid>

          {description === null ? (
            <Box>
              <Button
                variant="ghost"
                icon={<PiPlus />}
                onClick={() => setDescription("")}
              >
                Add description
              </Button>
            </Box>
          ) : (
            <Flex direction="column" gap="2">
              <Text weight="medium">Description</Text>
              <MarkdownInput
                value={description}
                setValue={setDescription}
                autofocus
              />
            </Flex>
          )}

          {availableCustomFields.length > 0 && (
            <CustomFieldInput
              fields={availableCustomFields}
              value={customFieldValues}
              onChange={setCustomFields}
            />
          )}

          {inScope.length > 0 && (
            <Flex direction="column" gap="2">
              <Text weight="semibold">Data Sources</Text>
              {mappable.length > 0 && (
                <Box
                  style={{
                    border: "1px solid var(--gray-a5)",
                    borderRadius: "var(--radius-3)",
                  }}
                >
                  <Grid
                    columns={DATASOURCE_COLUMNS}
                    gap="3"
                    px="3"
                    py="2"
                    style={{ background: "var(--gray-a2)" }}
                  >
                    <span />
                    <Text size="sm" color="text-mid">
                      Data Source
                    </Text>
                    <Text size="sm" color="text-mid">
                      Column
                    </Text>
                  </Grid>
                  {mappable.map((d) => {
                    const editable = canEdit(d);
                    const isChecked = editable && !uncheckedIds.includes(d.id);
                    return (
                      <Grid
                        key={d.id}
                        columns={DATASOURCE_COLUMNS}
                        gap="3"
                        px="3"
                        py="2"
                        align="center"
                        style={ROW_BORDER}
                      >
                        <Checkbox
                          value={isChecked}
                          disabled={!editable}
                          disabledMessage="You don't have permission to edit this Data Source"
                          setValue={(v) =>
                            setUncheckedIds((ids) =>
                              v
                                ? ids.filter((id) => id !== d.id)
                                : [...ids, d.id],
                            )
                          }
                        />
                        <Flex align="center" gap="2">
                          <PiDatabase />
                          <Text
                            weight="medium"
                            color={isChecked ? undefined : "text-low"}
                          >
                            {d.name}
                          </Text>
                        </Flex>
                        <TextField
                          value={columns[d.id] ?? ""}
                          placeholder={defaultColumn}
                          disabled={!isChecked}
                          aria-label={`Column in ${d.name}`}
                          onChange={(e) =>
                            setColumns((c) => ({
                              ...c,
                              [d.id]: e.target.value,
                            }))
                          }
                        />
                      </Grid>
                    );
                  })}
                </Box>
              )}
              {invalidColumn && (
                <HelperText status="error">{USER_ID_TYPE_NAME_RULE}</HelperText>
              )}
              {automatic.length > 0 && (
                <HelperText status="info">
                  {automatic.map((d) => d.name).join(", ")}{" "}
                  {automatic.length === 1
                    ? "updates its identifiers automatically."
                    : "update their identifiers automatically."}
                </HelperText>
              )}
            </Flex>
          )}
        </Flex>

        <Flex direction="column" gap="4">
          <Flex direction="column" gap="2">
            <Flex align="center" justify="between" gap="2">
              <Flex align="center" gap="2">
                <PiCode />
                <Text weight="semibold" color="text-mid">
                  In your app
                </Text>
              </Flex>
              <Select
                size="sm"
                value={language}
                setValue={(v) =>
                  setPickedLanguage(
                    SNIPPET_LANGUAGES.find((l) => l === v) ?? null,
                  )
                }
              >
                {connectedLanguages.length > 0 && (
                  <>
                    <SelectGroup>
                      <SelectLabel>Your SDK Connections</SelectLabel>
                      {connectedLanguages.map((l) => (
                        <SelectItem key={l} value={l}>
                          {languageMapping[l].label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    <SelectSeparator />
                  </>
                )}
                <SelectGroup>
                  <SelectLabel>All languages</SelectLabel>
                  {otherLanguages.map((l) => (
                    <SelectItem key={l} value={l}>
                      {languageMapping[l].label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </Select>
            </Flex>
            {sdkCode && (
              <Code
                language={sdkCode.snippet.language}
                filename={sdkCode.snippet.filename}
                code={sdkCode.snippet.code}
                highlightLine={sdkCode.highlightLine}
              />
            )}
          </Flex>
          {checkedColumns.length > 0 && (
            <Flex direction="column" gap="2">
              <Flex align="center" gap="2">
                <PiDatabase />
                <Text weight="semibold" color="text-mid">
                  In your fact tables &amp; exposure queries
                </Text>
              </Flex>
              <Code
                language="sql"
                code={sqlLines.join("\n")}
                highlightLine={3}
              />
            </Flex>
          )}
        </Flex>
      </Grid>
    </ModalStandard>
  );
}
