import {
  CreateFactProps,
  FactInterface,
  FactNumberFormat,
  FactTableInterface,
  UpdateFactProps,
} from "back-end/types/fact-table";
import { useForm } from "react-hook-form";
import { useState } from "react";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import Modal from "../Modal";
import Field from "../Forms/Field";
import SelectField from "../Forms/SelectField";
import MarkdownInput from "../Markdown/MarkdownInput";

export interface Props {
  factTable: FactTableInterface;
  existing?: FactInterface;
  close: () => void;
}

export default function FactModal({ existing, factTable, close }: Props) {
  const { apiCall } = useAuth();

  const [showDescription, setShowDescription] = useState(
    !!existing?.description?.length
  );

  const { mutateDefinitions } = useDefinitions();

  const form = useForm<CreateFactProps>({
    defaultValues: {
      column: existing?.column || "",
      description: existing?.description || "",
      name: existing?.name || "",
      numberFormat: existing?.numberFormat || "number",
    },
  });

  return (
    <Modal
      open={true}
      close={close}
      cta={"Save"}
      header={existing ? "Edit Fact" : "Add Fact"}
      submit={form.handleSubmit(async (value) => {
        if (existing) {
          const data: UpdateFactProps = {
            description: value.description,
            column: value.column,
            name: value.name,
            numberFormat: value.numberFormat,
          };
          await apiCall(`/fact-tables/${factTable.id}/fact/${existing.id}`, {
            method: "PUT",
            body: JSON.stringify(data),
          });
        } else {
          await apiCall<{
            factId: string;
          }>(`/fact-tables/${factTable.id}/fact`, {
            method: "POST",
            body: JSON.stringify(value),
          });
        }
        mutateDefinitions();
      })}
    >
      <div className="alert alert-info">
        <strong>Note:</strong> If you just want to count rows/users in the Fact
        Table, you don&apos;t need to create a Fact for that. You can just
        create a Metric directly.
      </div>

      <Field label="Name" {...form.register("name")} required />

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

      <Field label="Column" {...form.register("column")} required />

      <SelectField
        label="Number Format"
        value={form.watch("numberFormat")}
        helpText="Used to properly format numbers in the UI"
        onChange={(f) => form.setValue("numberFormat", f as FactNumberFormat)}
        options={[
          {
            label: "Plain Number",
            value: "number",
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
        required
      />
    </Modal>
  );
}
