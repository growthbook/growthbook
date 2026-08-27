import React, { FC, useMemo, useState } from "react";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import {
  ApiInterleavingQueryInterface,
  INTERLEAVING_EXPOSURE_REQUIRED_COLUMNS,
  INTERLEAVING_INTERLEAVE_ID_COLUMN,
} from "shared/validators";
import { useForm } from "react-hook-form";
import { PiArrowSquareOut } from "react-icons/pi";
import { TestQueryRow } from "shared/types/integrations";
import Code from "@/components/SyntaxHighlighting/Code";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import EditSqlModal from "@/components/SchemaBrowser/EditSqlModal";
import { useAuth } from "@/services/auth";

type InterleavingQueryFormValues = {
  name: string;
  description?: string;
  userIdType: string;
  query: string;
  hasInterleaveId: boolean;
};

type Props = {
  interleavingQuery?: ApiInterleavingQueryInterface;
  dataSource: DataSourceInterfaceWithParams;
  mode: "add" | "edit";
  onSave: (q: ApiInterleavingQueryInterface) => void;
  onCancel: () => void;
};

/**
 * Authoring modal for Interleaving exposure queries: one row per impression x
 * item from the SDK's interleave exposure events. Running the test query
 * validates the required columns and detects whether `interleave_id` is
 * present, which decides the analysis method (paired vs ownership).
 */
export const AddEditInterleavingQueryModal: FC<Props> = ({
  interleavingQuery,
  dataSource,
  mode,
  onSave,
  onCancel,
}) => {
  const { apiCall } = useAuth();

  const userIdTypeOptions = (dataSource?.settings?.userIdTypes || []).map(
    ({ userIdType }) => ({ display: userIdType, value: userIdType }),
  );
  const defaultUserId = userIdTypeOptions[0]?.value || "user_id";

  const defaultQuery = `SELECT\n  ${defaultUserId} as ${defaultUserId},\n  timestamp as timestamp,\n  experiment_id as experiment_id,\n  interleave_id as interleave_id,\n  item_id as item_id,\n  variation as variation,\n  competitive as competitive\nFROM my_interleave_exposures`;

  const [uiMode, setUiMode] = useState<"view" | "sql">("view");
  // null until a test query has run; then whether interleave_id came back
  const [detectedInterleaveId, setDetectedInterleaveId] = useState<
    boolean | null
  >(mode === "edit" ? (interleavingQuery?.hasInterleaveId ?? null) : null);

  const form = useForm<InterleavingQueryFormValues>({
    defaultValues:
      mode === "edit" && interleavingQuery
        ? {
            name: interleavingQuery.name,
            description: interleavingQuery.description ?? "",
            userIdType: interleavingQuery.userIdType,
            query: interleavingQuery.query,
            hasInterleaveId: interleavingQuery.hasInterleaveId,
          }
        : {
            name: "",
            description: "",
            userIdType: defaultUserId,
            query: defaultQuery,
            hasInterleaveId: false,
          },
  });

  const userEnteredUserIdType = form.watch("userIdType");
  const userEnteredQuery = form.watch("query");

  const requiredColumns = useMemo(() => {
    return new Set([
      ...INTERLEAVING_EXPOSURE_REQUIRED_COLUMNS,
      userEnteredUserIdType,
    ]);
  }, [userEnteredUserIdType]);

  const saveEnabled = !!userEnteredUserIdType && !!userEnteredQuery;

  const handleSubmit = form.handleSubmit(async (value) => {
    const hasInterleaveId =
      detectedInterleaveId ??
      new RegExp(`\\b${INTERLEAVING_INTERLEAVE_ID_COLUMN}\\b`, "i").test(
        value.query ?? "",
      );

    const sharedFields = {
      name: value.name,
      description: value.description || undefined,
      userIdType: value.userIdType,
      query: value.query,
      hasInterleaveId,
    };

    const res =
      mode === "edit" && interleavingQuery
        ? await apiCall<{
            interleavingQuery: ApiInterleavingQueryInterface;
          }>(`/api/v1/interleaving-queries/${interleavingQuery.id}`, {
            method: "PUT",
            body: JSON.stringify(sharedFields),
          })
        : await apiCall<{
            interleavingQuery: ApiInterleavingQueryInterface;
          }>("/api/v1/interleaving-queries", {
            method: "POST",
            body: JSON.stringify({
              datasourceId: dataSource.id,
              ...sharedFields,
            }),
          });

    onSave(res.interleavingQuery);
  });

  const validateResponse = (result: TestQueryRow) => {
    if (!result) return;
    const returnedColumns = new Set(
      Object.keys(result).map((c) => c.toLowerCase()),
    );
    const missingColumns = Array.from(requiredColumns).filter(
      (col) => !returnedColumns.has(col.toLowerCase()),
    );
    if (missingColumns.length > 0) {
      throw new Error(
        `You are missing the following columns: ${missingColumns.join(", ")}`,
      );
    }
    setDetectedInterleaveId(
      returnedColumns.has(INTERLEAVING_INTERLEAVE_ID_COLUMN) &&
        result[INTERLEAVING_INTERLEAVE_ID_COLUMN] != null,
    );
  };

  const modalTitle =
    mode === "add"
      ? "Add an interleaving exposure query"
      : `Edit ${interleavingQuery?.name ?? "interleaving exposure"} query`;

  if (uiMode === "sql") {
    return (
      <EditSqlModal
        close={() => setUiMode("view")}
        datasourceId={dataSource.id || ""}
        requiredColumns={requiredColumns}
        value={userEnteredQuery}
        save={async (sql) => {
          form.setValue("query", sql);
        }}
        validateResponseOverride={validateResponse}
        sqlObjectInfo={{
          objectType: "Interleaving Exposure Query",
          objectName: form.watch("name"),
        }}
      />
    );
  }

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      submit={handleSubmit}
      close={onCancel}
      size="lg"
      header={modalTitle}
      cta="Save"
      ctaEnabled={saveEnabled}
    >
      <div className="my-2 ml-3 mr-3">
        <Field label="Display name" required {...form.register("name")} />
        <Field
          label="Description (optional)"
          textarea
          minRows={1}
          maxLength={MAX_DESCRIPTION_LENGTH}
          {...form.register("description")}
        />
        <SelectField
          label="Identifier type"
          options={userIdTypeOptions.map((i) => ({
            value: i.value,
            label: i.display,
          }))}
          required
          value={form.watch("userIdType")}
          onChange={(value) => form.setValue("userIdType", value)}
        />

        <div className="form-group">
          <label className="mr-5">Query</label>
          {userEnteredQuery === defaultQuery && (
            <Callout status="info" mb="2">
              The prefilled query below may require editing to fit your data
              structure.
            </Callout>
          )}
          {userEnteredQuery && (
            <Code language="sql" code={userEnteredQuery} expandable={true} />
          )}
          <div>
            <Button
              mt="2"
              onClick={() => setUiMode("sql")}
              icon={<PiArrowSquareOut />}
              iconPosition="right"
            >
              Customize SQL
            </Button>
          </div>
        </div>

        {detectedInterleaveId !== null && (
          <Callout status={detectedInterleaveId ? "success" : "warning"} mt="2">
            {detectedInterleaveId
              ? "interleave_id detected — impression-level joins are available, so metrics with an interleave_id column use the more sensitive paired analysis."
              : "No interleave_id detected — metrics will use the ownership analysis (per-user item ownership shares). Add an interleave_id column to enable the paired analysis."}
          </Callout>
        )}
      </div>
    </ModalStandard>
  );
};

export default AddEditInterleavingQueryModal;
