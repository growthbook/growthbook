import {
  CreateFactFilterProps,
  FactFilterInterface,
  FactFilterTestResults,
  FactTableInterface,
  UpdateFactFilterProps,
} from "shared/types/fact-table";
import { useForm } from "react-hook-form";
import { useEffect, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiPlay } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Field from "@/components/Forms/Field";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";
import FactTableSchema from "./FactTableSchema";

export interface Props {
  factTable: FactTableInterface;
  existing?: FactFilterInterface;
  canDelete?: boolean;
  close: () => void;
}

export default function FactFilterModal({
  existing,
  factTable,
  canDelete = false,
  close,
}: Props) {
  const { apiCall } = useAuth();
  const { mutateDefinitions, getDatasourceById } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();

  const form = useForm<
    Pick<CreateFactFilterProps, "name" | "value" | "description">
  >({
    defaultValues: {
      name: existing?.name || "",
      value: existing?.value || "",
      description: existing?.description || "",
    },
  });

  const datasource = getDatasourceById(factTable.datasource);
  const canTest = !!datasource && permissionsUtil.canRunTestQueries(datasource);
  const [testResult, setTestResult] = useState<FactFilterTestResults | null>(
    null,
  );
  const testFilter = async (value: string) => {
    const { result } = await apiCall<{ result: FactFilterTestResults }>(
      `/fact-tables/${factTable.id}/test-filter`,
      { method: "POST", body: JSON.stringify({ value }) },
    );
    setTestResult(result);
    return result;
  };

  // Clicking a column in the list inserts it at the cursor
  const sqlRef = useRef<HTMLTextAreaElement | null>(null);
  const { ref: registerSqlRef, ...valueField } = form.register("value");
  const insertColumn = (column: string) => {
    const el = sqlRef.current;
    const current = form.getValues("value");
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? start;
    form.setValue(
      "value",
      current.slice(0, start) + column + current.slice(end),
    );
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + column.length, start + column.length);
    });
  };
  const hasColumns = factTable.columns.some((c) => !c.deleted);

  const isNew = !existing;
  useEffect(() => {
    track(
      isNew ? "View Create Fact Filter Modal" : "View Edit Fact Filter Modal",
    );
  }, [isNew]);

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      close={close}
      header={existing ? "Edit Saved Filter" : "New Saved Filter"}
      size="lg"
      submit={validatedSubmit(form, async (value) => {
        // If they added their own "WHERE" to the start, remove it
        value.value = value.value.replace(/^\s*where\s*/i, "").trim();

        if (!value.value) {
          throw new Error("Cannot leave the SQL condition blank");
        }

        // A broken condition would fail every metric that uses it, so check a
        // changed one against the warehouse. Editors without query access
        // can still save, as before.
        if (value.value !== existing?.value && canTest) {
          const result = await testFilter(value.value);
          if (result.error) {
            throw new Error(result.error);
          }
        }

        if (existing) {
          const data: UpdateFactFilterProps = {
            name: value.name,
            value: value.value,
            description: value.description,
          };
          await apiCall(`/fact-tables/${factTable.id}/filter/${existing.id}`, {
            method: "PUT",
            body: JSON.stringify(data),
          });
          track("Edit Fact Filter");
        } else {
          const data: CreateFactFilterProps = value;
          await apiCall(`/fact-tables/${factTable.id}/filter`, {
            method: "POST",
            body: JSON.stringify(data),
          });
          track("Create Fact Filter");
        }
        mutateDefinitions();
      })}
      secondaryAction={
        existing && canDelete ? (
          <DeleteButton
            displayName="Saved Filter"
            text="Delete"
            deleteMessage="This will remove the Saved Filter from all metrics that are using it."
            onClick={async () => {
              await apiCall(
                `/fact-tables/${factTable.id}/filter/${existing.id}`,
                { method: "DELETE" },
              );
              mutateDefinitions();
              close();
            }}
          />
        ) : undefined
      }
    >
      <Flex gap="5" align="start">
        <Box flexGrow="1" minWidth="0">
          <Field label="Name" {...form.register("name")} required />
          <Box mb="3">
            <Text as="label" weight="semibold" mb="1">
              Description
            </Text>
            <MarkdownInput
              value={form.watch("description")}
              setValue={(v) => form.setValue("description", v)}
            />
          </Box>
          <Field
            label="SQL condition"
            textarea
            minRows={2}
            required
            helpText={
              <>
                Added to the WHERE clause of metrics that use this filter, for
                example <code>status = &apos;active&apos;</code> or{" "}
                <code>country IN (&apos;US&apos;, &apos;CA&apos;)</code>.
              </>
            }
            {...valueField}
            ref={(el: HTMLTextAreaElement | null) => {
              registerSqlRef(el);
              sqlRef.current = el;
            }}
          />
          {canTest ? (
            <Button
              size="sm"
              variant="outline"
              icon={<PiPlay />}
              onClick={async () => {
                try {
                  await testFilter(form.getValues("value"));
                } catch (e) {
                  // Request failures show in the same results panel
                  setTestResult({
                    sql: "",
                    error: e instanceof Error ? e.message : String(e),
                  });
                }
              }}
            >
              Test SQL condition
            </Button>
          ) : null}
        </Box>
        {hasColumns ? (
          <Box flexShrink="0">
            <Text as="div" weight="semibold" mb="1">
              Available columns
            </Text>
            <FactTableSchema
              factTable={factTable}
              onColumnClick={insertColumn}
            />
          </Box>
        ) : null}
      </Flex>
      {testResult ? (
        <Box mt="3">
          <DisplayTestQueryResults
            duration={testResult.duration || 0}
            results={testResult.results || []}
            sql={testResult.sql || ""}
            error={testResult.error || ""}
            close={() => setTestResult(null)}
            expandable={true}
          />
        </Box>
      ) : null}
    </ModalStandard>
  );
}
