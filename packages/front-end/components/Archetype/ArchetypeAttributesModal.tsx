import React, { FC } from "react";
import { useForm } from "react-hook-form";
import { ArchetypeInterface } from "back-end/types/archetype";
import Field from "@/components/Forms/Field";
import AttributeForm from "@/components/Archetype/AttributeForm";
import Toggle from "@/components/Forms/Toggle";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Modal from "@/components/Modal";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import useProjectOptions from "@/hooks/useProjectOptions";

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
    projects: string[];
  }>({
    defaultValues: {
      name: initialValues?.name || "",
      description: initialValues?.description || "",
      attributes: initialValues?.attributes || "",
      isPublic: initialValues?.isPublic ?? true,
      projects: initialValues?.projects || [],
    },
  });

  const { apiCall } = useAuth();
  const { project, projects } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const hasPermissionToAddEditArchetypes =
    permissionsUtil.canCreateArchetype({
      projects: initialValues?.projects ? initialValues.projects : [project],
    }) ||
    permissionsUtil.canUpdateArchetype(
      {
        projects: initialValues?.projects ? initialValues.projects : [project],
      },
      {}
    );
  const permissionRequired = (project: string) => {
    return initialValues?.id
      ? permissionsUtil.canUpdateArchetype(
          { projects: initialValues?.projects },
          { projects: [project] }
        )
      : permissionsUtil.canCreateArchetype({ projects: [project] });
  };

  const projectOptions = useProjectOptions(
    permissionRequired,
    form.watch("projects") || []
  );

  return (
    <Modal
      trackingEventModalType=""
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
          {projects?.length > 0 && (
            <div className="form-group">
              <MultiSelectField
                label={<>Projects </>}
                placeholder="All projects"
                value={form.watch("projects")}
                options={projectOptions}
                onChange={(v) => form.setValue("projects", v)}
                customClassName="label-overflow-ellipsis"
                helpText="Assign this archetype to specific projects"
              />
            </div>
          )}
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
