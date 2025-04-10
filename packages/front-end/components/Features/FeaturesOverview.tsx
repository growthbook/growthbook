import { useRouter } from "next/router";
import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import React, { useEffect, useMemo, useState } from "react";
import {
  FaDraftingCompass,
  FaExchangeAlt,
  FaExclamationTriangle,
  FaLink,
  FaList,
  FaLock,
  FaTimes,
} from "react-icons/fa";
import { ago, datetime } from "shared/dates";
import {
  autoMerge,
  checkIfRevisionNeedsReview,
  evaluatePrerequisiteState,
  filterEnvironmentsByFeature,
  getValidation,
  mergeResultHasChanges,
  PrerequisiteStateResult,
} from "shared/util";
import { MdHistory, MdRocketLaunch } from "react-icons/md";
import { BiHide, BiShow } from "react-icons/bi";
import { FaPlusMinus } from "react-icons/fa6";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import clsx from "clsx";
import Link from "next/link";
import { BsClock } from "react-icons/bs";
import { PiCheckCircleFill, PiCircleDuotone, PiFileX } from "react-icons/pi";
import { GBAddCircle, GBEdit } from "@/components/Icons";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useAuth } from "@/services/auth";
import RuleModal from "@/components/Features/RuleModal/index";
import ForceSummary from "@/components/Features/ForceSummary";
import RuleList from "@/components/Features/RuleList";
import track from "@/services/track";
import EditDefaultValueModal from "@/components/Features/EditDefaultValueModal";
import EnvironmentToggle from "@/components/Features/EnvironmentToggle";
import EditProjectForm from "@/components/Experiment/EditProjectForm";
import EditTagsForm from "@/components/Tags/EditTagsForm";
import ControlledTabs from "@/components/Tabs/ControlledTabs";
import {
  getFeatureDefaultValue,
  getRules,
  useEnvironmentState,
  useEnvironments,
  getAffectedRevisionEnvs,
  getPrerequisites,
  useFeaturesList,
} from "@/services/features";
import AssignmentTester from "@/components/Archetype/AssignmentTester";
import Tab from "@/components/Tabs/Tab";
import Modal from "@/components/Modal";
import DraftModal from "@/components/Features/DraftModal";
import RevisionDropdown from "@/components/Features/RevisionDropdown";
import DiscussionThread from "@/components/DiscussionThread";
import EditOwnerModal from "@/components/Owner/EditOwnerModal";
import Tooltip from "@/components/Tooltip/Tooltip";
import EditSchemaModal from "@/components/Features/EditSchemaModal";
import Code from "@/components/SyntaxHighlighting/Code";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import EventUser from "@/components/Avatar/EventUser";
import RevertModal from "@/components/Features/RevertModal";
import EditRevisionCommentModal from "@/components/Features/EditRevisionCommentModal";
import FixConflictsModal from "@/components/Features/FixConflictsModal";
import Revisionlog from "@/components/Features/RevisionLog";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { SimpleTooltip } from "@/components/SimpleTooltip/SimpleTooltip";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CopyRuleModal from "@/components/Features/CopyRuleModal";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import Button from "@/components/Radix/Button";
import MarkdownInlineEdit from "@/components/Markdown/MarkdownInlineEdit";
import PrerequisiteStatusRow, {
  PrerequisiteStatesCols,
} from "./PrerequisiteStatusRow";
import { PrerequisiteAlerts } from "./PrerequisiteTargetingField";
import PrerequisiteModal from "./PrerequisiteModal";
import RequestReviewModal from "./RequestReviewModal";
import JSONSchemaDescription from "./JSONSchemaDescription";

export default function FeaturesOverview({
  baseFeature,
  feature,
  revision,
  revisions,
  experiments,
  mutate,
  editProjectModal,
  setEditProjectModal,
  editTagsModal,
  setEditTagsModal,
  editOwnerModal,
  setEditOwnerModal,
  version,
  setVersion,
  dependents,
  dependentFeatures,
  dependentExperiments,
}: {
  baseFeature: FeatureInterface;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface | null;
  revisions: FeatureRevisionInterface[];
  experiments: ExperimentInterfaceStringDates[] | undefined;
  mutate: () => Promise<unknown>;
  editProjectModal: boolean;
  setEditProjectModal: (b: boolean) => void;
  editTagsModal: boolean;
  setEditTagsModal: (b: boolean) => void;
  editOwnerModal: boolean;
  setEditOwnerModal: (b: boolean) => void;
  version: number | null;
  setVersion: (v: number) => void;
  dependents: number;
  dependentFeatures: string[];
  dependentExperiments: ExperimentInterfaceStringDates[];
}) {
  const router = useRouter();
  const { fid } = router.query;

  const settings = useOrgSettings();
  const [edit, setEdit] = useState(false);
  const [editValidator, setEditValidator] = useState(false);
  const [showSchema, setShowSchema] = useState(false);
  const [draftModal, setDraftModal] = useState(false);
  const [reviewModal, setReviewModal] = useState(false);
  const [conflictModal, setConflictModal] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [logModal, setLogModal] = useState(false);
  const [prerequisiteModal, setPrerequisiteModal] = useState<{
    i: number;
  } | null>(null);
  const [showDependents, setShowDependents] = useState(false);
  const permissionsUtil = usePermissionsUtil();

  const [revertIndex, setRevertIndex] = useState(0);

  const [env, setEnv] = useEnvironmentState();

  const [ruleModal, setRuleModal] = useState<{
    i: number;
    environment: string;
    defaultType?: string;
  } | null>(null);
  const [copyRuleModal, setCopyRuleModal] = useState<{
    environment: string;
    rules: FeatureRule[];
  } | null>(null);
  const [editCommentModel, setEditCommentModal] = useState(false);

  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();

  const { features } = useFeaturesList(false);
  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const envs = environments.map((e) => e.id);

  // Make sure you can't access an invalid env tab, since active env tab is persisted via localStorage
  useEffect(() => {
    if (!envs?.length) return;
    if (!envs.includes(env)) {
      setEnv(envs[0]);
    }
  }, [envs, env, setEnv]);

  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 800,
  });

  const experimentsMap = useMemo(() => {
    if (!experiments) return new Map();

    return new Map<string, ExperimentInterfaceStringDates>(
      experiments.map((exp) => [exp.id, exp])
    );
  }, [experiments]);

  const mergeResult = useMemo(() => {
    if (!feature || !revision) return null;
    const baseRevision = revisions.find(
      (r) => r.version === revision?.baseVersion
    );
    const liveRevision = revisions.find((r) => r.version === feature.version);
    if (!revision || !baseRevision || !liveRevision) return null;
    return autoMerge(
      liveRevision,
      baseRevision,
      revision,
      environments.map((e) => e.id),
      {}
    );
  }, [revisions, revision, feature, environments]);

  const prerequisites = feature?.prerequisites || [];
  const envsStr = JSON.stringify(envs);

  const prereqStates = useMemo(
    () => {
      if (!feature) return null;
      const states: Record<string, PrerequisiteStateResult> = {};
      const featuresMap = new Map(features.map((f) => [f.id, f]));
      envs.forEach((env) => {
        states[env] = evaluatePrerequisiteState(
          feature,
          featuresMap,
          env,
          true
        );
      });
      return states;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feature, features, envsStr]
  );

  if (!baseFeature || !feature || !revision) {
    return <LoadingOverlay />;
  }

  const hasConditionalState =
    prereqStates &&
    Object.values(prereqStates).some((s) => s.state === "conditional");

  const hasPrerequisitesCommercialFeature = hasCommercialFeature(
    "prerequisites"
  );

  const currentVersion = version || baseFeature.version;

  const { jsonSchema, validationEnabled, schemaDateUpdated } = getValidation(
    feature
  );
  const baseVersion = revision?.baseVersion || feature.version;
  const baseRevision = revisions.find((r) => r.version === baseVersion);
  let requireReviews = false;
  //dont require review when we cant find a base version to compare
  if (baseRevision) {
    requireReviews = checkIfRevisionNeedsReview({
      feature,
      baseRevision,
      revision,
      allEnvironments: environments.map((e) => e.id),
      settings,
    });
  }
  const isLive = revision?.version === feature.version;
  const isPendingReview =
    revision?.status === "pending-review" ||
    revision?.status === "changes-requested";
  const approved = revision?.status === "approved";

  const isDraft = revision?.status === "draft" || isPendingReview || approved;

  const revisionHasChanges =
    !!mergeResult && mergeResultHasChanges(mergeResult);

  const hasJsonValidator = hasCommercialFeature("json-validation");

  const projectId = feature.project;

  const hasDraftPublishPermission =
    (approved &&
      permissionsUtil.canPublishFeature(
        feature,
        getAffectedRevisionEnvs(feature, revision, environments)
      )) ||
    (isDraft &&
      !requireReviews &&
      permissionsUtil.canPublishFeature(
        feature,
        getAffectedRevisionEnvs(feature, revision, environments)
      ));

  const drafts = revisions.filter(
    (r) =>
      r.status === "draft" ||
      r.status === "pending-review" ||
      r.status === "changes-requested" ||
      r.status === "approved"
  );
  const isLocked =
    (revision.status === "published" || revision.status === "discarded") &&
    (!isLive || drafts.length > 0);

  const canEdit = permissionsUtil.canViewFeatureModal(projectId);
  const canEditDrafts = permissionsUtil.canManageFeatureDrafts(feature);

  const variables = {
    featureKey: feature.id,
    featureType: feature.valueType,
    tags: feature.tags || [],
  };

  const renderStatusCopy = () => {
    switch (revision.status) {
      case "approved":
        return (
          <span className="mr-3">
            <PiCheckCircleFill className="text-success  mr-1" /> 通过
          </span>
        );
      case "pending-review":
        return (
          <span className="mr-3">
            <PiCircleDuotone className="text-warning  mr-1" /> 暂停审阅
          </span>
        );
      case "changes-requested":
        return (
          <span className="mr-3">
            <PiFileX className="text-danger mr-1" />
            修改请求
          </span>
        );
      default:
        return;
    }
  };
  const renderDraftBannerCopy = () => {
    if (isPendingReview) {
      return (
        <>
          <BsClock /> 审阅通过
        </>
      );
    }
    if (approved) {
      return (
        <>
          <MdRocketLaunch /> 审阅发布
        </>
      );
    }
    return (
      <>
        <MdRocketLaunch /> Request Approval to Publish
      </>
    );
  };

  return (
    <>
      <div className="contents container-fluid pagecontents mt-2">
        <h2 className="mb-3">Overview</h2>

        <div className="box">
          <div
            className="mh-350px fade-mask-vertical-1rem px-4 py-3"
            style={{ overflowY: "auto" }}
          >
            <MarkdownInlineEdit
              value={feature.description || ""}
              save={async (description) => {
                await apiCall(`/feature/${feature.id}`, {
                  method: "PUT",
                  body: JSON.stringify({
                    description,
                  }),
                });
                track("Update Feature Description");
                mutate();
              }}
              canCreate={canEdit}
              canEdit={canEdit}
              label="description"
              header="Description"
              headerClassName="h4"
              containerClassName="mb-1"
            />
          </div>
        </div>

        <div className="mt-3">
          <CustomMarkdown page={"feature"} variables={variables} />
        </div>
        <h3 className="mt-4 mb-3">启用环境</h3>
        <div className="appbox mt-2 mb-4 px-4 pt-3 pb-3">
          <div className="mb-2">
            当禁用时，此功能将计算为 <code>null</code>。默认值和规则将被忽略。
          </div>
          {prerequisites.length > 0 ? (
            <table className="table border bg-white mb-2 w-100">
              <thead>
                <tr className="bg-light">
                  <th
                    className="pl-3 align-bottom font-weight-bold border-right"
                    style={{ minWidth: 350 }}
                  />
                  {envs.map((env) => (
                    <th
                      key={env}
                      className="text-center align-bottom font-weight-bolder"
                      style={{ minWidth: 120 }}
                    >
                      {env}
                    </th>
                  ))}
                  {envs.length === 0 ? (
                    <th className="text-center align-bottom">
                      <span className="font-italic">无环境</span>
                      <Tooltip
                        className="ml-1"
                        popperClassName="text-left font-weight-normal"
                        body={
                          <>
                            <div className="text-warning-orange mb-2">
                              <FaExclamationTriangle /> 此Feature没有关联的环境
                            </div>
                            <div>
                              请确保此Feature所属的项目至少包含在一个环境中以使用它。
                            </div>
                          </>
                        }
                      />
                      <div
                        className="float-right small position-relative"
                        style={{ top: 5 }}
                      >
                        <Link href="/environments">管理环境</Link>
                      </div>
                    </th>
                  ) : (
                    <th className="w-100" />
                  )}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td
                    className="pl-3 align-bottom font-weight-bold border-right"
                    style={{ minWidth: 350 }}
                  >
                    终止开关
                  </td>
                  {envs.map((env) => (
                    <td
                      key={env}
                      className="text-center align-bottom pb-2"
                      style={{ minWidth: 120 }}
                    >
                      <EnvironmentToggle
                        feature={feature}
                        environment={env}
                        mutate={() => {
                          mutate();
                        }}
                        id={`${env}_toggle`}
                        className="mr-0"
                      />
                    </td>
                  ))}
                  <td className="w-100" />
                </tr>
                {prerequisites.map(({ ...item }, i) => {
                  const parentFeature = features.find((f) => f.id === item.id);
                  return (
                    <PrerequisiteStatusRow
                      key={i}
                      i={i}
                      feature={feature}
                      features={features}
                      parentFeature={parentFeature}
                      prerequisite={item}
                      environments={environments}
                      mutate={mutate}
                      setPrerequisiteModal={setPrerequisiteModal}
                    />
                  );
                })}
              </tbody>
              <tbody>
                <tr className="bg-light">
                  <td className="pl-3 font-weight-bold border-right">
                    摘要
                  </td>
                  {envs.length > 0 && (
                    <PrerequisiteStatesCols
                      prereqStates={prereqStates ?? undefined}
                      envs={envs}
                      isSummaryRow={true}
                    />
                  )}
                  <td />
                </tr>
              </tbody>
            </table>
          ) : (
            <div className="row mt-3">
              {environments.length > 0 ? (
                environments.map((en) => (
                  <div className="col-auto" key={en.id}>
                    <label
                      className="font-weight-bold mr-2 mb-0"
                      htmlFor={`${en.id}_toggle`}
                    >
                      {en.id}:{" "}
                    </label>
                    <EnvironmentToggle
                      feature={feature}
                      environment={en.id}
                      mutate={() => {
                        mutate();
                      }}
                      id={`${en.id}_toggle`}
                    />
                  </div>
                ))
              ) : (
                <div className="alert alert-warning pt-3 pb-2 w-100">
                  <div className="h4 mb-3">
                    <FaExclamationTriangle /> 此Feature没有关联的环境
                  </div>
                  <div className="mb-2">
                    请确保此Feature所属的项目至少包含在一个环境中以使用它。{" "}
                    <Link href="/environments">管理环境</Link>
                  </div>
                </div>
              )}
            </div>
          )}

          {hasConditionalState && (
            <PrerequisiteAlerts
              environments={envs}
              type="feature"
              project={projectId ?? ""}
            />
          )}

          {/* {canEdit && (
            <PremiumTooltip
              commercialFeature="prerequisites"
              className="d-inline-flex align-items-center mt-3"
            >
              <button
                className="btn d-inline-block px-1 font-weight-bold link-purple"
                disabled={!hasPrerequisitesCommercialFeature}
                onClick={() => {
                  setPrerequisiteModal({
                    i: getPrerequisites(feature).length,
                  });
                  track("Viewed prerequisite feature modal", {
                    source: "add-prerequisite",
                  });
                }}
              >
                <span className="h4 pr-2 m-0 d-inline-block align-top">
                  <GBAddCircle />
                </span>
                Add Prerequisite Feature
              </button>
            </PremiumTooltip>
          )} */}
        </div>
        {dependents > 0 && (
          <div className="appbox mt-2 mb-4 px-4 pt-3 pb-3">
            <h4>
              依赖项
              <div
                className="ml-2 d-inline-block badge-warning font-weight-bold text-center"
                style={{
                  width: 24,
                  height: 24,
                  lineHeight: "24px",
                  fontSize: "14px",
                  borderRadius: 30,
                }}
              >
                {dependents}
              </div>
            </h4>
            <div className="mb-2">
              {dependents === 1
                ? `另一个${dependentFeatures.length ? "Feature" : "实验"}将此Feature作为先决条件。修改当前Feature可能会影响其行为。`
                : `其他${dependentFeatures.length
                  ? dependentExperiments.length
                    ? "Feature和实验"
                    : "Feature"
                  : "实验"}将此Feature作为先决条件。修改当前Feature可能会影响它们的行为。`}
            </div>
            <hr className="mb-2" />
            {showDependents ? (
              <div className="mt-3">
                {dependentFeatures.length > 0 && (
                  <>
                    <label>依赖的Features</label>
                    <ul className="pl-4">
                      {dependentFeatures.map((fid, i) => (
                        <li className="my-1" key={i}>
                          <a
                            href={`/features/${fid}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {fid}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {dependentExperiments.length > 0 && (
                  <>
                    <label>依赖的实验</label>
                    <ul className="pl-4">
                      {dependentExperiments.map((exp, i) => (
                        <li className="my-1" key={i}>
                          <a
                            href={`/experiment/${exp.id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {exp.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <a
                  role="button"
                  className="d-inline-block a link-purple mt-1"
                  onClick={() => setShowDependents(false)}
                >
                  <BiHide /> 隐藏详情
                </a>
              </div>
            ) : (
              <>
                <a
                  role="button"
                  className="d-inline-block a link-purple"
                  onClick={() => setShowDependents(true)}
                >
                  <BiShow /> 显示详情
                </a>
              </>
            )}
          </div>
        )}

        {feature.valueType === "json" && (
          <div>
            <h3>
              JSON 验证{" "}
              <Tooltip
                body={
                  "通过使用 JSON 模式或我们的简单验证构建器指定验证规则，防止拼写错误和失误"
                }
              />
              <span
                className="badge badge-dark ml-2"
                style={{ fontStyle: "normal", fontSize: "0.7em" }}
              >
                企业版
              </span>
            </h3>
            <div className="appbox mb-4 p-3 card">
              {hasJsonValidator && jsonSchema ? (
                <>
                  <div className="d-flex align-items-center">
                    <strong>
                      {validationEnabled ? "已启用" : "已禁用"}
                    </strong>

                    {schemaDateUpdated && (
                      <div className="text-muted ml-3">
                        更新于{" "}
                        {schemaDateUpdated ? ago(schemaDateUpdated) : ""}
                      </div>
                    )}

                    {validationEnabled ? (
                      <div className="ml-auto">
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            setShowSchema(!showSchema);
                          }}
                        >
                          <small>
                            {showSchema
                              ? "隐藏 JSON 模式"
                              : "显示 JSON 模式"}
                          </small>
                        </a>
                      </div>
                    ) : null}
                  </div>
                  {validationEnabled ? (
                    <JSONSchemaDescription jsonSchema={jsonSchema} />
                  ) : null}
                  {showSchema && validationEnabled && (
                    <div className="mt-4">
                      <Code
                        language="json"
                        code={JSON.stringify(jsonSchema, null, 2)}
                      />
                    </div>
                  )}
                </>
              ) : (
                <div>
                  <em>未添加验证。</em>
                </div>
              )}

              {hasJsonValidator && canEdit && (
                <div className="mt-3">
                  <a
                    href="#"
                    className="text-purple"
                    onClick={(e) => {
                      e.preventDefault();
                      setEditValidator(true);
                    }}
                  >
                    {validationEnabled ? <GBEdit /> : <GBAddCircle />}{" "}
                    {validationEnabled ? "编辑" : "新增"} JSON 验证
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        {revision && (
          <>
            <div className="row mb-2 align-items-center">
              <div className="col-auto">
                <h3 className="mb-0">规则和值</h3>
              </div>
              <div className="col-auto">
                <RevisionDropdown
                  feature={feature}
                  version={currentVersion}
                  setVersion={setVersion}
                  revisions={revisions || []}
                />
              </div>
              <div className="col-auto">
                <a
                  title="复制此版本的链接"
                  href={`/features/${fid}?v=${version}`}
                  className="position-relative"
                  onClick={(e) => {
                    if (!copySupported) return;

                    e.preventDefault();
                    const url =
                      window.location.href.replace(/[?#].*/, "") +
                      `?v=${version}`;
                    performCopy(url);
                  }}
                >
                  <FaLink />
                  {copySuccess ? (
                    <SimpleTooltip position="right">
                      已复制到剪贴板！
                    </SimpleTooltip>
                  ) : null}
                </a>
              </div>
            </div>
            {isLive ? (
              <div
                className="px-3 py-2 alert alert-success mb-0"
                style={{
                  borderBottomLeftRadius: 0,
                  borderBottomRightRadius: 0,
                }}
              >
                <div className="d-flex align-items-center">
                  <strong className="mr-3">
                    <MdRocketLaunch /> 实时版本
                  </strong>
                  <div className="mr-3">
                    {!isLocked ? (
                      "您在下面所做的更改将启动一个新的草稿"
                    ) : (
                      <>
                        已经有一个活跃的草稿。切换到该草稿进行更改。
                      </>
                    )}
                  </div>
                  <div className="ml-auto"></div>
                  {canEditDrafts && drafts.length > 0 && (
                    <div>
                      <a
                        role="button"
                        className="a font-weight-bold link-purple"
                        onClick={(e) => {
                          e.preventDefault();
                          setVersion(drafts[0].version);
                        }}
                      >
                        <FaExchangeAlt /> 切换到草稿
                      </a>
                    </div>
                  )}
                  {canEditDrafts && revision.version > 1 && (
                    <div className="ml-4">
                      <a
                        href="#"
                        className="font-weight-bold text-danger"
                        onClick={(e) => {
                          e.preventDefault();

                          // Get highest revision number that is published and less than the current revision
                          const previousRevision = revisions
                            .filter(
                              (r) =>
                                r.status === "published" &&
                                r.version < feature.version
                            )
                            .sort((a, b) => b.version - a.version)[0];

                          if (previousRevision) {
                            setRevertIndex(previousRevision.version);
                          }
                        }}
                      >
                        <MdHistory /> 恢复到上一版本
                      </a>
                    </div>
                  )}
                </div>
              </div>
            ) : isLocked ? (
              <div
                className="px-3 py-2 alert-secondary mb-0"
                style={{
                  borderBottomLeftRadius: 0,
                  borderBottomRightRadius: 0,
                }}
              >
                <div className="d-flex align-items-center">
                  <strong className="mr-3">
                    <FaLock /> 版本已锁定
                  </strong>
                  <div className="mr-2">
                    此版本不再活跃，无法修改。
                  </div>
                  <div className="ml-auto"></div>
                  {canEditDrafts && (
                    <div>
                      <a
                        role="button"
                        className="a font-weight-bold link-purple"
                        onClick={(e) => {
                          e.preventDefault();
                          setRevertIndex(revision.version);
                        }}
                        title="基于此版本创建一个新的草稿"
                      >
                        <MdHistory /> 恢复到此版本
                      </a>
                    </div>
                  )}
                </div>
              </div>
            ) : isDraft ? (
              <div
                className="px-3 py-2 alert alert-warning mb-0"
                style={{
                  borderBottomLeftRadius: 0,
                  borderBottomRightRadius: 0,
                }}
              >
                <div className="d-flex align-items-center">
                  <strong className="mr-3">
                    <FaDraftingCompass /> 草稿版本
                  </strong>
                  <div className="mr-3">
                    {requireReviews
                      ? "在下方进行修改，准备好后请求审核"
                      : "在下方进行修改，准备好后发布"}
                  </div>
                  <div className="ml-auto"></div>
                  {mergeResult?.success && requireReviews && (
                    <div>
                      <Tooltip
                        body={
                          !revisionHasChanges
                            ? "草稿与实时版本完全相同。修改后再请求审核"
                            : ""
                        }
                      >
                        <a
                          href="#"
                          className={clsx(
                            "font-weight-bold",
                            !revisionHasChanges ? "text-muted" : "text-purple"
                          )}
                          onClick={(e) => {
                            e.preventDefault();
                            setReviewModal(true);
                          }}
                        >
                          {renderDraftBannerCopy()}
                        </a>
                      </Tooltip>
                    </div>
                  )}
                  {mergeResult?.success && !requireReviews && (
                    <div>
                      <Tooltip
                        body={
                          !revisionHasChanges
                            ? "草稿与实时版本完全相同。修改后再发布"
                            : !hasDraftPublishPermission
                              ? "你没有权限发布此草稿。"
                              : ""
                        }
                      >
                        <a
                          role="button"
                          className={clsx(
                            "a font-weight-bold",
                            !hasDraftPublishPermission || !revisionHasChanges
                              ? "text-muted"
                              : "link-purple"
                          )}
                          onClick={(e) => {
                            e.preventDefault();
                            setDraftModal(true);
                          }}
                        >
                          <MdRocketLaunch /> 审核并发布
                        </a>
                      </Tooltip>
                    </div>
                  )}
                  {canEditDrafts && mergeResult && !mergeResult.success && (
                    <div>
                      <Tooltip body="自草稿创建以来已有新的冲突变更发布，发布前必须解决冲突">
                        <a
                          role="button"
                          className="a font-weight-bold link-purple"
                          onClick={(e) => {
                            e.preventDefault();
                            setConflictModal(true);
                          }}
                        >
                          <FaPlusMinus /> 解决冲突
                        </a>
                      </Tooltip>
                    </div>
                  )}
                  {canEditDrafts && (
                    <div className="ml-4">
                      <a
                        href="#"
                        className="font-weight-bold text-danger"
                        onClick={(e) => {
                          e.preventDefault();
                          setConfirmDiscard(true);
                        }}
                      >
                        <FaTimes /> 放弃草稿
                      </a>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </>
        )}
        <div
          className={revision ? "appbox mb-4 px-3 pt-3" : ""}
          style={{
            borderTopRightRadius: 0,
            borderTopLeftRadius: 0,
          }}
        >
          {revision && (
            <div className="row mb-3">
              <div className="col-auto">
                <span className="text-muted">版本由</span>{" "}
                <EventUser user={revision.createdBy} display="name" />{" "}
                <span className="text-muted">on</span>{" "}
                {datetime(revision.dateCreated)}
              </div>
              <div className="col-auto">
                <span className="text-muted">版本注释:</span>{" "}
                {revision.comment || <em>无</em>}
                {canEditDrafts && (
                  <a
                    href="#"
                    className="ml-1"
                    onClick={(e) => {
                      e.preventDefault();
                      setEditCommentModal(true);
                    }}
                  >
                    <GBEdit />
                  </a>
                )}
              </div>
              <div className="ml-auto"></div>
              {revision.status === "published" && revision.datePublished && (
                <div className="col-auto">
                  <span className="text-muted">发布于</span>{" "}
                  {datetime(revision.datePublished)}
                </div>
              )}
              {revision.status === "draft" && (
                <div className="col-auto">
                  <span className="text-muted">最后更新</span>{" "}
                  {ago(revision.dateUpdated)}
                </div>
              )}
              <div className="col-auto">
                {renderStatusCopy()}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setLogModal(true);
                  }}
                >
                  <FaList /> 查看日志
                </a>
              </div>
            </div>
          )}

          <h3>
            默认值
            {canEdit && !isLocked && canEditDrafts && (
              <a className="ml-2 cursor-pointer" onClick={() => setEdit(true)}>
                <GBEdit />
              </a>
            )}
          </h3>
          <div className="appbox mb-4 p-3">
            <ForceSummary
              value={getFeatureDefaultValue(feature)}
              feature={feature}
            />
          </div>

          {environments.length > 0 && (
            <>
              <h3>规则</h3>
              <p>
                在功能之上添加强大逻辑。匹配的第一条规则将被应用并覆盖默认值。
              </p>

              <div className="mb-0">
                <ControlledTabs
                  setActive={(v) => {
                    setEnv(v || "");
                  }}
                  active={env}
                  showActiveCount={true}
                  newStyle={false}
                  buttonsClassName="px-3 py-2 h4"
                >
                  {environments.map((e) => {
                    const rules = getRules(feature, e.id);
                    return (
                      <Tab
                        key={e.id}
                        id={e.id}
                        display={e.id}
                        count={rules.length}
                        padding={false}
                      >
                        <div className="mb-4 border border-top-0">
                          {rules.length > 0 ? (
                            <RuleList
                              environment={e.id}
                              feature={feature}
                              mutate={mutate}
                              setRuleModal={setRuleModal}
                              setCopyRuleModal={setCopyRuleModal}
                              version={currentVersion}
                              setVersion={setVersion}
                              locked={isLocked}
                              experimentsMap={experimentsMap}
                            />
                          ) : (
                            <div className="p-3 bg-white border-bottom">
                              <em>此环境暂无规则</em>
                            </div>
                          )}

                          {canEditDrafts && !isLocked && (
                            <div className="p-3 d-flex align-items-center">
                              <h5 className="ml-0 mb-0">向 {env} 添加规则</h5>
                              <div className="flex-1" />
                              <Button
                                onClick={() => {
                                  setRuleModal({
                                    environment: env,
                                    i: getRules(feature, env).length,
                                  });
                                  track("Viewed Rule Modal", {
                                    source: "add-rule",
                                    type: "force",
                                  });
                                }}
                              >
                                添加规则
                              </Button>
                            </div>
                          )}
                        </div>
                      </Tab>
                    );
                  })}
                </ControlledTabs>
              </div>
            </>
          )}
        </div>

        {environments.length > 0 && (
          <div className="mb-4">
            <h3>测试功能规则</h3>
            <AssignmentTester
              feature={feature}
              version={currentVersion}
              project={feature.project}
            />
          </div>
        )}

        <div className="mb-4">
          <h3>评论</h3>
          <DiscussionThread
            type="feature"
            id={feature.id}
            projects={feature.project ? [feature.project] : []}
          />
        </div>

        {/* Modals */}

        {edit && (
          <EditDefaultValueModal
            close={() => setEdit(false)}
            feature={feature}
            mutate={mutate}
            version={currentVersion}
            setVersion={setVersion}
          />
        )}
        {editOwnerModal && (
          <EditOwnerModal
            cancel={() => setEditOwnerModal(false)}
            owner={feature.owner}
            save={async (owner) => {
              await apiCall(`/feature/${feature.id}`, {
                method: "PUT",
                body: JSON.stringify({ owner }),
              });
            }}
            mutate={mutate}
          />
        )}
        {editValidator && (
          <EditSchemaModal
            close={() => setEditValidator(false)}
            feature={feature}
            mutate={mutate}
          />
        )}
        {ruleModal !== null && (
          <RuleModal
            feature={feature}
            close={() => setRuleModal(null)}
            i={ruleModal.i}
            environment={ruleModal.environment}
            mutate={mutate}
            defaultType={ruleModal.defaultType || ""}
            version={currentVersion}
            setVersion={setVersion}
            revisions={revisions}
          />
        )}
        {copyRuleModal !== null && (
          <CopyRuleModal
            feature={feature}
            environment={copyRuleModal.environment}
            version={currentVersion}
            setVersion={setVersion}
            rules={copyRuleModal.rules}
            cancel={() => setCopyRuleModal(null)}
            mutate={mutate}
          />
        )}
        {editProjectModal && (
          <EditProjectForm
            label={
              <>
                项目{" "}
                <Tooltip
                  body={
                    "下方的下拉列表已过滤，仅包含您有权限更新功能的项目"
                  }
                />
              </>
            }
            permissionRequired={(project) =>
              permissionsUtil.canUpdateFeature({ project }, {})
            }
            apiEndpoint={`/feature/${feature.id}`}
            cancel={() => setEditProjectModal(false)}
            mutate={mutate}
            method="PUT"
            current={feature.project}
            additionalMessage={
              <div className="alert alert-danger">
                更改项目可能会导致此Feature开关和任何关联的实验无法发送给用户。
              </div>
            }
          />
        )}
        {revertIndex > 0 && (
          <RevertModal
            close={() => setRevertIndex(0)}
            feature={baseFeature}
            revision={
              revisions.find(
                (r) => r.version === revertIndex
              ) as FeatureRevisionInterface
            }
            mutate={mutate}
            setVersion={setVersion}
          />
        )}
        {logModal && revision && (
          <Modal
            trackingEventModalType=""
            open={true}
            close={() => setLogModal(false)}
            header="版本日志"
            closeCta={"关闭"}
            size="lg"
          >
            <h3>版本 {revision.version}</h3>
            <Revisionlog feature={feature} revision={revision} />
          </Modal>
        )}
        {editTagsModal && (
          <EditTagsForm
            tags={feature.tags || []}
            save={async (tags) => {
              await apiCall(`/feature/${feature.id}`, {
                method: "PUT",
                body: JSON.stringify({ tags }),
              });
            }}
            cancel={() => setEditTagsModal(false)}
            mutate={mutate}
          />
        )}
        {reviewModal && revision && (
          <RequestReviewModal
            feature={baseFeature}
            revisions={revisions}
            version={revision.version}
            close={() => setReviewModal(false)}
            mutate={mutate}
            onDiscard={() => {
              // When discarding a draft, switch back to the live version
              setVersion(feature.version);
            }}
          />
        )}
        {draftModal && revision && (
          <DraftModal
            feature={baseFeature}
            revisions={revisions}
            version={revision.version}
            close={() => setDraftModal(false)}
            mutate={mutate}
            onDiscard={() => {
              // When discarding a draft, switch back to the live version
              setVersion(feature.version);
            }}
          />
        )}
        {conflictModal && revision && (
          <FixConflictsModal
            feature={baseFeature}
            revisions={revisions}
            version={revision.version}
            close={() => setConflictModal(false)}
            mutate={mutate}
          />
        )}
        {confirmDiscard && (
          <Modal
            trackingEventModalType=""
            open={true}
            close={() => setConfirmDiscard(false)}
            header="放弃草稿"
            cta={"放弃"}
            submitColor="danger"
            closeCta={"取消"}
            submit={async () => {
              try {
                await apiCall(
                  `/feature/${feature.id}/${revision.version}/discard`,
                  {
                    method: "POST",
                  }
                );
              } catch (e) {
                await mutate();
                throw e;
              }
              await mutate();
              setVersion(feature.version);
            }}
          >
            <p>
              您确定要放弃此草稿吗？此操作无法撤销。
            </p>
          </Modal>
        )}
        {editCommentModel && revision && (
          <EditRevisionCommentModal
            close={() => setEditCommentModal(false)}
            feature={feature}
            mutate={mutate}
            revision={revision}
          />
        )}
        {prerequisiteModal !== null && (
          <PrerequisiteModal
            feature={feature}
            close={() => setPrerequisiteModal(null)}
            i={prerequisiteModal.i}
            mutate={mutate}
            revisions={revisions}
            version={currentVersion}
          />
        )}
      </div>
    </>
  );
}
