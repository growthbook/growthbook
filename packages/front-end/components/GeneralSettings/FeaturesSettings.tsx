import { isEqual } from "lodash";
import { useEffect, useState } from "react";
import { useFormContext } from "react-hook-form";
import { FaExclamationCircle, FaQuestionCircle } from "react-icons/fa";
import { useUser } from "@/services/UserContext";
import Field from "@/components/Forms/Field";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Toggle from "@/components/Forms/Toggle";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useEnvironments } from "@/services/features";
import { useDefinitions } from "@/services/DefinitionsContext";

export default function FeaturesSettings() {
  const [
    codeRefsBranchesToFilterStr,
    setCodeRefsBranchesToFilterStr,
  ] = useState<string>("");

  const { hasCommercialFeature } = useUser();
  const environments = useEnvironments();
  const form = useFormContext();
  const { projects } = useDefinitions();

  const hasSecureAttributesFeature = hasCommercialFeature("hash-secure-attributes");
  const hasRequireApprovals = hasCommercialFeature("require-approvals");

  const hasCodeReferencesFeature = hasCommercialFeature("code-references");

  useEffect(() => {
    if (!form) return;

    const branches = codeRefsBranchesToFilterStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (isEqual(branches, form.watch("codeRefsBranchesToFilter"))) return;

    form.setValue(
      "codeRefsBranchesToFilter",
      codeRefsBranchesToFilterStr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }, [form, codeRefsBranchesToFilterStr]);

  return (
    <div className="row">
      <div className="col-sm-3">
        <h4>功能设置</h4>
      </div>
      <div className="col-sm-9">
        {/* <div className="form-inline">
          <Field
            label={
              <PremiumTooltip
                commercialFeature="hash-secure-attributes"
                body={
                  <>
                    <p>
                      引用 <code>secureString</code> 属性的功能定向条件将通过SHA - 256哈希进行匿名化处理。在公共或不安全环境（如浏览器）中评估功能标记时，哈希通过混淆提供了额外的安全层。这使您能够基于敏感属性定位用户。
                    </p>
                    <p>
                      您必须在SDK连接中启用此功能，它才能生效。
                    </p>
                    <p>
                      您可以向哈希算法添加一个加密盐字符串（您自行选择的随机字符串），这有助于防范哈希查找漏洞。
                    </p>
                    <p className="mb-0 text-warning-orange small">
                      <FaExclamationCircle /> 在使用不安全环境时，不要仅仅依赖哈希作为保护高度敏感数据的手段。哈希是一种混淆技术，它使得提取敏感数据非常困难，但并非不可能。
                    </p>
                  </>
                }
              >
                安全属性的盐字符串 <FaQuestionCircle />
              </PremiumTooltip>
            }
            disabled={!hasSecureAttributesFeature}
            className="ml-2"
            containerClassName="mb-3"
            type="string"
            {...form.register("secureAttributeSalt")}
          />
        </div> */}
        <div>
          <label htmlFor="featureKeyExample">
            功能键示例（可选）
          </label>
          <Field
            id="featureKeyExample"
            {...form.register("featureKeyExample")}
            placeholder="我的feature"
          />
          <p>
            <small className="text-muted mb-3">
              创建新功能时，将显示此示例。只允许使用字母、数字以及字符 _、-、.、: 和 | 。不允许有空格。
            </small>
          </p>
        </div>
        <div>
          <label htmlFor="featureRegexValidator">
            功能键正则验证器（可选）
          </label>
          <Field
            id="featureRegexValidator"
            {...form.register("featureRegexValidator")}
            placeholder=""
          />
          <p>
            <small className="text-muted mb-3">
              使用创建功能模态框时，它将根据此正则表达式验证功能键。这不会阻止通过API创建功能，并且在一些公司用于强制实施命名约定。
            </small>
          </p>
        </div>
        <div>
          <label className="mr-1" htmlFor="toggle-killswitchConfirmation">
            更改环境关闭开关时需要确认
          </label>
        </div>
        <div>
          <Toggle
            id="toggle-killswitchConfirmation"
            value={!!form.watch("killswitchConfirmation")}
            setValue={(value) => {
              form.setValue("killswitchConfirmation", value);
            }}
          />
        </div>
        {hasRequireApprovals && (
          <>
            <div className="d-inline-block h4 mt-5 mb-2">审批流程</div>
            {form.watch("requireReviews")?.map?.((requireReviews, i) => (
              <div className="appbox py-2 px-3" key={`approval-flow-${i}`}>
                <label
                  className="mr-1 mt-3 d-block"
                  htmlFor={`toggle-require-reviews-${i}`}
                >
                  发布更改需要审批
                </label>
                <div>
                  <Toggle
                    id={`toggle-require-reviews-${i}`}
                    value={!!form.watch(`requireReviews.${i}.requireReviewOn`)}
                    setValue={(value) => {
                      form.setValue(
                        `requireReviews.${i}.requireReviewOn`,
                        value
                      );
                    }}
                  />
                </div>

                {!!form.watch(`requireReviews.${i}.requireReviewOn`) && (
                  <div className="mt-3">
                    <label htmlFor={`projects-${i}`} className="h5">
                      项目
                    </label>
                    <MultiSelectField
                      id={`projects-${i}`}
                      value={form.watch(`requireReviews.${i}.projects`) || []}
                      onChange={(projects) => {
                        form.setValue(`requireReviews.${i}.projects`, projects);
                      }}
                      options={projects.map((e) => {
                        return {
                          value: e.id,
                          label: e.name,
                        };
                      })}
                      placeholder="所有项目"
                    />
                    <label htmlFor={`environments-${i}`} className="h5 mt-3">
                      环境
                    </label>
                    <MultiSelectField
                      id={`environments-${i}`}
                      value={
                        form.watch(`requireReviews.${i}.environments`) || []
                      }
                      onChange={(environments) => {
                        form.setValue(
                          `requireReviews.${i}.environments`,
                          environments
                        );
                      }}
                      options={environments.map((e) => {
                        return {
                          value: e.id,
                          label: e.id,
                        };
                      })}
                      placeholder="所有环境"
                    />
                    <label
                      className="d-block mt-3 h5"
                      htmlFor={`toggle-reset-review-on-change-${i}`}
                    >
                      更改时重置审核
                    </label>
                    <Toggle
                      id={`toggle-reset-review-on-change-${i}`}
                      value={
                        !!form.watch(`requireReviews.${i}.resetReviewOnChange`)
                      }
                      setValue={(value) => {
                        form.setValue(
                          `requireReviews.${i}.resetReviewOnChange`,
                          value
                        );
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
          </>
        )}
        {/* <div className="my-3">
          <PremiumTooltip commercialFeature="code-references">
            <div
              className="d-inline-block h4 mt-4 mb-0"
              id="configure-code-refs"
            >
              配置代码引用
            </div>
          </PremiumTooltip>
          <div>
            <label className="mr-1" htmlFor="toggle-codeReferences">
              在GrowthBook用户界面中启用显示功能标记的代码引用
            </label>
          </div>
          <div className="my-2">
            <Toggle
              id="toggle-codeReferences"
              value={!!form.watch("codeReferencesEnabled")}
              setValue={(value) => {
                form.setValue("codeReferencesEnabled", value);
              }}
              disabled={!hasCodeReferencesFeature}
            />
          </div>
          {form.watch("codeReferencesEnabled") ? (
            <>
              <div className="my-4">
                <h4>代码引用设置</h4>
                <div className="appbox my-4 p-3">
                  <div className="row">
                    <div className="col-sm-9">
                      <strong>对于GitHub用户</strong>
                      <p className="my-2">
                        使用我们的一站式GitHub操作将GrowthBook集成到您的持续集成工作流程中。
                      </p>
                    </div>
                    <div className="col-sm-3 text-right">
                      <a
                        href="https://github.com/marketplace/actions/growthbook-code-references"
                        target="_blank"
                        rel="noreferrer"
                      >
                        设置
                      </a>
                    </div>
                  </div>
                </div>

                <div className="appbox my-4 p-3">
                  <div className="row">
                    <div className="col-sm-9">
                      <strong>对于非GitHub用户</strong>
                      <p className="my-2">
                        使用我们的命令行工具，它接收功能键列表并扫描您的代码库，以提供代码引用的JSON输出，您可以将其提供给我们的代码引用{" "}
                        <a
                          href="https://docs.growthbook.io/api#tag/code-references"
                          target="_blank"
                          rel="noreferrer"
                        >
                          REST API端点
                        </a>.
                      </p>
                    </div>
                    <div className="col-sm-3 text-right">
                      <a
                        href="https://github.com/growthbook/gb-find-code-refs"
                        target="_blank"
                        rel="noreferrer"
                      >
                        命令行工具
                      </a>{" "}
                      |{" "}
                      <a
                        href="https://hub.docker.com/r/growthbook/gb-find-code-refs"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Docker镜像
                      </a>
                    </div>
                  </div>
                </div>
              </div>
              <div className="my-4">
                <strong>
                  仅显示以下分支的代码引用（逗号分隔，可选）：
                </strong>
                <Field
                  className="my-2"
                  type="text"
                  placeholder="main, qa, dev"
                  value={codeRefsBranchesToFilterStr}
                  onChange={(v) => {
                    const branches = v.currentTarget.value;
                    setCodeRefsBranchesToFilterStr(branches);
                  }}
                />
              </div>

              <div className="my-4">
                <strong>平台（用于允许直接链接，可选）：</strong>
                <div className="d-flex">
                  <SelectField
                    className="my-2"
                    value={form.watch("codeRefsPlatformUrl") || ""}
                    isClearable
                    options={[
                      {
                        label: "GitHub",
                        value: "https://github.com",
                      },
                      {
                        label: "GitLab",
                        value: "https://gitlab.com",
                      },
                    ]}
                    onChange={(v: string) => {
                      if (!v) form.setValue("codeRefsPlatformUrl", "");
                      else form.setValue("codeRefsPlatformUrl", v);
                    }}
                  />
                </div>
              </div>
            </>
          ) : null}
        </div> */}
      </div>
    </div>
  );
}