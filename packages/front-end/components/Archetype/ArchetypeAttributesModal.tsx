import React, { FC } from "react";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { useForm } from "react-hook-form";
import { Trans, useLingui } from "@lingui/react/macro";
import { ArchetypeInterface } from "shared/types/archetype";
import Field from "@/components/Forms/Field";
import AttributeForm from "@/components/Archetype/AttributeForm";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Modal from "@/components/Modal";
import MultiSelectField from "@/ui/MultiSelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import useProjectOptions from "@/hooks/useProjectOptions";
import { useEnvironments } from "@/services/features";
import Checkbox from "@/ui/Checkbox";

const ArchetypeAttributesModal: FC<{
  close: () => void;
  header: string;
  initialValues?: Partial<ArchetypeInterface>;
  source?: string;
}> = ({ close, header, initialValues, source }) => {
  const { t } = useLingui();
  const form = useForm<{
    name: string;
    description: string;
    attributes: string;
    isPublic: boolean;
    projects: string[];
    environments: string[];
  }>({
    defaultValues: {
      name: initialValues?.name || "",
      description: initialValues?.description || "",
      attributes: initialValues?.attributes || "",
      isPublic: initialValues?.isPublic ?? true,
      projects: initialValues?.projects || [],
      environments: initialValues?.environments || [],
    },
  });

  const { apiCall } = useAuth();
  const { project, projects } = useDefinitions();
  const environments = useEnvironments();
  const permissionsUtil = usePermissionsUtil();
  const hasPermissionToAddEditArchetypes =
    permissionsUtil.canCreateArchetype({
      projects: initialValues?.projects ? initialValues.projects : [project],
    }) ||
    permissionsUtil.canUpdateArchetype(
      {
        projects: initialValues?.projects ? initialValues.projects : [project],
      },
      {},
    );
  const permissionRequired = (project: string) => {
    return initialValues?.id
      ? permissionsUtil.canUpdateArchetype(
          { projects: initialValues?.projects },
          { projects: [project] },
        )
      : permissionsUtil.canCreateArchetype({ projects: [project] });
  };

  const projectOptions = useProjectOptions(
    permissionRequired,
    form.watch("projects") || [],
  );

  return (
    <Modal
      trackingEventModalType="add-edit-archetype"
      trackingEventModalSource={source}
      open={true}
      autoCloseOnSubmit={false}
      close={close}
      cta={t`Save Archetype`}
      successMessage={t`Archetype saved successfully`}
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
          <Trans>
            You do not have permission to add or edit archetypes. Please contact
            your account administrator.
          </Trans>
        </div>
      ) : (
        <>
          <div>
            <Field
              size="legacy"
              label={t`Name`}
              required={true}
              {...form.register("name")}
            />
          </div>
          <div>
            <Field
              size="legacy"
              label={t`Description`}
              maxLength={MAX_DESCRIPTION_LENGTH}
              {...form.register("description")}
              textarea
            />
          </div>
          {projects?.length > 0 && (
            <div className="form-group">
              <MultiSelectField
                legacyHeight
                label={
                  <>
                    <Trans>Projects</Trans>{" "}
                  </>
                }
                placeholder={t`All Projects`}
                value={form.watch("projects")}
                options={projectOptions}
                onChange={(v) => form.setValue("projects", v)}
                customClassName="label-overflow-ellipsis"
                helpText={t`Assign this archetype to specific projects`}
              />
            </div>
          )}
          {environments.length > 0 && (
            <div className="form-group">
              <MultiSelectField
                label={t`Environments`}
                placeholder={t`All environments`}
                value={form.watch("environments")}
                options={environments.map((env) => ({
                  label: env.id,
                  value: env.id,
                }))}
                onChange={(v) => form.setValue("environments", v)}
                helpText={t`Limit this archetype to specific environments. Leave empty to show it in all environments.`}
              />
            </div>
          )}
          <div className="mb-3">
            <Checkbox
              id="public"
              label={t`Make archetype public`}
              description={t`Allow other team members to see this archetypal user for testing`}
              value={form.watch("isPublic")}
              setValue={(v) => form.setValue("isPublic", v)}
            />
          </div>
          <div>
            <AttributeForm
              attributeValues={
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
