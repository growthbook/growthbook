import {
  CreateColumnProps,
  ColumnInterface,
  NumberFormat,
  FactTableInterface,
  UpdateColumnProps,
  FactTableColumnType,
} from "back-end/types/fact-table";
import { useForm } from "react-hook-form";
import { useState } from "react";
import { useDefinitions } from "@front-end/services/DefinitionsContext";
import { useAuth } from "@front-end/services/auth";
import Modal from "@front-end/components/Modal";
import Field from "@front-end/components/Forms/Field";
import SelectField from "@front-end/components/Forms/SelectField";
import MarkdownInput from "@front-end/components/Markdown/MarkdownInput";

export interface Props {
  factTable: FactTableInterface;
  existing?: ColumnInterface;
  close: () => void;
}

export default function ColumnModal({ existing, factTable, close }: Props) {
  const { apiCall } = useAuth();

  const [showDescription, setShowDescription] = useState(
    !!existing?.description?.length
  );

  const { mutateDefinitions } = useDefinitions();

  const form = useForm<CreateColumnProps>({
    defaultValues: {
      column: existing?.column || "",
      description: existing?.description || "",
      name: existing?.name || "",
      numberFormat: existing?.numberFormat || "",
      datatype: existing?.datatype || "",
    },
  });

  return (
    <Modal
      open={true}
      close={close}
      cta={"Save"}
      header={existing ? "Edit Column" : "Add Column"}
      submit={form.handleSubmit(async (value) => {
        if (!value.name) value.name = value.column;

        if (existing) {
          const data: UpdateColumnProps = {
            description: value.description,
            name: value.name,
            numberFormat: value.numberFormat,
            datatype: value.datatype,
          };
          await apiCall(
            `/fact-tables/${factTable.id}/column/${existing.column}`,
            {
              method: "PUT",
              body: JSON.stringify(data),
            }
          );
        } else {
          await apiCall(`/fact-tables/${factTable.id}/column`, {
            method: "POST",
            body: JSON.stringify(value),
          });
        }
        mutateDefinitions();
      })}
    >
      {!existing && (
        <div className="alert alert-warning">
          This should only be used if we did not auto-detect your Fact Table
          columns. Please double check your SQL first before using this form.
        </div>
      )}
      <Field
        label="Column"
        {...form.register("column")}
        disabled={!!existing}
      />

      <SelectField
        label="Data Type"
        value={form.watch("datatype")}
        helpText="Only `number` data types can be used to create metrics"
        onChange={(f) => form.setValue("datatype", f as FactTableColumnType)}
        initialOption="Unknown"
        required
        options={[
          {
            label: "Number",
            value: "number",
          },
          {
            label: "String",
            value: "string",
          },
          {
            label: "Date / Datetime",
            value: "date",
          },
          {
            label: "Boolean",
            value: "boolean",
          },
          {
            label: "Other",
            value: "other",
          },
        ]}
      />

      {form.watch("datatype") === "number" && (
        <SelectField
          label="Number Format"
          value={form.watch("numberFormat")}
          helpText="Used to properly format numbers in the UI"
          onChange={(f) => form.setValue("numberFormat", f as NumberFormat)}
          options={[
            {
              label: "Plain Number",
              value: "",
            },
            {
              label: "Currency",
              value: "currency",
            },
            {
              label: "Time (seconds)",
              value: "time:seconds",
            },
          ]}
        />
      )}

      <Field
        label="Display Name"
        {...form.register("name")}
        placeholder={form.watch("column")}
      />

      {showDescription ? (
        <div className="form-group">
          <label>Description</label>
          <MarkdownInput
            value={form.watch("description")}
            setValue={(value) => form.setValue("description", value)}
            autofocus={!existing?.description?.length}
          />
        </div>
      ) : (
        <a
          href="#"
          className="badge badge-light badge-pill mb-3"
          onClick={(e) => {
            e.preventDefault();
            setShowDescription(true);
          }}
        >
          + description
        </a>
      )}
    </Modal>
  );
}
