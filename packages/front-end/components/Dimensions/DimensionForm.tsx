import { FC, useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { useForm } from "react-hook-form";
import { DimensionInterface } from "shared/types/dimension";
import { NULL_DIMENSION_VALUE } from "shared/constants";
import type { DimensionTiming } from "shared/validators";
import {
  DIMENSION_NULL_LABEL_MAX_LENGTH,
  getDimensionRequiredColumns,
  getDimensionTiming,
} from "shared/experiments";
import { PiArrowSquareOut, PiPlus } from "react-icons/pi";
import { isProjectListValidForProject } from "shared/util";
import { validateSQL } from "@/services/datasources";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import TextField from "@/ui/TextField";
import Text from "@/ui/Text";
import { Select, SelectItem } from "@/ui/Select";
import EditSqlModal from "@/components/SchemaBrowser/EditSqlModal";
import Code from "@/components/SyntaxHighlighting/Code";
import SelectOwner from "@/components/Owner/SelectOwner";
import MarkdownInput from "@/components/Markdown/MarkdownInput";

const TIMING_OPTIONS: { value: DimensionTiming; label: string }[] = [
  { value: "none", label: "One value per unit" },
  { value: "rowTimestamp", label: "Timestamped rows" },
  {
    value: "validityRange",
    label: "Validity ranges (start and end timestamps)",
  },
];

const TIMING_HELP: Record<DimensionTiming, string> = {
  none: "Query must return the identifier and value. If a unit has several rows, the MAX value is used.",
  rowTimestamp:
    "Query must return the identifier, value, and timestamp column. The row with the latest timestamp at or before each unit's first exposure is used.",
  validityRange:
    "Query must return the identifier, value, start_timestamp, and end_timestamp columns (NULL end_timestamp means still valid). The row with the latest start_timestamp valid at each unit's first exposure is used.",
};

const DimensionForm: FC<{
  close: () => void;
  current: Partial<DimensionInterface>;
}> = ({ close, current }) => {
  const { apiCall } = useAuth();
  const { userId } = useUser();
  const { getDatasourceById, datasources, mutateDefinitions, project } =
    useDefinitions();

  const validDatasources = datasources.filter(
    (d) =>
      d.id === current.datasource ||
      isProjectListValidForProject(d.projects, project),
  );

  const form = useForm({
    defaultValues: {
      name: current.name || "",
      sql: current.sql || "",
      description: current.description || "",
      datasource:
        (current.id ? current.datasource : validDatasources[0]?.id) || "",
      userIdType: current.userIdType || "user_id",
      timing: getDimensionTiming(current),
      nullLabel: current.nullLabel || "",
      owner: current.owner || (current.id ? "" : userId || ""),
    },
  });
  const [sqlOpen, setSqlOpen] = useState(false);
  const [showDescription, setShowDescription] = useState(!!current.description);

  const datasource = form.watch("datasource");
  const userIdType = form.watch("userIdType");
  const timing = form.watch("timing");

  const dsObj = getDatasourceById(datasource);

  const dsProps = dsObj?.properties;
  const supportsSQL = dsProps?.queryLanguage === "sql";

  const sql = form.watch("sql");

  const requiredColumns = useMemo(() => {
    return new Set(getDimensionRequiredColumns({ userIdType, timing }));
  }, [userIdType, timing]);
  const placeholder = `SELECT\n      ${Array.from(requiredColumns).join(", ")}\nFROM\n      mytable`;

  // The SQL editor is a legacy modal, so it replaces this dialog while open
  // (same pattern as the interleaving and contextual bandit query modals).
  if (sqlOpen && dsObj) {
    return (
      <EditSqlModal
        close={() => setSqlOpen(false)}
        datasourceId={dsObj.id || ""}
        placeholder={placeholder}
        requiredColumns={requiredColumns}
        value={sql}
        save={async (sql) => form.setValue("sql", sql)}
        sqlObjectInfo={{
          objectType: "Dimension",
          objectName: form.watch("name"),
        }}
      />
    );
  }

  return (
    <>
      <ModalStandard
        open
        trackingEventModalType=""
        header={current.id ? "Edit Dimension" : "New Dimension"}
        size="md"
        close={close}
        submit={validatedSubmit(form, async (value) => {
          if (!value.datasource) {
            throw new Error("Choose a Data Source");
          }
          if (!value.sql) {
            throw new Error(
              supportsSQL ? "Add a SQL query" : "Add an event condition",
            );
          }
          if (supportsSQL) {
            validateSQL(value.sql, getDimensionRequiredColumns(value));
          } else {
            // Timing is only editable for SQL sources; a stale timed setting
            // would be rejected by the server after switching to e.g. Mixpanel
            value.timing = "none";
          }

          await apiCall(
            current.id ? `/dimensions/${current.id}` : `/dimensions`,
            {
              method: current.id ? "PUT" : "POST",
              body: JSON.stringify(value),
            },
          );
          mutateDefinitions();
          close();
        })}
      >
        <TextField
          label="Name"
          markRequired
          required
          mb="4"
          {...form.register("name")}
        />
        <SelectOwner
          value={form.watch("owner")}
          onChange={(v) => form.setValue("owner", v)}
        />
        {showDescription ? (
          <Box mb="4">
            <Box mb="1">
              <Text as="label" weight="semibold">
                Description
              </Text>
            </Box>
            <MarkdownInput
              value={form.watch("description")}
              setValue={(v) => form.setValue("description", v)}
              placeholder="Add notes about this dimension (markdown supported)"
              showButtons={false}
              hidePreview={false}
            />
          </Box>
        ) : (
          <Link
            mb="4"
            onClick={(e) => {
              e.preventDefault();
              setShowDescription(true);
            }}
          >
            <Flex align="center" gap="1">
              <PiPlus />
              <Text weight="medium">Add a description</Text>
            </Flex>
          </Link>
        )}
        <Box mb="4">
          <Select
            label="Data Source"
            value={datasource}
            setValue={(v) => form.setValue("datasource", v)}
            placeholder="Choose one..."
          >
            {validDatasources.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
                {d.description ? ` — ${d.description}` : ""}
              </SelectItem>
            ))}
          </Select>
        </Box>
        {dsProps?.userIds && (
          <Box mb="4">
            <Select
              label="Identifier type"
              value={userIdType}
              setValue={(v) => form.setValue("userIdType", v)}
            >
              {(dsObj?.settings?.userIdTypes || []).map((t) => (
                <SelectItem key={t.userIdType} value={t.userIdType}>
                  {t.userIdType}
                </SelectItem>
              ))}
            </Select>
          </Box>
        )}
        {supportsSQL && (
          <Flex direction="column" gap="1" mb="4">
            <Select
              label="Query returns"
              value={timing}
              setValue={(v) => form.setValue("timing", v as DimensionTiming)}
            >
              {TIMING_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </Select>
            <Text size="sm" color="text-mid">
              {TIMING_HELP[timing]}
            </Text>
          </Flex>
        )}
        {supportsSQL ? (
          <Flex direction="column" gap="2" mb="4">
            <Text size="md" weight="semibold">
              Query
            </Text>
            {sql && <Code language="sql" code={sql} expandable={true} />}
            <Flex>
              <Button
                variant="outline"
                onClick={() => setSqlOpen(true)}
                icon={<PiArrowSquareOut />}
                iconPosition="right"
              >
                {sql ? "Edit SQL" : "Add SQL"}
              </Button>
            </Flex>
          </Flex>
        ) : (
          <TextField
            label="Event condition"
            markRequired
            required
            multiline
            placeholder="$browser"
            mb="4"
            {...form.register("sql")}
          />
        )}
        {supportsSQL && (
          <TextField
            label="Missing/NULL value label"
            placeholder={`${NULL_DIMENSION_VALUE} (default)`}
            maxLength={DIMENSION_NULL_LABEL_MAX_LENGTH}
            helpText="Dimension label for units with NULL value or no matching value."
            mb="4"
            {...form.register("nullLabel")}
          />
        )}
      </ModalStandard>
    </>
  );
};
export default DimensionForm;
