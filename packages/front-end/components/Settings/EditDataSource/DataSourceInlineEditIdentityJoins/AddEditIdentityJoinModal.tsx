import React, { FC, useMemo } from "react";
import {
  DataSourceInterfaceWithParams,
  IdentityJoinQuery,
} from "back-end/types/datasource";

import { useForm } from "react-hook-form";
import Modal from "@front-end/components/Modal";
import MultiSelectField from "@front-end/components/Forms/MultiSelectField";
import CodeTextArea from "@front-end/components/Forms/CodeTextArea";
import { validateSQL } from "@front-end/services/datasources";
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
    // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
    () => dataSource.settings.queries.identityJoins || [],
    // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
    [dataSource.settings.queries.identityJoins]
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
    <Modal
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
          <CodeTextArea
            label="SQL Query"
            language="sql"
            value={userEnteredQuery}
            setValue={(sql) => form.setValue("query", sql)}
          />
        </div>
      </div>
    </Modal>
  );
};
