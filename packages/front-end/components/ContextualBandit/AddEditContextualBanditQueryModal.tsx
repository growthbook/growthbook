import React, { FC, Fragment, useMemo, useState } from "react";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import {
  ApiContextualBanditQueryInterface,
  CONTEXTUAL_BANDIT_EAQ_REQUIRED_COLUMNS,
  formatInvalidTargetingAttributeColumnMessages,
  formatMalformedTargetingAttributeColumnMessages,
  getInvalidTargetingAttributeColumnsForExposureQueries,
  getMalformedTargetingAttributeColumnsForExposureQueries,
} from "shared/validators";
import { useForm } from "react-hook-form";
import { FaExclamationTriangle, FaExternalLinkAlt } from "react-icons/fa";
import { TestQueryRow } from "shared/types/integrations";
import Code from "@/components/SyntaxHighlighting/Code";
import StringArrayField from "@/components/Forms/StringArrayField";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Callout from "@/ui/Callout";
import Field from "@/components/Forms/Field";
import EditSqlModal from "@/components/SchemaBrowser/EditSqlModal";
import Link from "@/ui/Link";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";

type CbQueryFormValues = {
  name: string;
  description?: string;
  userIdType: string;
  query: string;
  targetingAttributeColumns: string[];
};

type Props = {
  /** Existing CB query when editing; omit to create. */
  contextualBanditQuery?: ApiContextualBanditQueryInterface;
  dataSource: DataSourceInterfaceWithParams;
  mode: "add" | "edit";
  /** Called with the saved query so the parent can refresh + select it. */
  onSave: (q: ApiContextualBanditQueryInterface) => void;
  onCancel: () => void;
};

/**
 * Authoring modal for Contextual Bandit Queries — the CB-specific equivalent of the
 * Experiment Assignment Query modal. Unlike the EAQ modal there is no "is contextual
 * bandit" toggle (the whole collection is CB queries) and targeting attribute columns
 * are always required. Saves directly to the `contextualBanditQueries` collection.
 */
export const AddEditContextualBanditQueryModal: FC<Props> = ({
  contextualBanditQuery,
  dataSource,
  mode,
  onSave,
  onCancel,
}) => {
  const { apiCall } = useAuth();
  const { settings } = useUser();
  const attributeSchema = settings?.attributeSchema ?? [];

  const userIdTypeOptions = dataSource?.settings?.userIdTypes?.map(
    ({ userIdType }) => ({ display: userIdType, value: userIdType }),
  );
  const defaultUserId = userIdTypeOptions
    ? userIdTypeOptions[0]?.value
    : "user_id";

  const defaultQuery = `SELECT\n  ${defaultUserId} as ${defaultUserId},\n  timestamp as timestamp,\n  experiment_id as experiment_id,\n  variation_id as variation_id,\n  leaf_id as leaf_id,\n  snapshot_update_count as snapshot_update_count,\n  variation_weights as variation_weights\nFROM my_contextual_bandit_assignments`;

  const [uiMode, setUiMode] = useState<"view" | "sql">("view");

  const form = useForm<CbQueryFormValues>({
    defaultValues:
      mode === "edit" && contextualBanditQuery
        ? {
            name: contextualBanditQuery.name,
            description: contextualBanditQuery.description ?? "",
            userIdType: contextualBanditQuery.userIdType,
            query: contextualBanditQuery.query,
            targetingAttributeColumns:
              contextualBanditQuery.targetingAttributeColumns ?? [],
          }
        : {
            name: "",
            description: "",
            userIdType: userIdTypeOptions ? userIdTypeOptions[0]?.value : "",
            query: defaultQuery,
            targetingAttributeColumns: [],
          },
  });

  const userEnteredUserIdType = form.watch("userIdType");
  const userEnteredQuery = form.watch("query");
  const userEnteredTargetingAttributeColumns = form.watch(
    "targetingAttributeColumns",
  );

  const requiredColumns = useMemo(() => {
    return new Set([
      "experiment_id",
      "variation_id",
      "timestamp",
      userEnteredUserIdType,
      ...(userEnteredTargetingAttributeColumns || []),
      ...CONTEXTUAL_BANDIT_EAQ_REQUIRED_COLUMNS,
    ]);
  }, [userEnteredUserIdType, userEnteredTargetingAttributeColumns]);

  const saveEnabled = !!userEnteredUserIdType && !!userEnteredQuery;

  const handleSubmit = form.handleSubmit(async (value) => {
    // CreatableSelect only commits pending text on blur; force blur first.
    (document.activeElement as HTMLElement | null)?.blur?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const columns = form.getValues("targetingAttributeColumns") ?? [];
    if (columns.length === 0) {
      throw new Error(
        "Add at least one targeting attribute column for a contextual bandit query.",
      );
    }
    // The shared column validators (malformed-first, then unknown) accept the
    // minimal TargetingColumnQuery shape, so reuse them directly.
    const queryForValidation = [
      { id: "new", name: value.name, targetingAttributeColumns: columns },
    ];
    const malformed =
      getMalformedTargetingAttributeColumnsForExposureQueries(
        queryForValidation,
      );
    if (malformed.length > 0) {
      throw new Error(
        formatMalformedTargetingAttributeColumnMessages(
          malformed.map((i) => i.column),
        ),
      );
    }
    const invalid = getInvalidTargetingAttributeColumnsForExposureQueries(
      attributeSchema,
      queryForValidation,
    );
    if (invalid.length > 0) {
      throw new Error(
        formatInvalidTargetingAttributeColumnMessages(
          invalid.map((i) => i.column),
        ),
      );
    }

    const body = {
      datasourceId: dataSource.id,
      name: value.name,
      description: value.description || undefined,
      userIdType: value.userIdType,
      query: value.query,
      targetingAttributeColumns: columns,
    };

    const res =
      mode === "edit" && contextualBanditQuery
        ? await apiCall<{
            contextualBanditQuery: ApiContextualBanditQueryInterface;
          }>(`/api/v1/contextual-bandit-queries/${contextualBanditQuery.id}`, {
            method: "PUT",
            body: JSON.stringify(body),
          })
        : await apiCall<{
            contextualBanditQuery: ApiContextualBanditQueryInterface;
          }>("/api/v1/contextual-bandit-queries", {
            method: "POST",
            body: JSON.stringify(body),
          });

    onSave(res.contextualBanditQuery);
  });

  const validateResponse = (result: TestQueryRow) => {
    if (!result) return;
    const missingColumns = Array.from(requiredColumns).filter(
      (col) => !(col in result),
    );
    if (missingColumns.length > 0) {
      throw new Error(
        `You are missing the following columns: ${missingColumns.join(", ")}`,
      );
    }
  };

  const modalTitle =
    mode === "add"
      ? "Add a Contextual Bandit query"
      : `Edit ${contextualBanditQuery?.name ?? "Contextual Bandit"} query`;

  return (
    <>
      {uiMode === "sql" && (
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
            objectType: "Experiment Assignment Query",
            objectName: form.watch("name"),
          }}
        />
      )}

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
          <Field label="Display Name" required {...form.register("name")} />
          <Field
            label="Description (optional)"
            textarea
            minRows={1}
            maxLength={MAX_DESCRIPTION_LENGTH}
            {...form.register("description")}
          />
          <Field
            label="Identifier Type"
            options={(dataSource.settings.userIdTypes || []).map(
              (i) => i.userIdType,
            )}
            required
            {...form.register("userIdType")}
          />

          <div className="form-group">
            <label className="mr-5">Query</label>
            {userEnteredQuery === defaultQuery && (
              <Callout status="info" mb="2">
                <FaExclamationTriangle style={{ marginTop: "-2px" }} /> The
                prefilled query below may require editing to fit your data
                structure.
              </Callout>
            )}
            {userEnteredQuery && (
              <Code language="sql" code={userEnteredQuery} expandable={true} />
            )}
            <div>
              <button
                className="btn btn-primary mt-2"
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setUiMode("sql");
                }}
              >
                <div className="d-flex align-items-center">
                  Customize SQL
                  <FaExternalLinkAlt className="ml-2" />
                </div>
              </button>
            </div>
          </div>

          <div className="mt-3">
            <StringArrayField
              label="Targeting Attribute Columns"
              value={userEnteredTargetingAttributeColumns ?? []}
              onChange={(cols) => {
                form.setValue("targetingAttributeColumns", cols);
              }}
            />
            <small className="form-text text-muted d-block mt-1">
              Column aliases in your assignment query must match organization
              targeting attributes (
              <Link href="/attributes">Settings → Attributes</Link>). Each name
              must match a non-archived attribute property and appear in your
              SELECT.
            </small>
          </div>
        </div>
      </ModalStandard>
    </>
  );
};

export default AddEditContextualBanditQueryModal;
