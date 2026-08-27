import React, { FC, useMemo, useState } from "react";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import {
  ApiInterleavingQueryInterface,
  INTERLEAVING_EXPOSURE_REQUIRED_COLUMNS,
  INTERLEAVING_ITEM_FIELD_COMPETITIVE,
  INTERLEAVING_ITEM_FIELD_ITEM_ID,
  INTERLEAVING_ITEM_FIELD_VARIATION,
  INTERLEAVING_ITEMS_COLUMN,
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
};

type Props = {
  interleavingQuery?: ApiInterleavingQueryInterface;
  dataSource: DataSourceInterfaceWithParams;
  mode: "add" | "edit";
  onSave: (q: ApiInterleavingQueryInterface) => void;
  onCancel: () => void;
};

/**
 * Authoring modal for Interleaving exposure queries. The query returns one
 * row per impression in the SDK's nested exposure shape — item detail rides
 * in an `items` JSON column that GrowthBook unnests at analysis time.
 * Running the test query validates the required columns and the shape of
 * the `items` array elements.
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

  const defaultQuery = `SELECT\n  ${defaultUserId} as ${defaultUserId},\n  timestamp as timestamp,\n  experiment_id as experiment_id,\n  interleave_id as interleave_id,\n  items as items\nFROM my_interleave_exposures`;

  const [uiMode, setUiMode] = useState<"view" | "sql">("view");

  const form = useForm<InterleavingQueryFormValues>({
    defaultValues:
      mode === "edit" && interleavingQuery
        ? {
            name: interleavingQuery.name,
            description: interleavingQuery.description ?? "",
            userIdType: interleavingQuery.userIdType,
            query: interleavingQuery.query,
          }
        : {
            name: "",
            description: "",
            userIdType: defaultUserId,
            query: defaultQuery,
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
    const sharedFields = {
      name: value.name,
      description: value.description || undefined,
      userIdType: value.userIdType,
      query: value.query,
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

    // Validate the items JSON shape (array of objects with the SDK's
    // InterleavedItemMeta fields)
    const rawItems = result[INTERLEAVING_ITEMS_COLUMN];
    let items: unknown;
    try {
      items = typeof rawItems === "string" ? JSON.parse(rawItems) : rawItems;
    } catch (e) {
      throw new Error(
        `The '${INTERLEAVING_ITEMS_COLUMN}' column must contain a JSON array`,
      );
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error(
        `The '${INTERLEAVING_ITEMS_COLUMN}' column must be a non-empty JSON array of drafted items`,
      );
    }
    const first = items[0] as Record<string, unknown>;
    const requiredFields = [
      INTERLEAVING_ITEM_FIELD_ITEM_ID,
      INTERLEAVING_ITEM_FIELD_VARIATION,
      INTERLEAVING_ITEM_FIELD_COMPETITIVE,
    ];
    const missingFields = requiredFields.filter(
      (f) => first === null || typeof first !== "object" || !(f in first),
    );
    if (missingFields.length > 0) {
      throw new Error(
        `Each element of '${INTERLEAVING_ITEMS_COLUMN}' must include: ${missingFields.join(
          ", ",
        )}`,
      );
    }
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
          <Callout status="info" mb="2">
            Return one row per impression. The drafted items ride in the{" "}
            <code>{INTERLEAVING_ITEMS_COLUMN}</code> JSON column exactly as the
            SDK emits them — GrowthBook unnests them at analysis time.
          </Callout>
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
      </div>
    </ModalStandard>
  );
};

export default AddEditInterleavingQueryModal;
