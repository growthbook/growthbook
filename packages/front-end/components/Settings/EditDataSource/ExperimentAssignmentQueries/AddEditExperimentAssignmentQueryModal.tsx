import React, { FC, Fragment, useMemo, useState } from "react";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { Box, Flex } from "@radix-ui/themes";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "shared/types/datasource";
import {
  formatInvalidTargetingAttributeColumnMessages,
  formatMalformedTargetingAttributeColumnMessages,
  getInvalidTargetingAttributeColumnsForExposureQueries,
  getMalformedTargetingAttributeColumnsForExposureQueries,
  TARGETING_ATTRIBUTE_COLUMN_FORMAT_HELP,
  TARGETING_ATTRIBUTE_COLUMN_HELP_AFTER_SETTINGS_LINK,
  TARGETING_ATTRIBUTE_COLUMN_HELP_BEFORE_SETTINGS_LINK,
  TARGETING_ATTRIBUTE_COLUMN_SETTINGS_LINK_LABEL,
} from "shared/validators";
import { useForm } from "react-hook-form";
import cloneDeep from "lodash/cloneDeep";
import uniqId from "uniqid";
import { FaExclamationTriangle, FaExternalLinkAlt } from "react-icons/fa";
import { TestQueryRow } from "shared/types/integrations";
import Code from "@/components/SyntaxHighlighting/Code";
import StringArrayField from "@/components/Forms/StringArrayField";
import Tooltip from "@/components/Tooltip/Tooltip";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import EditSqlModal from "@/components/SchemaBrowser/EditSqlModal";
import Checkbox from "@/ui/Checkbox";
import Link from "@/ui/Link";
import { useUser } from "@/services/UserContext";

type EditExperimentAssignmentQueryProps = {
  exposureQuery?: ExposureQuery;
  dataSource: DataSourceInterfaceWithParams;
  mode: "add" | "edit";
  onSave: (exposureQuery: ExposureQuery) => void;
  onCancel: () => void;
};

function targetingAttributeColumnsValidationError(columns: string[]): Error {
  const unique = [...new Set(columns)];
  const plain = formatInvalidTargetingAttributeColumnMessages(unique);
  const err = new Error(plain);
  (err as Error & { display?: React.ReactNode }).display = (
    <Box>
      {unique.map((col, i) => (
        <Fragment key={col}>
          <div style={{ marginTop: i > 0 ? "var(--space-3)" : 0 }}>
            {col} is not a saved targeting attribute.{" "}
            {TARGETING_ATTRIBUTE_COLUMN_HELP_BEFORE_SETTINGS_LINK}
            <Link href="/attributes">
              {TARGETING_ATTRIBUTE_COLUMN_SETTINGS_LINK_LABEL}
            </Link>
            {TARGETING_ATTRIBUTE_COLUMN_HELP_AFTER_SETTINGS_LINK}
          </div>
        </Fragment>
      ))}
    </Box>
  );
  return err;
}

function malformedTargetingAttributeColumnsValidationError(
  columns: string[],
): Error {
  const unique = [...new Set(columns)];
  const plain = formatMalformedTargetingAttributeColumnMessages(unique);
  const err = new Error(plain);
  (err as Error & { display?: React.ReactNode }).display = (
    <Box>
      {unique.map((col, i) => (
        <div key={col} style={{ marginTop: i > 0 ? "var(--space-3)" : 0 }}>
          &quot;{col}&quot; is not a valid column name.{" "}
          {TARGETING_ATTRIBUTE_COLUMN_FORMAT_HELP}
        </div>
      ))}
    </Box>
  );
  return err;
}

export const AddEditExperimentAssignmentQueryModal: FC<
  EditExperimentAssignmentQueryProps
> = ({ exposureQuery, dataSource, mode, onSave, onCancel }) => {
  const { settings } = useUser();
  const attributeSchema = settings?.attributeSchema ?? [];
  const [showAdvancedMode, setShowAdvancedMode] = useState(
    () =>
      (exposureQuery?.targetingAttributeColumns?.length ?? 0) > 0 ||
      (exposureQuery?.dimensions?.length ?? 0) > 0 ||
      !!exposureQuery?.hasNameCol,
  );
  const [isContextualBanditQuery, setIsContextualBanditQuery] = useState(
    () => (exposureQuery?.targetingAttributeColumns?.length ?? 0) > 0,
  );
  const [uiMode, setUiMode] = useState<"view" | "sql" | "dimension">("view");
  const modalTitle =
    mode === "add"
      ? "Add an Experiment Assignment query"
      : `Edit ${
          exposureQuery ? exposureQuery.name : "Experiment Assignment"
        } query`;

  const userIdTypeOptions = dataSource?.settings?.userIdTypes?.map(
    ({ userIdType }) => ({
      display: userIdType,
      value: userIdType,
    }),
  );
  const defaultUserId = userIdTypeOptions
    ? userIdTypeOptions[0]?.value
    : "user_id";

  const defaultQuery = `SELECT\n  ${defaultUserId} as ${defaultUserId},\n  timestamp as timestamp,\n  experiment_id as experiment_id,\n  variation_id as variation_id\nFROM my_table`;

  const form = useForm<ExposureQuery>({
    defaultValues:
      mode === "edit" && exposureQuery
        ? {
            ...cloneDeep<ExposureQuery>(exposureQuery),
            dimensions: exposureQuery.dimensions ?? [],
            targetingAttributeColumns:
              exposureQuery.targetingAttributeColumns ?? [],
          }
        : {
            description: "",
            id: uniqId("tbl_"),
            name: "",
            dimensions: [],
            targetingAttributeColumns: [],
            query: defaultQuery,
            userIdType: userIdTypeOptions ? userIdTypeOptions[0]?.value : "",
          },
  });

  // User-entered values
  const userEnteredUserIdType = form.watch("userIdType");
  const userEnteredQuery = form.watch("query");
  const userEnteredDimensions = form.watch("dimensions");
  const userEnteredTargetingAttributeColumns = form.watch(
    "targetingAttributeColumns",
  );
  const userEnteredHasNameCol = form.watch("hasNameCol");

  const composeExposureQueryPayload = (): ExposureQuery => {
    const registered = form.getValues();
    const base =
      mode === "edit" && exposureQuery
        ? cloneDeep<ExposureQuery>(exposureQuery)
        : ({} as ExposureQuery);
    // Dimensions / query / targeting columns use `setValue` + watch, not `register`.
    // Prefer `getValues()` after blur, then fall back to watch.
    return {
      ...base,
      ...registered,
      id: registered.id ?? base.id,
      query: registered.query ?? userEnteredQuery,
      dimensions: [...(registered.dimensions ?? userEnteredDimensions ?? [])],
      targetingAttributeColumns: isContextualBanditQuery
        ? [
            ...(registered.targetingAttributeColumns ??
              userEnteredTargetingAttributeColumns ??
              []),
          ]
        : [],
      hasNameCol: !!(registered.hasNameCol ?? userEnteredHasNameCol),
    };
  };

  const handleSubmit = form.handleSubmit(async () => {
    // CreatableSelect only commits pending text on blur; blur before read so
    // `getValues` / watch include the last token when Save is clicked.
    (document.activeElement as HTMLElement | null)?.blur?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const value = composeExposureQueryPayload();
    if (isContextualBanditQuery) {
      // Format is a hard constraint (these columns are interpolated into SQL),
      // so reject malformed identifiers before the membership check.
      const malformed = getMalformedTargetingAttributeColumnsForExposureQueries(
        [value],
      );
      if (malformed.length > 0) {
        // Must reject so Modal does not treat submit as success and auto-close
        // (see Modal.tsx: await submit() then close when autoCloseOnSubmit).
        throw malformedTargetingAttributeColumnsValidationError(
          malformed.map((i) => i.column),
        );
      }
      const invalid = getInvalidTargetingAttributeColumnsForExposureQueries(
        attributeSchema,
        [value],
      );
      if (invalid.length > 0) {
        throw targetingAttributeColumnsValidationError(
          invalid.map((i) => i.column),
        );
      }
    }
    await onSave(value);

    setIsContextualBanditQuery(false);
    form.reset({
      id: undefined,
      query: "",
      name: "",
      dimensions: [],
      targetingAttributeColumns: [],
      description: "",
      hasNameCol: false,
      userIdType: undefined,
    });
  });

  const requiredColumns = useMemo(() => {
    return new Set([
      "experiment_id",
      "variation_id",
      "timestamp",
      userEnteredUserIdType,
      ...(userEnteredDimensions || []),
      ...(isContextualBanditQuery
        ? userEnteredTargetingAttributeColumns || []
        : []),
      ...(userEnteredHasNameCol ? ["experiment_name", "variation_name"] : []),
    ]);
  }, [
    userEnteredUserIdType,
    userEnteredDimensions,
    userEnteredTargetingAttributeColumns,
    userEnteredHasNameCol,
    isContextualBanditQuery,
  ]);

  const identityTypes = useMemo(
    () => dataSource.settings.userIdTypes || [],
    [dataSource.settings.userIdTypes],
  );

  const saveEnabled = !!userEnteredUserIdType && !!userEnteredQuery;

  if (!exposureQuery && mode === "edit") {
    console.error(
      "ImplementationError: exposureQuery is required for Edit mode",
    );
    return null;
  }

  const validateResponse = (result: TestQueryRow) => {
    if (!result) return;

    const namedCols = ["experiment_name", "variation_name"];
    const userIdTypes = identityTypes?.map((type) => type.userIdType || []);

    const requiredColumnsArray = Array.from(requiredColumns);
    const userEnteredTargetingCols =
      form.getValues("targetingAttributeColumns") ?? [];
    const returnedColumns = new Set<string>(Object.keys(result));
    const optionalColumns = [...returnedColumns].filter(
      (col) =>
        !requiredColumns.has(col) &&
        !namedCols.includes(col) &&
        !userIdTypes?.includes(col),
    );
    let missingColumns = requiredColumnsArray.filter((col) => !(col in result));

    // Check if `hasNameCol` should be enabled
    if (!userEnteredHasNameCol) {
      // Selected both required columns, turn on `hasNameCol` automatically
      if (
        returnedColumns.has("experiment_name") &&
        returnedColumns.has("variation_name")
      ) {
        form.setValue("hasNameCol", true);
      }
      // Only selected `experiment_name`, add warning
      else if (returnedColumns.has("experiment_name")) {
        throw new Error(
          "Missing variation_name column. Please add it to your SELECT clause to enable GrowthBook to populate names automatically or remove experiment_name.",
        );
      }
      // Only selected `variation_name`, add warning
      else if (returnedColumns.has("variation_name")) {
        throw new Error(
          "Missing experiment_name column. Please add it to your SELECT clause to enable GrowthBook to populate names automatically or remove variation_name.",
        );
      }
    } else {
      // `hasNameCol` is enabled, make sure both name columns are selected
      if (
        !returnedColumns.has("experiment_name") &&
        !returnedColumns.has("variation_name")
      ) {
        form.setValue("hasNameCol", false);
        missingColumns = missingColumns.filter(
          (column) =>
            column !== "experiment_name" && column !== "variation_name",
        );
      } else if (
        returnedColumns.has("experiment_name") &&
        !returnedColumns.has("variation_name")
      ) {
        throw new Error(
          "Missing variation_name column. Please add it to your SELECT clause to enable GrowthBook to populate names automatically or remove experiment_name.",
        );
      } else if (
        returnedColumns.has("variation_name") &&
        !returnedColumns.has("experiment_name")
      ) {
        throw new Error(
          "Missing experiment_name column. Please add it to your SELECT clause to enable GrowthBook to populate names automatically or remove variation_name.",
        );
      }
    }

    if (missingColumns.length > 0) {
      // Check if any of the missing columns are dimensions
      const missingDimensions = missingColumns.map((column) => {
        if (userEnteredDimensions.includes(column)) {
          return column;
        }
      });

      // If so, remove them from as a userEnteredDimension & remove from missingColumns
      if (missingDimensions.length > 0) {
        missingColumns = missingColumns.filter(
          (column) => !missingDimensions.includes(column),
        );

        const newUserEnteredDimensions = userEnteredDimensions.filter(
          (column) => !missingDimensions.includes(column),
        );
        form.setValue("dimensions", newUserEnteredDimensions);
      }

      const missingTargeting = missingColumns.filter((column) =>
        userEnteredTargetingCols.includes(column),
      );
      if (missingTargeting.length > 0) {
        missingColumns = missingColumns.filter(
          (column) => !missingTargeting.includes(column),
        );
        form.setValue(
          "targetingAttributeColumns",
          userEnteredTargetingCols.filter(
            (column) => !missingTargeting.includes(column),
          ),
        );
      }

      // Now, if missingColumns still has a length, throw an error
      if (missingColumns.length > 0) {
        throw new Error(
          `You are missing the following columns: ${missingColumns.join(", ")}`,
        );
      }
    }

    // Add optional columns as dimensions
    if (optionalColumns.length > 0) {
      form.setValue("dimensions", [
        ...userEnteredDimensions,
        ...optionalColumns,
      ]);
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
            objectType: "Experiment Assignment Query",
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
        autoFocusSelector="#id-modal-identify-joins-heading"
      >
        <div className="my-2 ml-3 mr-3">
          <div className="row">
            <div className="col-12">
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
                options={identityTypes.map((i) => i.userIdType)}
                required
                {...form.register("userIdType")}
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

              <div className="form-group">
                <a
                  href="#"
                  className="ml-auto"
                  style={{ fontSize: "0.9em" }}
                  onClick={(e) => {
                    e.preventDefault();
                    setShowAdvancedMode(!showAdvancedMode);
                  }}
                >
                  {showAdvancedMode ? "Hide" : "Show"} Advanced Options
                </a>
                {showAdvancedMode && (
                  <div>
                    <div>
                      <Flex gap="1" my="3">
                        <Checkbox
                          id="userEnteredNameCol"
                          label="Use Name columns"
                          value={form.watch("hasNameCol") || false}
                          setValue={(value) => {
                            form.setValue("hasNameCol", value);
                          }}
                        />
                        <Tooltip body="Enable this if you store experiment/variation names as well as ids in your table" />
                      </Flex>
                      <StringArrayField
                        label="Dimension Columns"
                        value={userEnteredDimensions}
                        onChange={(dimensions) => {
                          form.setValue("dimensions", dimensions);
                        }}
                      />
                      <Flex gap="1" my="3">
                        <Checkbox
                          id="isContextualBanditQuery"
                          label="Make this a contextual bandit query"
                          value={isContextualBanditQuery}
                          setValue={(value) => {
                            setIsContextualBanditQuery(value);
                            if (!value) {
                              form.setValue("targetingAttributeColumns", []);
                            }
                          }}
                        />
                      </Flex>
                      {isContextualBanditQuery && (
                        <div className="mt-3">
                          <StringArrayField
                            label="Targeting Attribute Columns"
                            value={userEnteredTargetingAttributeColumns ?? []}
                            onChange={(cols) => {
                              form.setValue("targetingAttributeColumns", cols);
                            }}
                          />
                          <small className="form-text text-muted d-block mt-1">
                            Column aliases in your assignment query must match
                            organization targeting attributes (
                            <Link href="/attributes">
                              Settings → Attributes
                            </Link>
                            ). Each name must match a non-archived attribute
                            property. These columns must appear in your SELECT
                            (same as dimension columns).
                          </small>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
};
