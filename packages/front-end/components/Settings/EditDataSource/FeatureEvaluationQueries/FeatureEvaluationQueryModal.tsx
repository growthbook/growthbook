import React, { FC, useState } from "react";
import {
  DataSourceInterfaceWithParams,
  FeatureUsageQuery,
} from "shared/types/datasource";
import { useForm } from "react-hook-form";
import cloneDeep from "lodash/cloneDeep";
import uniqId from "uniqid";
import { FaExternalLinkAlt } from "react-icons/fa";
import {
  EVENT_FORWARDER_MANAGED_FEATURE_USAGE_QUERY_DESCRIPTION,
  isEventForwarderManagedFeatureUsageQuery,
  releaseEventForwarderManagedDescription,
} from "shared/util";
import { TestQueryRow } from "shared/types/integrations";
import Code from "@/components/SyntaxHighlighting/Code";
import Modal from "@/components/Modal";
import EditSqlModal from "@/components/SchemaBrowser/EditSqlModal";
import Callout from "@/ui/Callout";

type FeatureEvaluationQueryProps = {
  featureUsageQuery?: FeatureUsageQuery;
  dataSource: DataSourceInterfaceWithParams;
  mode: "add" | "edit";
  onSave: (featureUsageQuery: FeatureUsageQuery) => Promise<void>;
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
    mode === "add" ? "Add a Feature Usage query" : `Edit Feature Usage query`;

  const defaultQuery = `SELECT\n  timestamp as timestamp,\n  feature_key as feature_key,\n  value as value\nFROM my_table`;

  const form = useForm<FeatureUsageQuery>({
    defaultValues:
      mode === "edit" && featureUsageQuery
        ? cloneDeep<FeatureUsageQuery>(featureUsageQuery)
        : {
            id: uniqId("tbl_"),
            query: defaultQuery,
          },
  });

  const userEnteredQuery = form.watch("query");

  const isEventForwarderManaged =
    mode === "edit" &&
    !!featureUsageQuery &&
    isEventForwarderManagedFeatureUsageQuery(featureUsageQuery);

  const handleSubmit = form.handleSubmit(async (value) => {
    // Editing hands the query to the user, matching assignment queries. It stops
    // being an Event Forwarder resource rather than being overwritten later.
    if (isEventForwarderManaged) {
      value.managedBy = "";
      value.description = releaseEventForwarderManagedDescription(
        value.description,
        EVENT_FORWARDER_MANAGED_FEATURE_USAGE_QUERY_DESCRIPTION,
      );
    }
    await onSave(value);

    form.reset({
      id: undefined,
      query: "",
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
          }}
        />
      )}

      <Modal
        useRadixButton={false}
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
          {isEventForwarderManaged ? (
            <Callout status="info" mb="4">
              Managed by the Event Forwarder. Saving any edit takes ownership
              and stops automatic updates.
            </Callout>
          ) : null}
          <div className="row">
            <div className="col-12">
              <div className="form-group">
                <label className="mr-5">Query</label>
                {userEnteredQuery === defaultQuery && (
                  <Callout status="info">
                    The prefilled query below may require editing to fit your
                    data structure.
                  </Callout>
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
