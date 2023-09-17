import {
  CreateFactProps,
  FactInterface,
  FactNumberFormat,
  FactTableInterface,
  UpdateFactProps,
} from "back-end/types/fact-table";
import { useForm } from "react-hook-form";
import { useState } from "react";
import clsx from "clsx";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import Modal from "../Modal";
import Field from "../Forms/Field";
import SelectField from "../Forms/SelectField";
import MarkdownInput from "../Markdown/MarkdownInput";
import Tooltip from "../Tooltip/Tooltip";

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
      type: existing?.type || "row",
      numberFormat: existing?.numberFormat || "number",
      where: existing?.where || "",
    },
  });

  const type = form.watch("type");

  return (
    <Modal
      open={true}
      close={close}
      cta={"Save"}
      header={existing ? "Edit Fact" : "Add Fact"}
      submit={form.handleSubmit(async (value) => {
        // If they added their own "WHERE" to the start, remove it
        if (value.where) {
          value.where = value.where.replace(/^\s*where\s*/i, "");
        }

        if (existing) {
          const data: UpdateFactProps = {
            description: value.description,
            column: value.column,
            name: value.name,
            numberFormat: value.numberFormat,
            where: value.where,
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

      <div className="mb-3">
        <label>
          Type of Fact{" "}
          <Tooltip
            body={
              <div>
                <div className="mb-2">
                  <strong>Row Count</strong> facts tell you how many rows in the
                  fact table exist. You can optionally add a WHERE clause to
                  filter the rows that are included.
                </div>
                <div>
                  <strong>Numeric Column</strong> facts aggregate the value of a
                  specific column in your fact table - for example, a{" "}
                  <code>revenue</code> or <code>duration</code> column.
                </div>
              </div>
            }
          />
        </label>
        <div>
          <div className="btn-group">
            <button
              type="button"
              className={clsx(
                "btn",
                type === "row" ? "active btn-primary" : "btn-outline-primary"
              )}
              onClick={(e) => {
                e.preventDefault();
                form.setValue("type", "row");
              }}
            >
              Row Count
            </button>
            <button
              type="button"
              className={clsx(
                "btn",
                type === "number" ? "active btn-primary" : "btn-outline-primary"
              )}
              onClick={(e) => {
                e.preventDefault();
                form.setValue("type", "number");
              }}
            >
              Numeric Column
            </button>
          </div>
        </div>
      </div>

      {type === "number" && (
        <Field label="Column" {...form.register("column")} required />
      )}

      {type === "number" && (
        <SelectField
          label="Number Format"
          value={form.watch("numberFormat")}
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
      )}

      <Field
        label="WHERE clause (optional)"
        helpText={<>Limit which rows are included</>}
        {...form.register("where")}
      />
    </Modal>
  );
}
