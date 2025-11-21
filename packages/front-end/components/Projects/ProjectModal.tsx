import { ProjectInterface } from "back-end/types/project";
import { useForm } from "react-hook-form";
import { generateProjectUidFromName } from "shared/util";
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
  const [linkNameWithUid, setLinkNameWithUid] = useState(!existing.id);
  const [uidValueDisabled, setUidValueDisabled] = useState(!!existing.id);
  const form = useForm<Partial<ProjectInterface>>({
    defaultValues: {
      name: existing.name || "",
      description: existing.description || "",
      uid: existing.uid || "",
    },
  });
  const { apiCall } = useAuth();

  const nameFieldHandlers = form.register("name", {
    setValueAs: (s) => s?.trim(),
  });
  const uidFieldHandlers = form.register("uid");

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
          // Ensure the name field is updated and then sync with uid if possible
          nameFieldHandlers.onChange(e);

          if (existing.id) return;
          if (!linkNameWithUid) return;
          const val = e?.target?.value ?? form.watch("name");
          if (!val) {
            form.setValue("uid", "");
            return;
          }
          // Generate uid and check for uniqueness (simplified - just check once)
          const baseUid = generateProjectUidFromName(val);
          if (!baseUid) {
            // If no slug can be generated, leave uid empty (will use id as fallback on backend)
            form.setValue("uid", "");
            return;
          }

          const isUnique = !projects.some(
            (p) => p.uid === baseUid && p.id !== existing.id,
          );

          if (isUnique) {
            form.setValue("uid", baseUid);
          } else {
            // If not unique, leave empty - backend will use id as fallback
            form.setValue("uid", "");
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
                setUidValueDisabled(!uidValueDisabled);
              }}
            >
              {uidValueDisabled ? (
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
          disabled={uidValueDisabled}
          {...uidFieldHandlers}
          onChange={(e) => {
            uidFieldHandlers.onChange(e);
            setLinkNameWithUid(false);
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
