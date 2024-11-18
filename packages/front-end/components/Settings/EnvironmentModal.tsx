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
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import Toggle from "@/components/Forms/Toggle";

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

  const selectedProjects = form.watch("projects") ?? [];
  const removedProjects = (existing?.projects ?? []).filter(
    (p) => !selectedProjects.includes(p)
  );
  const addedProjects = selectedProjects.filter(
    (p) => !(existing?.projects ?? []).includes(p)
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
          ? `编辑${existing.id}环境`
          : "创建新环境"
      }
      submit={form.handleSubmit(async (value) => {
        const newEnvs = [...environments];

        if (existing.id) {
          const env = newEnvs.filter((e) => e.id === existing.id)[0];
          if (!env) throw new Error("无法编辑环境");
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
              "环境ID无效。必须以字母开头，且只能包含字母、数字、连字符和下划线。"
            );
          }
          if (newEnvs.find((e) => e.id === value.id)) {
            throw new Error("环境ID已被使用");
          }
          const newEnv: Environment = {
            id: value.id?.toLowerCase() || "",
            description: value.description || "",
            toggleOnList: value.toggleOnList,
            defaultState: value.defaultState,
            projects: value.projects,
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
        <Field
          maxLength={30}
          required
          pattern="^[A-Za-z][A-Za-z0-9_-]*$"
          title="必须以字母开头。只能包含字母、数字、连字符和下划线。不能有空格或特殊字符。"
          {...form.register("id")}
          label="Id"
          helpText={
            <>
              <div>
                只允许字母、数字、连字符和下划线。不能有空格。
              </div>
              <div>
                有效示例：<code>prod</code>，<code>qa-1</code>，<code>john_dev</code>
              </div>
            </>
          }
        />
      )}
      <Field
        label="描述"
        {...form.register("description")}
        placeholder=""
        textarea
      />
      <div className="mb-4">
        <MultiSelectField
          label="项目"
          placeholder="所有项目"
          value={form.watch("projects") || []}
          onChange={(projects) => form.setValue("projects", projects)}
          options={projectsOptions}
          sort={false}
          closeMenuOnSelect={true}
        />
        {hasMoreSpecificProjectFilter && sdkConnections.length > 0 && (
          <div className="alert alert-warning">
            <FaExclamationTriangle /> 您已使项目过滤器比之前更具限制性。使用此环境的{sdkConnections.length}个SDK连接可能会受到影响。
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
        <label htmlFor="defaultToggle">新特性的默认状态</label>
      </div>
      <Toggle
        id={"toggle"}
        label="标识符"
        value={!!form.watch("toggleOnList")}
        setValue={(value) => {
          form.setValue("toggleOnList", value);
        }}
      />{" "}
      <label htmlFor="toggle">在特性列表中显示切换按钮</label>
    </Modal>
  );
}
