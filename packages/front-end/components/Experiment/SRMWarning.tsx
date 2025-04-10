import { FC, useState } from "react";
import { ExperimentReportVariation } from "back-end/types/report";
import { MdInfoOutline } from "react-icons/md";
import { useUser } from "@/services/UserContext";
import { DEFAULT_SRM_THRESHOLD } from "@/pages/settings";
import track from "@/services/track";
import { pValueFormatter } from "@/services/experiments";
import Modal from "@/components/Modal";
import Tooltip from "@/components/Tooltip/Tooltip";
import { ExperimentTab } from "./TabbedPage";
import { useSnapshot } from "./SnapshotProvider";
import VariationUsersTable from "./TabbedPage/VariationUsersTable";

const NOT_ENOUGH_EVIDENCE_MESSAGE =
  "没有足够的证据提出问题。你看到的百分比不平衡可能是由于变化引起的，目前无需担心。";

const LearnMore = ({
  type,
  setOpen,
  body,
}: {
  type: "simple" | "with_modal";
  setOpen: (boolean) => void;
  body: string | JSX.Element;
}) => {
  if (type === "with_modal") {
    return (
      <a
        className="a"
        role="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        了解更多 {">"}
      </a>
    );
  } else {
    return (
      <span>
        <Tooltip body={body}>
          <span className="a">
            了解更多 <MdInfoOutline style={{ color: "#029dd1" }} />
          </span>
        </Tooltip>
      </span>
    );
  }
};

const SRMWarning: FC<{
  srm: number;
  variations?: ExperimentReportVariation[];
  users: number[];
  linkToHealthTab?: boolean;
  showWhenHealthy?: boolean;
  type?: "simple" | "with_modal";
  setTab?: (tab: ExperimentTab) => void;
  isBandit?: boolean;
}> = ({
  srm,
  linkToHealthTab,
  setTab,
  variations,
  users,
  showWhenHealthy = false,
  type = "with_modal",
  isBandit,
}) => {
    const [open, setOpen] = useState(false);
    const { settings } = useUser();
    const { snapshot } = useSnapshot();
    const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

    const srmWarningMessage = (
      <>
        触发SRM警告的阈值为 <b>{srmThreshold}</b>，本实验的p值为 <b>{pValueFormatter(srm, 4)}</b>。这强烈表明你的流量分配不平衡，存在流量分配问题。
      </>
    );

    if (typeof srm !== "number") {
      return null;
    }

    if (!showWhenHealthy && srm >= srmThreshold) {
      return null;
    }

    return (
      <>
        {type === "with_modal" && (
          <Modal
            trackingEventModalType="srm-warning"
            close={() => setOpen(false)}
            open={open}
            header={
              <div>
                <h2>Sample Ratio Mismatch (SRM)</h2>
                <p className="mb-0">
                  当实际流量分配与预期存在显著差异时，我们会提出SRM问题。
                </p>
              </div>
            }
            closeCta="关闭"
            size="lg"
          >
            <div className="mx-2">
              {srm >= srmThreshold ? (
                <>
                  <div className="alert alert-secondary">
                    {NOT_ENOUGH_EVIDENCE_MESSAGE}
                  </div>
                  {variations ? (
                    <VariationUsersTable
                      variations={variations}
                      users={users}
                      srm={srm}
                    />
                  ) : null}
                </>
              ) : (
                <>
                  <div className="alert alert-secondary">{srmWarningMessage}</div>
                  {variations ? (
                    <VariationUsersTable
                      variations={variations}
                      users={users}
                      srm={srm}
                    />
                  ) : null}
                  <p>最常见原因：</p>
                  <ul>
                    <li>
                      <b>分桶问题</b>
                      <ul>
                        <li>
                          SDK跟踪回调中事件触发异常或条件语句错误
                        </li>
                        <li>SDK属性与数据仓库ID不匹配
                        </li>
                      </ul>
                    </li>
                    <li>
                      <b>分析问题</b>
                      <ul>
                        <li>激活指标受实验变体影响
                        </li>
                        <li>过滤规则异常（如机器人移除）
                        </li>
                        <li>数据仓库数据缺失
                        </li>
                      </ul>
                    </li>
                    <li>
                      <b>实验变更问题</b>
                      <ul>
                        <li>新阶段未重新随机化（遗留偏差）
                        </li>
                        <li>未重新随机化的目标条件变更
                        </li>
                      </ul>
                    </li>
                  </ul>
                  <p>
                    <a
                      target="_blank"
                      rel="noreferrer"
                      href="https://docs.growthbook.io/kb/experiments/troubleshooting-experiments"
                    >
                      在文档中查看实验故障排除指南
                    </a>
                  </p>
                </>
              )}
            </div>
          </Modal>
        )}

        {srm >= srmThreshold ? (
          <div className="alert alert-info">
            <b>
              未检测到样本比例不匹配 (SRM)。P值高于 {srmThreshold}。{" "}
              {!isBandit && (
                <LearnMore
                  type={type}
                  setOpen={setOpen}
                  body={NOT_ENOUGH_EVIDENCE_MESSAGE}
                />
              )}
            </b>
          </div>
        ) : (
          <div className="alert alert-warning">
            <strong>
              检测到样本比例不匹配 (SRM)。P值低于 {pValueFormatter(srmThreshold)}
            </strong>
            。{" "}
            {linkToHealthTab &&
              setTab &&
              snapshot?.health?.traffic.dimension?.dim_exposure_date ? (
              <p className="mb-0">
                结果可能不可信。查看{" "}
                <a
                  className="a"
                  role="button"
                  onClick={() => {
                    track("打开健康标签页", {
                      source: "结果标签页-SRM警告",
                    });
                    setTab("health");
                  }}
                >
                  健康标签页
                </a>{" "}
                了解更多详情。
              </p>
            ) : (
              <p className="mb-0">
                实现中可能存在错误。{" "}
                <LearnMore
                  type={type}
                  setOpen={setOpen}
                  body={srmWarningMessage}
                />
              </p>
            )}
          </div>
        )}
      </>
    );
  };
export default SRMWarning;