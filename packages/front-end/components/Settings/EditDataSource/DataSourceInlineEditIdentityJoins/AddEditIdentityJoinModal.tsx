import React, { FC, useCallback, useMemo } from "react";
import {
  DataSourceInterfaceWithParams,
  IdentityJoinQuery,
} from "back-end/types/datasource";
import isEqual from "lodash/isEqual";
import intersectionBy from "lodash/intersectionBy";

import { useForm } from "react-hook-form";
import Modal from "../../../Modal";
import MultiSelectField from "../../../Forms/MultiSelectField";
import CodeTextArea from "../../../Forms/CodeTextArea";

type AddEditIdentityJoinModalProps = {
  identityJoin: IdentityJoinQuery | null;
  dataSource: DataSourceInterfaceWithParams;
  mode: "add" | "edit";
  onSave: (identityJoin: IdentityJoinQuery) => void;
  onCancel: () => void;
  // TODO: other props
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

  // TODO: Validate
  const saveEnabled = true;

  // const isDuplicate = useMemo(() => {
  //   intersectionBy(existingIdentityJoins, )
  //   // return mode === "add" && existingIdentityJoins.filter(identityJoin => isEqual());
  // }, [existingIdentityJoins, mode]);

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
            onChange={(value) => {
              form.setValue("ids", value);
            }}
            options={identityTypes.map((idType) => ({
              value: idType.userIdType,
              label: idType.userIdType,
            }))}
          />

          <div>
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
