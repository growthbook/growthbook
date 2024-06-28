import { FC } from "react";
import { useForm } from "react-hook-form";
import { ArchetypeInterface } from "back-end/types/archetype";
import Field from "@/components/Forms/Field";
import AttributeForm from "@/components/Archetype/AttributeForm";
import Toggle from "@/components/Forms/Toggle";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Modal from "@/components/Modal";

const ArchetypeAttributesModal: FC<{
  close: () => void;
  header: string;
  initialValues?: Partial<ArchetypeInterface>;
}> = ({ close, header, initialValues }) => {
  const form = useForm<{
    name: string;
    description: string;
    attributes: string;
    isPublic: boolean;
  }>({
    defaultValues: {
      name: initialValues?.name || "",
      description: initialValues?.description || "",
      attributes: initialValues?.attributes || "",
      isPublic: initialValues?.isPublic ?? true,
    },
  });
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const hasPermissionToAddEditArchetypes =
    permissionsUtil.canCreateArchetype() ||
    permissionsUtil.canUpdateArchetype();

  return (
    <Modal
      open={true}
      autoCloseOnSubmit={false}
      close={close}
      cta="Save Archetype"
      successMessage="Archetype saved successfully"
      submit={
        hasPermissionToAddEditArchetypes
          ? form.handleSubmit(async (data) => {
              if (initialValues?.id) {
                await apiCall(`/archetype/${initialValues.id}`, {
                  method: "PUT",
                  body: JSON.stringify({ ...data }),
                });
              } else {
                await apiCall("/archetype/", {
                  method: "POST",
                  body: JSON.stringify({ ...data }),
                });
              }
            })
          : undefined
      }
      header={header}
    >
      {!hasPermissionToAddEditArchetypes ? (
        <div>
          You do not have permission to add or edit archetypes. Please contact
          your account administrator.
        </div>
      ) : (
        <>
          <div>
            <Field label={"Name"} required={true} {...form.register("name")} />
          </div>
          <div>
            <Field
              label={"Description"}
              {...form.register("description")}
              textarea
            />
          </div>
          <div className="mb-3">
            <label className="mr-3">
              Make archetype public?{" "}
              <Tooltip
                body={
                  "Allow other team members to see this archetypal user for testing"
                }
              />
            </label>
            <Toggle
              id="public"
              value={form.watch("isPublic")}
              setValue={(v) => form.setValue("isPublic", v)}
              label="Public"
            />
          </div>
          <div>
            <AttributeForm
              initialValues={
                form.watch("attributes")
                  ? JSON.parse(form.watch("attributes"))
                  : {}
              }
              useJSONButton={false}
              onChange={(v) => {
                form.setValue("attributes", JSON.stringify(v));
              }}
            />
          </div>
        </>
      )}
    </Modal>
  );
};

export default ArchetypeAttributesModal;
