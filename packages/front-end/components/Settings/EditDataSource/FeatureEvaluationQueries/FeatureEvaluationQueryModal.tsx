import React, { FC, useState } from "react";
import {
  DataSourceInterfaceWithParams,
  FeatureUsageQuery,
} from "back-end/types/datasource";
import { useForm } from "react-hook-form";
import cloneDeep from "lodash/cloneDeep";
import uniqId from "uniqid";
import { FaExclamationTriangle, FaExternalLinkAlt } from "react-icons/fa";
import { TestQueryRow } from "shared/types/integrations";
import Code from "@/components/SyntaxHighlighting/Code";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import EditSqlModal from "@/components/SchemaBrowser/EditSqlModal";

type FeatureEvaluationQueryProps = {
  featureUsageQuery?: FeatureUsageQuery;
  dataSource: DataSourceInterfaceWithParams;
  mode: "add" | "edit";
  onSave: (featureUsageQuery: FeatureUsageQuery) => void;
  onCancel: () => void;
};

export const FeatureEvaluationQueryModal: FC<FeatureEvaluationQueryProps> = ({
  featureUsageQuery,
  dataSource,
  mode,
  onSave,
  onCancel,
}) => {
  const [uiMode, setUiMode] = useState<"view" | "sql">("view");
  const modalTitle =
    mode === "add"
      ? "Add a Feature Usage query"
      : `Edit ${
          featureUsageQuery ? featureUsageQuery.name : "Feature Usage"
        } query`;

  const defaultQuery = `SELECT\n  timestamp as timestamp,\n  feature_key as feature_key,\n  value as value\nFROM my_table`;

  const form = useForm<FeatureUsageQuery>({
    defaultValues:
      mode === "edit" && featureUsageQuery
        ? cloneDeep<FeatureUsageQuery>(featureUsageQuery)
        : {
            description: "",
            id: uniqId("tbl_"),
            name: "",
            query: defaultQuery,
          },
  });

  // User-entered values
  const userEnteredQuery = form.watch("query");

  const handleSubmit = form.handleSubmit(async (value) => {
    await onSave(value);

    form.reset({
      id: undefined,
      query: "",
      name: "",
      description: "",
    });
  });

  const requiredColumns = new Set(["timestamp", "feature_key"]);

  const saveEnabled = !!userEnteredQuery;

  if (!featureUsageQuery && mode === "edit") {
    console.error(
      "ImplementationError: featureUsageQuery is required for Edit mode",
    );
    return null;
  }

  const validateResponse = (result: TestQueryRow) => {
    if (!result) return;

    const requiredColumnsArray = Array.from(requiredColumns);
    const missingColumns = requiredColumnsArray.filter(
      (col) => !(col in result),
    );

    if (missingColumns.length > 0) {
      throw new Error(
        `You are missing the following columns: ${missingColumns.join(", ")}`,
      );
    }
  };

  return (
    <>
      {uiMode === "sql" && dataSource && (
        <EditSqlModal
          close={() => setUiMode("view")}
          datasourceId={dataSource.id || ""}
          requiredColumns={requiredColumns}
          value={userEnteredQuery}
          save={async (userEnteredQuery) => {
            form.setValue("query", userEnteredQuery);
          }}
          validateResponseOverride={validateResponse}
          sqlObjectInfo={{
            objectType: "Feature Usage Query",
            objectName: form.watch("name"),
          }}
        />
      )}

      <Modal
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
          <div className="row">
            <div className="col-12">
              <Field label="Display Name" required {...form.register("name")} />
              <Field
                label="Description (optional)"
                textarea
                minRows={1}
                {...form.register("description")}
              />
              <div className="form-group">
                <label className="mr-5">Query</label>
                {userEnteredQuery === defaultQuery && (
                  <div className="alert alert-info">
                    <FaExclamationTriangle style={{ marginTop: "-2px" }} /> The
                    prefilled query below may require editing to fit your data
                    structure.
                  </div>
                )}
                {userEnteredQuery && (
                  <Code
                    language="sql"
                    code={userEnteredQuery}
                    expandable={true}
                  />
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
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
};
