import { MdInfoOutline } from "react-icons/md";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import Tooltip from "@/components/Tooltip/Tooltip";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import { formatTrafficSplit } from "@/services/utils";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import { HashVersionTooltip } from "@/components/Experiment/HashVersionSelector";
import useOrgSettings from "@/hooks/useOrgSettings";

export interface Props {
  phaseIndex?: number | null;
  experiment: ExperimentInterfaceStringDates;
  editTargeting?: (() => void) | null;
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function TrafficAndTargeting({
  phaseIndex = null,
  experiment,
  editTargeting,
}: Props) {
  const { namespaces } = useOrgSettings();

  const phase = experiment.phases?.[phaseIndex ?? experiment.phases.length - 1];
  const hasNamespace = phase?.namespace && phase.namespace.enabled;
  const namespaceRange = hasNamespace
    ? phase.namespace.range[1] - phase.namespace.range[0]
    : 1;
  const namespaceName = hasNamespace
    ? namespaces?.find((n) => n.name === phase.namespace.name)?.label ||
    phase.namespace.name
    : "";

  const isBandit = experiment.type === "multi-armed-bandit";

  return (
    <>
      {phase ? (
        <>
          <div className="box p-4 my-4">
            <div className="d-flex flex-row align-items-center justify-content-between text-dark mb-4">
              <h4 className="m-0">流量分配</h4>
              <div className="flex-1" />
              {editTargeting &&
                !(isBandit && experiment.status === "running") ? (
                <button className="btn p-0 link-purple" onClick={editTargeting}>
                  <span className="text-purple">编辑</span>
                </button>
              ) : null}
            </div>

            <div className="row">
              <div className="col-4">
                <div className="h5">流量</div>
                <div>
                  包含{Math.floor(phase.coverage * 100)}%
                  {experiment.type !== "multi-armed-bandit" && (
                    <>, 按照{formatTrafficSplit(phase.variationWeights, 2)} 的比例划分</>
                  )}
                </div>
              </div>

              <div className="col-4">
                <div className="h5">
                  分配属性
                  {experiment.fallbackAttribute ? "s" : ""}{" "}
                  <Tooltip
                    popperStyle={{ lineHeight: 1.5 }}
                    body="该用户属性将用于分配变体。通常这要么是已登录用户的ID，要么是存储在长期存在的Cookie中的匿名ID。"
                  >
                    <MdInfoOutline className="text-info" />
                  </Tooltip>
                </div>
                <div>
                  {experiment.hashAttribute || "id"}
                  {experiment.fallbackAttribute ? (
                    <>, {experiment.fallbackAttribute} </>
                  ) : (
                    " "
                  )}
                  {
                    <HashVersionTooltip>
                      <small className="text-muted ml-1">
                        (V{experiment.hashVersion || 2} 哈希)
                      </small>
                    </HashVersionTooltip>
                  }
                </div>
                {experiment.disableStickyBucketing ? (
                  <div className="mt-1">
                    粘性分桶：<em>已禁用</em>
                  </div>
                ) : null}
              </div>

              <div className="col-4">
                <div className="h5">
                  命名空间{" "}
                  <Tooltip
                    popperStyle={{ lineHeight: 1.5 }}
                    body="使用命名空间来运行相互排斥的实验。在SDK配置→命名空间下管理命名空间。"
                  >
                    <MdInfoOutline className="text-info" />
                  </Tooltip>
                </div>
                <div>
                  {hasNamespace ? (
                    <>
                      {namespaceName}{" "}
                      <span className="text-muted">
                        ({percentFormatter.format(namespaceRange)})
                      </span>
                    </>
                  ) : (
                    <em>全局（所有用户）</em>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="box p-4 my-4">
            <div className="d-flex flex-row align-items-center justify-content-between text-dark mb-4">
              <h4 className="m-0">目标定位</h4>
              <div className="flex-1" />
              {editTargeting &&
                !(isBandit && experiment.status === "running") ? (
                <button className="btn p-0 link-purple" onClick={editTargeting}>
                  <span className="text-purple">编辑</span>
                </button>
              ) : null}
            </div>

            <div className="row">
              <div className="col-4">
                <div className="h5">属性目标定位</div>
                <div>
                  {phase.condition && phase.condition !== "{}" ? (
                    <ConditionDisplay condition={phase.condition} />
                  ) : (
                    <em>无</em>
                  )}
                </div>
              </div>

              <div className="col-4">
                <div className="h5">保存组目标定位</div>
                <div>
                  {phase.savedGroups?.length ? (
                    <SavedGroupTargetingDisplay
                      savedGroups={phase.savedGroups}
                    />
                  ) : (
                    <em>无</em>
                  )}
                </div>
              </div>

              <div className="col-4">
                <div className="h5">先决条件目标定位</div>
                <div>
                  {phase.prerequisites?.length ? (
                    <ConditionDisplay prerequisites={phase.prerequisites} />
                  ) : (
                    <em>无</em>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="alert alert-warning my-4">
          <FaExclamationTriangle className="mr-1" />
          尚未配置流量分配或目标定位。请为此实验添加一个阶段。
        </div>
      )}
    </>
  );
}
