import { FC, useState } from "react";
import { ExperimentReportVariation } from "back-end/types/report";
import { DEFAULT_SRM_THRESHOLD } from "shared/constants";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";
import { pValueFormatter } from "@/services/experiments";
import Modal from "@/components/Modal";
import Tooltip from "@/components/Tooltip/Tooltip";
import { GBInfo } from "@/components/Icons";
import Callout from "@/ui/Callout";
import { ExperimentTab } from "./TabbedPage";
import { useSnapshot } from "./SnapshotProvider";
import VariationUsersTable from "./TabbedPage/VariationUsersTable";

const NOT_ENOUGH_EVIDENCE_MESSAGE =
  "There is not enough evidence to raise an issue. Any imbalances in the percentages you see may be due to change and aren’t cause for concern at this time.";

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
        Learn More {">"}
      </a>
    );
  } else {
    return (
      <span>
        <Tooltip body={body}>
          <span className="a">
            Learn More <GBInfo />
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
      The threshold for firing an SRM warning is <b>{srmThreshold}</b> and the
      p-value for this experiment is <b>{pValueFormatter(srm, 4)}</b>. This is a
      strong indicator that your traffic is imbalanced and there is a problem
      with your traffic assignment.
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
                When actual traffic splits are significantly different from
                expected, we raise an SRM issue.
              </p>
            </div>
          }
          closeCta="Close"
          size="lg"
        >
          <div className="mx-2">
            {srm >= srmThreshold ? (
              <>
                <Callout status="info">{NOT_ENOUGH_EVIDENCE_MESSAGE}</Callout>
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
                <Callout status="warning">{srmWarningMessage}</Callout>
                {variations ? (
                  <VariationUsersTable
                    variations={variations}
                    users={users}
                    srm={srm}
                  />
                ) : null}
                <p>Most common causes:</p>
                <ul>
                  <li>
                    <b>Bucketing</b>
                    <ul>
                      <li>
                        Broken event firing or conditional statements in SDK
                        trackingCallback
                      </li>
                      <li>Mismatch between SDK attribute and data ID</li>
                    </ul>
                  </li>
                  <li>
                    <b>Analysis</b>
                    <ul>
                      <li>Activation Metric influenced by variations</li>
                      <li>Broken filtering (e.g. bot removal)</li>
                      <li>Missing data in data warehouse</li>
                    </ul>
                  </li>
                  <li>
                    <b>Experiment Changes</b>
                    <ul>
                      <li>New phase without re-randomizing (carryover bias)</li>
                      <li>Certain targeting changes without re-randomizing </li>
                    </ul>
                  </li>
                </ul>
                <p>
                  <a
                    target="_blank"
                    rel="noreferrer"
                    href="https://docs.growthbook.io/kb/experiments/troubleshooting-experiments"
                  >
                    Read about troubleshooting experiments in our docs
                  </a>
                </p>
              </>
            )}
          </div>
        </Modal>
      )}

      {srm >= srmThreshold ? (
        <Callout status="info" contentsAs="div">
          <b>
            No Sample Ratio Mismatch (SRM) detected. P-value above{" "}
            {srmThreshold}.{" "}
            {!isBandit && (
              <LearnMore
                type={type}
                setOpen={setOpen}
                body={NOT_ENOUGH_EVIDENCE_MESSAGE}
              />
            )}
          </b>
        </Callout>
      ) : (
        <Callout status="warning" contentsAs="div">
          <strong>
            Sample Ratio Mismatch (SRM) detected. P-value below{" "}
            {pValueFormatter(srmThreshold)}
          </strong>
          .{" "}
          {linkToHealthTab &&
          setTab &&
          snapshot?.health?.traffic.dimension?.dim_exposure_date ? (
            <p className="mb-0">
              Results are likely untrustworthy. See the{" "}
              <a
                className="a"
                role="button"
                onClick={() => {
                  track("Open health tab", {
                    source: "results-tab-srm-warning",
                  });
                  setTab("health");
                }}
              >
                health tab
              </a>{" "}
              for more details.
            </p>
          ) : (
            <p className="mb-0">
              There is likely a bug in the implementation.{" "}
              <LearnMore
                type={type}
                setOpen={setOpen}
                body={srmWarningMessage}
              />
            </p>
          )}
        </Callout>
      )}
    </>
  );
};
export default SRMWarning;
