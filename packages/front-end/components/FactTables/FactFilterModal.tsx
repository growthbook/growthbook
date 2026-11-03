import {
  CreateFactFilterProps,
  FactFilterInterface,
  FactFilterTestResults,
  FactTableInterface,
  UpdateFactFilterProps,
} from "shared/types/fact-table";
import { useForm } from "react-hook-form";
import { useEffect } from "react";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import Field from "@/components/Forms/Field";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

export interface Props {
  factTable: FactTableInterface;
  existing?: FactFilterInterface;
  canDelete?: boolean;
  close: () => void;
}

export default function FactFilterModal({
  existing,
  factTable,
  canDelete = false,
  close,
}: Props) {
  const { apiCall } = useAuth();
  const { mutateDefinitions } = useDefinitions();

  const form = useForm<Pick<CreateFactFilterProps, "name" | "value">>({
    defaultValues: {
      name: existing?.name || "",
      value: existing?.value || "",
    },
  });

  const isNew = !existing;
  useEffect(() => {
    track(
      isNew ? "View Create Fact Filter Modal" : "View Edit Fact Filter Modal",
    );
  }, [isNew]);

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      close={close}
      header={existing ? "Edit Saved Filter" : "New Saved Filter"}
      submit={validatedSubmit(form, async (value) => {
        // If they added their own "WHERE" to the start, remove it
        value.value = value.value.replace(/^\s*where\s*/i, "").trim();

        if (!value.value) {
          throw new Error("Cannot leave the SQL condition blank");
        }

        // A broken condition would fail every metric that uses it, so check
        // it against the warehouse before saving
        const { result } = await apiCall<{ result: FactFilterTestResults }>(
          `/fact-tables/${factTable.id}/test-filter`,
          { method: "POST", body: JSON.stringify({ value: value.value }) },
        );
        if (result.error) {
          throw new Error(result.error);
        }

        if (existing) {
          // Leaves the description, which this modal doesn't show, unchanged
          const data: UpdateFactFilterProps = {
            name: value.name,
            value: value.value,
          };
          await apiCall(`/fact-tables/${factTable.id}/filter/${existing.id}`, {
            method: "PUT",
            body: JSON.stringify(data),
          });
          track("Edit Fact Filter");
        } else {
          const data: CreateFactFilterProps = { ...value, description: "" };
          await apiCall(`/fact-tables/${factTable.id}/filter`, {
            method: "POST",
            body: JSON.stringify(data),
          });
          track("Create Fact Filter");
        }
        mutateDefinitions();
      })}
      secondaryAction={
        existing && canDelete ? (
          <DeleteButton
            displayName="Saved Filter"
            text="Delete"
            deleteMessage="This will remove the Saved Filter from all metrics that are using it."
            onClick={async () => {
              await apiCall(
                `/fact-tables/${factTable.id}/filter/${existing.id}`,
                { method: "DELETE" },
              );
              mutateDefinitions();
              close();
            }}
          />
        ) : undefined
      }
    >
      <Field label="Name" {...form.register("name")} required />
      <Field
        label="SQL condition"
        textarea
        minRows={2}
        required
        {...form.register("value")}
      />
    </ModalStandard>
  );
}
