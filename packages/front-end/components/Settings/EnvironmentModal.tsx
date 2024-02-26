import { useForm } from "react-hook-form";
import { Environment } from "back-end/types/organization";
import React, { useMemo } from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import { useEnvironments } from "@/services/features";
import { useUser } from "@/services/UserContext";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import useSDKConnections from "@/hooks/useSDKConnections";
import Modal from "../Modal";
import Field from "../Forms/Field";
import Toggle from "../Forms/Toggle";

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

  const projectsChanged =
    existing.id !== undefined &&
    JSON.stringify((existing?.projects ?? []).sort()) !==
      JSON.stringify(form.watch("projects").sort());

  const { refreshOrganization } = useUser();

  const { projects } = useDefinitions();

  const projectsOptions = projects.map((p) => ({
    label: p.name,
    value: p.id,
  }));

  return (
    <Modal
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
          env.description = value.description;
          env.toggleOnList = value.toggleOnList;
          env.defaultState = value.defaultState;
          env.projects = value.projects;
        } else {
          // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
          if (!value.id.match(/^[A-Za-z][A-Za-z0-9_-]*$/)) {
            throw new Error(
              "Environment id is invalid. Must start with a letter and can only contain letters, numbers, hyphens, and underscores."
            );
          }
          if (newEnvs.find((e) => e.id === value.id)) {
            throw new Error("Environment id is already in use");
          }
          newEnvs.push({
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            id: value.id.toLowerCase(),
            description: value.description,
            toggleOnList: value.toggleOnList,
            defaultState: value.defaultState,
            projects: value.projects,
          });
        }

        // Add/edit environment
        await apiCall(`/organization`, {
          method: "PUT",
          body: JSON.stringify({
            settings: {
              environments: newEnvs,
            },
          }),
        });

        // Update environments list in UI
        await refreshOrganization();

        // Create API key for environment if it doesn't exist yet
        await apiCall(`/keys?preferExisting=true`, {
          method: "POST",
          body: JSON.stringify({
            description: `${value.id} SDK Key`,
            environment: value.id,
          }),
        });

        await onSuccess();
      })}
    >
      {!existing.id && (
        <Field
          maxLength={30}
          required
          pattern="^[A-Za-z][A-Za-z0-9_-]*$"
          title="Must start with a letter. Can only contain letters, numbers, hyphens, and underscores. No spaces or special characters."
          {...form.register("id")}
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
        {projectsChanged && sdkConnections.length > 0 && (
          <div className="alert alert-warning">
            <FaExclamationTriangle /> There{" "}
            {sdkConnections.length === 1 ? "is" : "are"} {sdkConnections.length}{" "}
            SDK connections using this environment. Altering the projects
            associated may affect any existing integrations.
          </div>
        )}
      </div>
      <div className="mb-3">
        <Toggle
          id={"defaultToggle"}
          label="Identifier"
          value={!!form.watch("defaultState")}
          setValue={(value) => {
            form.setValue("defaultState", value);
          }}
        />{" "}
        <label htmlFor="defaultToggle">Default state for new features</label>
      </div>
      <Toggle
        id={"toggle"}
        label="Identifier"
        value={!!form.watch("toggleOnList")}
        setValue={(value) => {
          form.setValue("toggleOnList", value);
        }}
      />{" "}
      <label htmlFor="toggle">Show toggle on feature list </label>
    </Modal>
  );
}
