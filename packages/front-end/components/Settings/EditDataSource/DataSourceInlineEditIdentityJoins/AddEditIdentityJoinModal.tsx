import React, { FC, useMemo, useState } from "react";
import {
  DataSourceInterfaceWithParams,
  IdentityJoinQuery,
} from "back-end/types/datasource";

import { useForm } from "react-hook-form";
import { FaExternalLinkAlt } from "react-icons/fa";
import Modal from "@/components/Modal";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { validateSQL } from "@/services/datasources";
import EditSqlModal from "@/components/SchemaBrowser/EditSqlModal";
import Code from "@/components/SyntaxHighlighting/Code";
import { isDuplicateIdentityJoin } from "./utils";

type AddEditIdentityJoinModalProps = {
  identityJoin: IdentityJoinQuery | null;
  dataSource: DataSourceInterfaceWithParams;
  mode: "add" | "edit";
  onSave: (identityJoin: IdentityJoinQuery) => Promise<void>;
  onCancel: () => void;
};

export const AddEditIdentityJoinModal: FC<AddEditIdentityJoinModalProps> = ({
  identityJoin,
  mode,
  dataSource,
  onCancel,
  onSave,
}) => {
  const identityTypes = useMemo(() => dataSource.settings.userIdTypes || [], [
    dataSource.settings.userIdTypes,
  ]);
  const existingIdentityJoins = useMemo(
    () => dataSource.settings.queries?.identityJoins || [],
    [dataSource.settings.queries?.identityJoins]
  );

  const defaultQuery = useMemo(() => {
    return (
      "SELECT \n" +
      identityTypes
        .map(({ userIdType }) => `  ${userIdType} as ${userIdType}`)
        .join(", \n") +
      "\nFROM my_table"
    );
  }, [identityTypes]);

  const [sqlOpen, setSqlOpen] = useState(false);

  const form = useForm<IdentityJoinQuery>({
    defaultValues: {
      ids:
        mode === "add"
          ? identityTypes.map(({ userIdType }) => userIdType)
          : identityJoin?.ids || [],
      query: mode === "add" ? defaultQuery : identityJoin?.query || "",
    },
  });

  const handleSubmit = form.handleSubmit(async (value) => {
    validateSQL(value.query, value.ids);

    await onSave(value);

    form.reset({
      ids: [],
      query: "",
    });
  });

  // region Validation

  const userEnteredIdentityJoinIds = form.watch("ids");
  const userEnteredQuery = form.watch("query");
  const userHasEnteredEnoughData =
    userEnteredQuery && userEnteredIdentityJoinIds.length >= 2;

  const isDuplicate = useMemo(() => {
    return (
      mode === "add" &&
      isDuplicateIdentityJoin(userEnteredIdentityJoinIds, existingIdentityJoins)
    );
  }, [existingIdentityJoins, mode, userEnteredIdentityJoinIds]);

  const saveEnabled = !isDuplicate && userHasEnteredEnoughData;

  // endregion Validation

  const modalTitle = useMemo(() => {
    if (mode === "add") {
      return "Add Identifier Join";
    }

    // @ts-expect-error TS(2531) If you come across this, please fix it!: Object is possibly 'null'.
    return `Edit Identifier Join: ${identityJoin.ids.join(" ↔ ")}`;
  }, [mode, identityJoin]);

  if (!identityJoin && mode === "edit") {
    console.error(
      "ImplementationError: identityJoin is required for Edit mode"
    );
    return null;
  }

  return (
    <>
      {sqlOpen && (
        <EditSqlModal
          close={() => setSqlOpen(false)}
          datasourceId={dataSource.id}
          requiredColumns={new Set(userEnteredIdentityJoinIds)}
          value={userEnteredQuery}
          save={async (sql) => form.setValue("query", sql)}
        />
      )}
      <Modal
        trackingEventModalType=""
        open={true}
        submit={handleSubmit}
        close={onCancel}
        size="max"
        header={modalTitle}
        cta="Save"
        // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'boolean | ""' is not assignable to type 'boo... Remove this comment to see the full error message
        ctaEnabled={saveEnabled}
        autoFocusSelector="#id-modal-identify-joins-heading"
      >
        <h4 id="id-modal-identify-joins-heading">Identifier Join</h4>
        <p>Queries that return a mapping between different identifier types</p>

        <div className="row">
          <div className="col-xs-12 col-md-6">
            <MultiSelectField
              label="Identifier Types"
              value={userEnteredIdentityJoinIds}
              onChange={(value) => {
                form.setValue("ids", value);
              }}
              options={identityTypes.map((idType) => ({
                value: idType.userIdType,
                label: idType.userIdType,
              }))}
            />

            <div>
              {userEnteredIdentityJoinIds.length ? (
                <>
                  <div className="pt-md-4">
                    <strong>Required columns</strong>
                  </div>
                  <ul>
                    {userEnteredIdentityJoinIds.map((id) => (
                      <li key={id}>
                        <code>{id}</code>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          </div>
          <div className="col-xs-12 col-md-6">
            <Code language="sql" code={userEnteredQuery} expandable={true} />
            <button
              className="btn btn-outline-primary"
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setSqlOpen(true);
              }}
            >
              Edit SQL <FaExternalLinkAlt />{" "}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
};
