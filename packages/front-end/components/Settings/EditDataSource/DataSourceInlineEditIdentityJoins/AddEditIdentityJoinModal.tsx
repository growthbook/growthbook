import React, { FC, useMemo } from "react";
import {
  DataSourceInterfaceWithParams,
  IdentityJoinQuery,
} from "back-end/types/datasource";

import { useForm } from "react-hook-form";
import Modal from "../../../Modal";
import MultiSelectField from "../../../Forms/MultiSelectField";
import CodeTextArea from "../../../Forms/CodeTextArea";
import { isDuplicateIdentityJoin } from "./utils";

type AddEditIdentityJoinModalProps = {
  identityJoin: IdentityJoinQuery | null;
  dataSource: DataSourceInterfaceWithParams;
  mode: "add" | "edit";
  onSave: (identityJoin: IdentityJoinQuery) => void;
  onCancel: () => void;
};

export const AddEditIdentityJoinModal: FC<AddEditIdentityJoinModalProps> = ({
  identityJoin,
  mode,
  dataSource,
  onCancel,
  onSave,
}) => {
  const identityTypes = dataSource.settings.userIdTypes || [];
  const existingIdentityJoins = dataSource.settings.queries.identityJoins || [];

  const defaultQuery = useMemo(() => {
    return (
      "SELECT \n" +
      identityTypes
        .map(({ userIdType }) => `  ${userIdType} as ${userIdType}`)
        .join(", \n") +
      "\nFROM my_table"
    );
  }, [identityTypes]);

  const form = useForm<IdentityJoinQuery>({
    defaultValues: {
      ids: identityJoin?.ids || [],
      query: mode === "add" ? defaultQuery : identityJoin?.query || "",
    },
  });

  const handleSubmit = form.handleSubmit(async (value) => {
    onSave(value);

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

    return `Edit Identifier Join: ${identityJoin.ids.join(" ↔ ")}`;
  }, [mode, identityJoin]);

  if (!identityJoin && mode === "edit") {
    console.error(
      "ImplementationError: identityJoin is required for Edit mode"
    );
    return null;
  }

  return (
    <Modal
      open={true}
      submit={handleSubmit}
      close={onCancel}
      size="max"
      header={modalTitle}
      cta="Save"
      ctaEnabled={saveEnabled}
      autoFocusSelector="#id-modal-identify-joins-heading"
    >
      <h4 id="id-modal-identify-joins-heading">Identifier Join</h4>
      <p>Queries that return a mapping between different identifier types</p>

      <div className="row">
        <div className="col-xs-12 col-md-6">
          <MultiSelectField
            label="Identifier Types"
            value={form.watch("ids")}
            disabled={mode === "edit"}
            onChange={(value) => {
              form.setValue("ids", value);
            }}
            options={identityTypes.map((idType) => ({
              value: idType.userIdType,
              label: idType.userIdType,
            }))}
          />

          <div>
            {form.watch("ids").length ? (
              <>
                <div className="pt-md-4">
                  <strong>Required columns</strong>
                </div>
                <ul>
                  {form.watch("ids").map((id) => (
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
          <CodeTextArea
            label="SQL Query"
            language="sql"
            value={form.watch("query")}
            setValue={(sql) => form.setValue("query", sql)}
          />
        </div>
      </div>
    </Modal>
  );
};
