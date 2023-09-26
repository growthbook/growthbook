import {
  CreateFactFilterProps,
  FactFilterInterface,
  FactTableInterface,
  UpdateFactFilterProps,
} from "back-end/types/fact-table";
import { useForm } from "react-hook-form";
import { useState } from "react";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import Modal from "../Modal";
import Field from "../Forms/Field";
import MarkdownInput from "../Markdown/MarkdownInput";
import InlineCode from "../SyntaxHighlighting/InlineCode";

export interface Props {
  factTable: FactTableInterface;
  existing?: FactFilterInterface;
  close: () => void;
}

export default function FactFilterModal({ existing, factTable, close }: Props) {
  const { apiCall } = useAuth();

  const [showDescription, setShowDescription] = useState(
    !!existing?.description?.length
  );

  const { mutateDefinitions } = useDefinitions();

  const form = useForm<CreateFactFilterProps>({
    defaultValues: {
      description: existing?.description || "",
      name: existing?.name || "",
      value: existing?.value || "",
    },
  });

  return (
    <Modal
      open={true}
      close={close}
      cta={"Save"}
      header={existing ? "Edit Filter" : "Add Filter"}
      submit={form.handleSubmit(async (value) => {
        // If they added their own "WHERE" to the start, remove it
        value.value = value.value.replace(/^\s*where\s*/i, "").trim();

        if (!value.value) {
          throw new Error("Cannot leave Filter SQL blank");
        }

        if (existing) {
          const data: UpdateFactFilterProps = {
            description: value.description,
            name: value.name,
            value: value.value,
          };
          await apiCall(`/fact-tables/${factTable.id}/filter/${existing.id}`, {
            method: "PUT",
            body: JSON.stringify(data),
          });
        } else {
          await apiCall<{
            factId: string;
          }>(`/fact-tables/${factTable.id}/filter`, {
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

      <Field
        label="Filter SQL"
        required
        textarea
        helpText={
          <>
            Will be inserted into a WHERE clause to limit rows included in a
            fact or metric
          </>
        }
        {...form.register("value")}
      />

      <div className="mt-4 alert alert-info">
        <div className="mb-2">Here are some examples of Filter SQL:</div>
        <table className="table gbtable">
          <tbody>
            <tr>
              <td>
                <InlineCode code={`status = 'active'`} language="sql" />
              </td>
            </tr>
            <tr>
              <td>
                <InlineCode
                  code={`discount > 0 AND coupon IS NOT NULL`}
                  language="sql"
                />
              </td>
            </tr>
            <tr>
              <td>
                <InlineCode
                  code={`country IN ('US','CA','UK')`}
                  language="sql"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
