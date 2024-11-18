import { useForm } from "react-hook-form";
import {
  SDKAttribute,
  SDKAttributeFormat,
  SDKAttributeType,
} from "back-end/types/organization";
import { FaExclamationCircle, FaInfoCircle } from "react-icons/fa";
import React from "react";
import { useAttributeSchema } from "@/services/features";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Toggle from "@/components/Forms/Toggle";
import { useDefinitions } from "@/services/DefinitionsContext";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useUser } from "@/services/UserContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useProjectOptions from "@/hooks/useProjectOptions";
import MinSDKVersionsList from "./MinSDKVersionsList";

export interface Props {
  close: () => void;
  attribute?: string;
}

const DATA_TYPE_TO_DESCRIPTION: Record<SDKAttributeType, string> = {
  boolean: "true或false",
  number: "浮点数或整数",
  string: "自由格式文本",
  enum: "用于一小列预定义的值",
  secureString: "自由格式文本；在传递给SDK之前对值进行哈希处理",
  "number[]": "用于多个数值",
  "string[]": "用于类似‘标签’之类的事物",
  "secureString[]": "用于安全地传递多个值",
};
export default function AttributeModal({ close, attribute }: Props) {
  const { projects, project } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const { refreshOrganization } = useUser();

  const { apiCall } = useAuth();

  const schema = useAttributeSchema(true);
  const current = schema.find((s) => s.property === attribute);

  const form = useForm<SDKAttribute>({
    defaultValues: {
      property: attribute || "",
      description: current?.description || "",
      datatype: current?.datatype || "string",
      projects: attribute ? current?.projects || [] : project ? [project] : [],
      format: current?.format || "",
      enum: current?.enum || "",
      hashAttribute: !!current?.hashAttribute,
    },
  });

  const title = attribute ? `编辑属性：${attribute}` : `创建属性`;

  const datatype = form.watch("datatype");

  const hashAttributeDataTypes: SDKAttributeType[] = [
    "string",
    "number",
    "secureString",
  ];

  const permissionRequired = (project: string) => {
    return attribute
      ? permissionsUtil.canUpdateAttribute({ projects: [project] }, {})
      : permissionsUtil.canCreateAttribute({ projects: [project] });
  };

  const projectOptions = useProjectOptions(
    permissionRequired,
    form.watch("projects") || []
  );

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      close={close}
      header={title}
      cta="保存"
      submit={form.handleSubmit(async (value) => {
        if (value.datatype !== "string") {
          value.format = "";
        }
        if (value.datatype !== "enum") {
          value.enum = "";
        }
        if (!hashAttributeDataTypes.includes(value.datatype)) {
          value.hashAttribute = false;
        }

        if (
          (!attribute || (attribute && value.property !== attribute)) &&
          schema.some((s) => s.property === value.property)
        ) {
          throw new Error(
            "该属性名称已被使用，请选择另一个。"
          );
        }

        const attributeObj: SDKAttribute & { previousName?: string } = {
          property: value.property,
          datatype: value.datatype,
          description: value.description,
          projects: value.projects,
          format: value.format,
          enum: value.enum,
          hashAttribute: value.hashAttribute,
        };

        // If the attribute name is changed, we need to pass in the original name
        // as that's how we access the attribute in the backend
        if (attribute && attribute !== value.property) {
          attributeObj.previousName = attribute;
        }

        await apiCall<{
          status: number;
        }>("/attribute", {
          method: attribute ? "PUT" : "POST",
          body: JSON.stringify(attributeObj),
        });
        refreshOrganization();
      })}
    >
      <Field
        label={
          <>
            属性{" "}
            <Tooltip body={"这是在SDK中使用的属性名称"} />
          </>
        }
        required={true}
        {...form.register("property")}
      />
      {attribute && form.watch("property") !== attribute ? (
        <div className="alert alert-warning">
          更改属性名称时请小心。任何使用该属性的现有定向条件不会自动更新，仍将引用旧的属性名称。
        </div>
      ) : null}
      <div className="form-group">
        <Field
          className="form-control"
          label={
            <>
              描述 <small className="text-muted">(可选)</small>
            </>
          }
          {...form.register("description")}
          textarea={true}
        />
      </div>
      {projects?.length > 0 && (
        <div className="form-group">
          <MultiSelectField
            label={
              <>
                项目{" "}
                <Tooltip
                  body={`下面的下拉菜单已过滤，仅显示您有权限${attribute ? "更新" : "创建"}属性的项目。`}
                />
              </>
            }
            placeholder="所有项目"
            value={form.watch("projects") || []}
            options={projectOptions}
            onChange={(v) => form.setValue("projects", v)}
            customClassName="label-overflow-ellipsis"
            helpText="将此属性分配给特定项目"
          />
        </div>
      )}
      <SelectField
        label="数据类型"
        value={datatype}
        onChange={(datatype: SDKAttributeType) =>
          form.setValue("datatype", datatype)
        }
        sort={false}
        options={[
          { value: "boolean", label: "布尔型" },
          { value: "number", label: "数字型" },
          { value: "string", label: "字符串型" },
          { value: "enum", label: "枚举型" },
          { value: "secureString", label: "安全字符串型" },
          { value: "number[]", label: "数字数组型" },
          { value: "string[]", label: "字符串数组型" },
          {
            value: "secureString[]",
            label: "安全字符串数组型",
          },
        ]}
        formatOptionLabel={(value) => {
          return (
            <div className="d-flex">
              <span className="pr-2">{value.label}</span>
              <span className="ml-auto text-muted">
                {DATA_TYPE_TO_DESCRIPTION[value.value]}
              </span>
            </div>
          );
        }}
        helpText={
          <>
            {["secureString", "secureString[]"].includes(datatype) && (
              <div className="text-muted">
                <PremiumTooltip
                  commercialFeature="hash-secure-attributes"
                  tipPosition="bottom"
                  body={
                    <>
                      <p>
                        引用<code>secureString</code>属性的特性定向条件将通过SHA-256哈希进行匿名化。在公共或不安全环境（如浏览器）中评估特性标志时，哈希通过混淆提供了额外的安全层。这使您能够基于敏感属性定位用户。
                      </p>
                      <p>
                        您必须在SDK连接中启用此功能才能生效。
                      </p>
                      <p className="mb-0 text-warning-orange small">
                        <FaExclamationCircle /> 在使用不安全环境时，不要仅仅依靠哈希作为保护高度敏感数据的手段。哈希是一种混淆技术，虽然很难但并非不可能提取敏感数据。
                      </p>
                    </>
                  }
                >
                  安全属性如何工作？<FaInfoCircle />
                </PremiumTooltip>
              </div>
            )}
          </>
        }
      />
      {datatype === "string" && (
        <>
          <SelectField
            label="字符串格式"
            value={form.watch(`format`) || "none"}
            onChange={(v) => form.setValue(`format`, v as SDKAttributeFormat)}
            initialOption="None"
            options={[
              { value: "version", label: "版本字符串" },
              { value: "date", label: "日期字符串" },
              { value: "isoCountryCode", label: "ISO国家代码（2位）" },
            ]}
            sort={false}
            helpText="影响定向属性的用户界面和字符串比较逻辑。更多格式即将推出。"
          />
          {form.watch("format") === "version" && (
            <div className="alert alert-warning">
              <strong>警告：</strong> 版本字符串属性仅在{" "}
              <Tooltip
                body={<MinSDKVersionsList capability="semverTargeting" />}
              >
                <span className="text-primary">部分SDK版本</span>
              </Tooltip>
              中受支持。如果您使用的是不兼容的SDK，请不要使用此格式，因为它会破坏基于该属性的任何过滤。
            </div>
          )}
        </>
      )}
      {datatype === "enum" && (
        <Field
          label="枚举选项"
          textarea
          minRows={1}
          required
          {...form.register(`enum`)}
          helpText="Comma-separated list of all possible values"
        />
      )}
      {hashAttributeDataTypes.includes(datatype) && (
        <div className="form-group">
          <label>唯一标识符</label>
          <div className="row align-items-center">
            <div className="col-auto">
              <Toggle
                id={"hashAttributeToggle"}
                value={!!form.watch(`hashAttribute`)}
                setValue={(value) => {
                  form.setValue(`hashAttribute`, value);
                }}
              />
            </div>
            <div className="col px-0 text-muted" style={{ lineHeight: "1rem" }}>
              <div>属性可用于用户分配</div>
              <small>
                例如，<code>email</code>或<code>id</code>
              </small>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
