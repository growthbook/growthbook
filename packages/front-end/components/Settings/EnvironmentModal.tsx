import { useForm } from "react-hook-form";
import { Environment } from "shared/types/organization";
import React, { useMemo } from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import { DEFAULT_ENVIRONMENT_IDS } from "shared/util";
import { useAuth } from "@/services/auth";
import { useEnvironments } from "@/services/features";
import { useUser } from "@/services/UserContext";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import useSDKConnections from "@/hooks/useSDKConnections";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import Switch from "@/ui/Switch";
import SelectField from "@/components/Forms/SelectField";
import { DocLink } from "@/components/DocLink";

export default function EnvironmentModal({
  existing,
  close,
  onSuccess,
}: {
  existing: Partial<Environment>;
  close: () => void;
  onSuccess: () => void;
}) {
  const form = useForm<Partial<Environment>>({
    defaultValues: {
      id: existing.id || "",
      description: existing.description || "",
      toggleOnList: existing.toggleOnList || false,
      defaultState: existing.defaultState ?? true,
      projects: existing.projects || [],
      parent: existing.parent,
    },
  });
  const { apiCall } = useAuth();
  const environments = useEnvironments();

  const { data: sdkConnectionData } = useSDKConnections();
  const sdkConnections = useMemo(() => {
    if (!existing.id) return [];
    if (!sdkConnectionData?.connections) return [];
    return sdkConnectionData?.connections?.filter((c) => {
      return c.environment === existing.id;
    });
  }, [sdkConnectionData, existing.id]);

  const selectedProjects = form.watch("projects") ?? [];
  const removedProjects = (existing?.projects ?? []).filter(
    (p) => !selectedProjects.includes(p),
  );
  const addedProjects = selectedProjects.filter(
    (p) => !(existing?.projects ?? []).includes(p),
  );
  const hasMoreSpecificProjectFilter =
    (removedProjects.length > 0 && selectedProjects.length > 0) ||
    ((existing?.projects ?? []).length === 0 && addedProjects.length > 0);

  const { refreshOrganization } = useUser();

  const { projects } = useDefinitions();

  const projectsOptions = projects.map((p) => ({
    label: p.name,
    value: p.id,
  }));

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      close={close}
      header={
        existing.id
          ? `Edit ${existing.id} Environment`
          : "Create New Environment"
      }
      submit={form.handleSubmit(async (value) => {
        const newEnvs = [...environments];

        if (existing.id) {
          const env = newEnvs.filter((e) => e.id === existing.id)[0];
          if (!env) throw new Error("Could not edit environment");
          await apiCall(`/environment/${existing.id}`, {
            method: "PUT",
            body: JSON.stringify({
              environment: {
                description: value.description,
                toggleOnList: value.toggleOnList,
                defaultState: value.defaultState,
                projects: value.projects,
              },
            }),
          });
        } else {
          if (!value.id?.match(/^[A-Za-z][A-Za-z0-9_-]*$/)) {
            throw new Error(
              "Environment id is invalid. Must start with a letter and can only contain letters, numbers, hyphens, and underscores.",
            );
          }
          if (newEnvs.find((e) => e.id === value.id)) {
            throw new Error("Environment id is already in use");
          }
          const newEnv: Environment = {
            id: value.id?.toLowerCase() || "",
            description: value.description || "",
            toggleOnList: value.toggleOnList,
            defaultState: value.defaultState,
            projects: value.projects,
            parent: value.parent,
          };
          await apiCall(`/environment`, {
            method: "POST",
            body: JSON.stringify({
              environment: newEnv,
            }),
          });
        }

        // Update environments list in UI
        await refreshOrganization();

        onSuccess();
      })}
    >
      {!existing.id && (
        <SelectField
          value={form.watch("id") || ""}
          options={DEFAULT_ENVIRONMENT_IDS.map((id) => ({
            label: id,
            value: id,
          }))}
          sort={false}
          createable
          isClearable
          formatCreateLabel={(value) =>
            `Use custom environment name "${value}"`
          }
          onChange={(value) => {
            form.setValue("id", value);
            if (!DEFAULT_ENVIRONMENT_IDS.includes(value)) {
              form.setValue("parent", undefined);
            }
          }}
          maxLength={30}
          required
          pattern="^[A-Za-z][A-Za-z0-9_-]*$"
          title="Must start with a letter. Can only contain letters, numbers, hyphens, and underscores. No spaces or special characters."
          label="Id"
          helpText={
            <>
              <div>
                Only letters, numbers, hyphens, and underscores allowed. No
                spaces.
              </div>
              <div>
                Valid examples: <code>prod</code>, <code>qa-1</code>,{" "}
                <code>john_dev</code>
              </div>
            </>
          }
        />
      )}
      <Field
        label="Description"
        {...form.register("description")}
        placeholder=""
        textarea
      />
      {!existing.id && (
        <div className="mb-3">
          <SelectField
            label="Parent"
            value={form.watch("parent") || ""}
            onChange={(value) => {
              form.setValue("parent", value || undefined);
            }}
            options={environments.map((e) => ({ label: e.id, value: e.id }))}
            isClearable
            disabled={!DEFAULT_ENVIRONMENT_IDS.includes(form.watch("id") || "")}
            helpText={
              <>
                <div>
                  Environment to inherit Feature Rules from.{" "}
                  {`Only allowed when creating one of the default environments.`}
                </div>
                <div>
                  For programmatic control of environment inheritance, use the{" "}
                  <DocLink docSection="apiPostEnvironment">
                    API endpoint instead
                  </DocLink>
                </div>
              </>
            }
          />
        </div>
      )}
      <div className="mb-4">
        <MultiSelectField
          label="Projects"
          placeholder="All Projects"
          value={form.watch("projects") || []}
          onChange={(projects) => form.setValue("projects", projects)}
          options={projectsOptions}
          sort={false}
          closeMenuOnSelect={true}
        />
        {hasMoreSpecificProjectFilter && sdkConnections.length > 0 && (
          <div className="alert alert-warning">
            <FaExclamationTriangle /> You have made the projects filter more
            restrictive than before. {sdkConnections.length} SDK Connection
            {sdkConnections.length === 1 ? "" : "s"} using this environment may
            be impacted.
          </div>
        )}
      </div>
      <Switch
        id={"defaultToggle"}
        label="Default state for new features"
        value={!!form.watch("defaultState")}
        onChange={(value) => {
          form.setValue("defaultState", value);
        }}
        mb="3"
      />
      <Switch
        id={"toggle"}
        label="Show toggle on feature list"
        value={!!form.watch("toggleOnList")}
        onChange={(value) => {
          form.setValue("toggleOnList", value);
        }}
      />
    </Modal>
  );
}
