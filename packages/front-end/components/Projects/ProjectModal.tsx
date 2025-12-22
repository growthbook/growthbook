import { ProjectInterface } from "back-end/types/project";
import { useForm } from "react-hook-form";
import { generateProjectPublicIdFromName } from "shared/util";
import { useState } from "react";
import { Flex, Text } from "@radix-ui/themes";
import { PiLockBold, PiLockOpenBold } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import { useDefinitions } from "@/services/DefinitionsContext";

export default function ProjectModal({
  existing,
  close,
  onSuccess,
}: {
  existing: Partial<ProjectInterface>;
  close: () => void;
  onSuccess: () => Promise<void>;
}) {
  const { projects } = useDefinitions();
  const [linkNameWithPublicId, setLinkNameWithPublicId] = useState(
    !existing.id,
  );
  const [publicIdValueDisabled, setPublicIdValueDisabled] = useState(
    !!existing.id,
  );
  const form = useForm<Partial<ProjectInterface>>({
    defaultValues: {
      name: existing.name || "",
      description: existing.description || "",
      publicId: existing.publicId || "",
    },
  });
  const { apiCall } = useAuth();

  const nameFieldHandlers = form.register("name", {
    setValueAs: (s) => s?.trim(),
  });

  // Display value: use publicId if set, otherwise show id as fallback
  const publicIdDisplayValue = form.watch("publicId") || existing.id || "";

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      close={close}
      header={existing.id ? "Edit Project" : "Create Project"}
      submit={form.handleSubmit(async (value) => {
        await apiCall(existing.id ? `/projects/${existing.id}` : `/projects`, {
          method: existing.id ? "PUT" : "POST",
          body: JSON.stringify(value),
        });
        await onSuccess();
      })}
    >
      <Field
        label="Name"
        maxLength={30}
        required
        {...nameFieldHandlers}
        onChange={async (e) => {
          // Ensure the name field is updated and then sync with publicId if possible
          nameFieldHandlers.onChange(e);

          if (existing.id) return;
          if (!linkNameWithPublicId) return;
          const val = e?.target?.value ?? form.watch("name");
          if (!val) {
            form.setValue("publicId", "");
            return;
          }
          // Generate publicId and check for uniqueness (simplified - just check once)
          const basePublicId = generateProjectPublicIdFromName(val);
          if (!basePublicId) {
            // If no slug can be generated, leave publicId empty (will use id as fallback on backend)
            form.setValue("publicId", "");
            return;
          }

          const isUnique = !projects.some(
            (p) => p.publicId === basePublicId && p.id !== existing.id,
          );

          if (isUnique) {
            form.setValue("publicId", basePublicId);
          } else {
            // If not unique, leave empty - backend will use id as fallback
            form.setValue("publicId", "");
          }
        }}
      />

      <div className="form-group">
        <Flex align="end" justify="between" mb="1">
          <label>Public ID</label>
          {existing.id && (
            <Text
              color="purple"
              size="1"
              weight="medium"
              style={{ cursor: "pointer" }}
              onClick={() => {
                setPublicIdValueDisabled(!publicIdValueDisabled);
              }}
            >
              {publicIdValueDisabled ? (
                <>
                  <PiLockBold /> Unlock to edit
                </>
              ) : (
                <>
                  <PiLockOpenBold /> Lock editing
                </>
              )}
            </Text>
          )}
        </Flex>
        <Field
          disabled={publicIdValueDisabled}
          value={publicIdDisplayValue}
          onChange={(e) => {
            const newValue = e.target.value;
            // If user clears the field or types the same as id, set publicId to empty (backend will use id)
            // Otherwise, set the typed value as publicId
            if (newValue === "" || newValue === existing.id) {
              form.setValue("publicId", "");
            } else {
              form.setValue("publicId", newValue);
            }
            setLinkNameWithPublicId(false);
          }}
        />
      </div>
      <Field
        label="Description"
        maxLength={100}
        minRows={3}
        maxRows={8}
        textarea={true}
        {...form.register("description")}
      />
    </Modal>
  );
}
