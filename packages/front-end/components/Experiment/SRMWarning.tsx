import { FC, useState } from "react";
import { ExperimentReportVariation } from "shared/types/report";
import { DEFAULT_SRM_THRESHOLD } from "shared/constants";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";
import { pValueFormatter } from "@/services/experiments";
import Modal from "@/components/Modal";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import { ExperimentTab } from "./TabbedPage";
import { useSnapshot } from "./SnapshotProvider";
import VariationUsersTable from "./TabbedPage/VariationUsersTable";
import { InfoTip } from "./TabbedPage/SetupFieldRow";

const NOT_ENOUGH_EVIDENCE_MESSAGE =
  "There is not enough evidence to raise an issue. Any imbalances in the percentages you see may be due to chance and aren’t cause for concern at this time.";

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

  const healthy = srm >= srmThreshold;
  if (!showWhenHealthy && healthy) {
    return null;
  }

  const showHealthLink =
    !!linkToHealthTab &&
    !!setTab &&
    !!snapshot?.health?.traffic.dimension?.dim_exposure_date;
  // The modal explains in full; a compact card's tooltip in brief.
  const learnMoreLink =
    type === "with_modal" ? (
      <Link onClick={() => setOpen(true)}>Learn more</Link>
    ) : null;
  const learnMoreTip =
    type === "simple" ? (
      <>
        {" "}
        <InfoTip
          content={healthy ? NOT_ENOUGH_EVIDENCE_MESSAGE : srmWarningMessage}
        />
      </>
    ) : null;

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

      {healthy ? (
        <Callout
          status="success"
          contentAlign="center"
          action={isBandit ? null : learnMoreLink}
        >
          No Sample Ratio Mismatch (SRM) detected: p-value above {srmThreshold}.
          {!isBandit ? learnMoreTip : null}
        </Callout>
      ) : (
        <Callout
          status="warning"
          contentAlign="center"
          action={
            showHealthLink ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  track("Open health tab", {
                    source: "results-tab-srm-warning",
                  });
                  setTab("health");
                }}
              >
                View health
              </Button>
            ) : (
              learnMoreLink
            )
          }
        >
          Sample Ratio Mismatch (SRM) detected: p-value below{" "}
          {pValueFormatter(srmThreshold)}.{" "}
          {showHealthLink
            ? "Results are likely untrustworthy."
            : "There is likely a bug in the implementation."}
          {showHealthLink ? null : learnMoreTip}
        </Callout>
      )}
    </>
  );
};
export default SRMWarning;
