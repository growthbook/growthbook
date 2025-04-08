import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import { FaCheck, FaExclamationTriangle } from "react-icons/fa";
import { PiPencilSimple, PiPlay, PiXCircle } from "react-icons/pi";
import LinkedChange from "@/components/Experiment/LinkedChange";
import Tooltip from "@/components/Tooltip/Tooltip";
import ForceSummary from "@/components/Features/ForceSummary";

// 组件属性类型定义
type Props = {
  info: LinkedFeatureInfo;
  experiment: ExperimentInterfaceStringDates;
  open?: boolean;
};

// 关联功能标志组件
export default function LinkedFeatureFlag({ info, experiment, open }: Props) {
  // 按顺序获取实验变体对应的值
  const orderedValues = experiment.variations.map((v) => {
    return info.values.find((v2) => v2.variationId === v.id)?.value || "";
  });

  return (
    <LinkedChange
      changeType={"flag"}
      feature={info.feature}
      additionalBadge={
        // 如果状态为草稿
        info.state === "draft" ? (
          <span className="rounded-pill px-2 badge-secondary ml-3">
            <PiPencilSimple /> 草稿
          </span>
        ) : // 如果状态为锁定
          info.state === "locked" ? (
            <span className="rounded-pill px-2 badge-danger ml-3">
              <PiXCircle /> 已移除
            </span>
          ) : // 如果状态为已上线
            info.state === "live" ? (
              <span className="rounded-pill px-2 badge-success ml-3">
                <PiPlay /> 已上线
              </span>
            ) : null
      }
      open={open ?? experiment.status === "draft"}
    >
      <div className="mt-2 pb-1 px-3">
        {/* 如果状态不是锁定 */}
        {info.state !== "locked" && (
          <div className="mb-3">
            <div className="font-weight-bold">环境</div>
            {Object.entries(info.environmentStates || {}).map(
              ([env, state]) => (
                <Tooltip
                  body={
                    // 如果状态为活跃
                    state === "active"
                      ? "此实验在这个环境中处于活跃状态"
                      : // 如果状态为环境禁用
                      state === "disabled-env"
                        ? "此功能的这个环境已被禁用，所以实验不处于活跃状态"
                        : // 如果状态为规则禁用
                        state === "disabled-rule"
                          ? "此实验在这个环境中已被禁用，不处于活跃状态"
                          : "此实验在这个环境中不存在"
                  }
                  key={env}
                >
                  <span
                    className={`badge ${
                      // 如果状态为缺失
                      state === "missing"
                        ? "badge-secondary"
                        : // 如果状态为活跃
                        state === "active"
                          ? "badge-primary"
                          : "badge-warning"
                      } mr-2`}
                  >
                    {state === "active" ? (
                      <FaCheck />
                    ) : (
                      <FaExclamationTriangle />
                    )}{" "}
                    {env}
                  </span>
                </Tooltip>
              )
            )}
          </div>
        )}

        <div className="font-weight-bold mb-2">功能值</div>
        <table className="table table-sm table-bordered w-auto">
          <tbody>
            {orderedValues.map((v, j) => (
              <tr key={j}>
                <td
                  className={`px-3 variation with-variation-label with-variation-right-shadow border-right-0 variation${j}`}
                >
                  <span className="name font-weight-bold">
                    {j}: {experiment.variations[j]?.name}
                  </span>
                </td>
                <td className="px-3 border-left-0">
                  <ForceSummary value={v} feature={info.feature} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* 如果状态为已上线或草稿 */}
        {(info.state === "live" || info.state === "draft") && (
          <>
            {/* 如果存在不一致的值 */}
            {info.inconsistentValues && (
              <div className="alert alert-warning mt-2">
                <strong>警告:</strong> 此实验以不同的值被多次包含。以上的值来自于 <strong>{info.valuesFrom}</strong> 中第一个匹配的实验。
              </div>
            )}

            {/* 如果存在更高优先级的规则 */}
            {info.rulesAbove && (
              <div className="alert alert-info mt-2">
                <strong>注意:</strong> 在此实验之上存在一些功能规则，所以部分用户可能不会被包含在内。
              </div>
            )}
          </>
        )}
      </div>
    </LinkedChange>
  );
}