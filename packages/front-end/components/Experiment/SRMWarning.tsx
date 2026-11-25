import { FC, useState } from "react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
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

const NOT_ENOUGH_EVIDENCE_MESSAGE = msg`There is not enough evidence to raise an issue. Any imbalances in the percentages you see may be due to chance and aren’t cause for concern at this time.`;

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
  const { t, i18n } = useLingui();
  const [open, setOpen] = useState(false);
  const { settings } = useUser();
  const { snapshot } = useSnapshot();
  const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

  const formattedSrm = pValueFormatter(srm, 4);
  const srmWarningMessage = (
    <Trans>
      The threshold for firing an SRM warning is <b>{srmThreshold}</b> and the
      p-value for this experiment is <b>{formattedSrm}</b>. This is a strong
      indicator that your traffic is imbalanced and there is a problem with your
      traffic assignment.
    </Trans>
  );

  if (typeof srm !== "number") {
    return null;
  }

  const healthy = srm >= srmThreshold;
  const formattedThreshold = pValueFormatter(srmThreshold);
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
      <Link onClick={() => setOpen(true)}>
        <Trans>Learn more</Trans>
      </Link>
    ) : null;
  const learnMoreTip =
    type === "simple" ? (
      <>
        {" "}
        <InfoTip
          content={
            healthy ? i18n._(NOT_ENOUGH_EVIDENCE_MESSAGE) : srmWarningMessage
          }
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
              <h2>
                <Trans>Sample Ratio Mismatch (SRM)</Trans>
              </h2>
              <p className="mb-0">
                <Trans>
                  When actual traffic splits are significantly different from
                  expected, we raise an SRM issue.
                </Trans>
              </p>
            </div>
          }
          closeCta={t`Close`}
          size="lg"
        >
          <div className="mx-2">
            {srm >= srmThreshold ? (
              <>
                <Callout status="info">
                  {i18n._(NOT_ENOUGH_EVIDENCE_MESSAGE)}
                </Callout>
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
                <p>
                  <Trans>Most common causes:</Trans>
                </p>
                <ul>
                  <li>
                    <b>
                      <Trans>Bucketing</Trans>
                    </b>
                    <ul>
                      <li>
                        <Trans>
                          Broken event firing or conditional statements in SDK
                          trackingCallback
                        </Trans>
                      </li>
                      <li>
                        <Trans>
                          Mismatch between SDK attribute and data ID
                        </Trans>
                      </li>
                    </ul>
                  </li>
                  <li>
                    <b>
                      <Trans>Analysis</Trans>
                    </b>
                    <ul>
                      <li>
                        <Trans>
                          Activation Metric influenced by variations
                        </Trans>
                      </li>
                      <li>
                        <Trans>Broken filtering (e.g. bot removal)</Trans>
                      </li>
                      <li>
                        <Trans>Missing data in data warehouse</Trans>
                      </li>
                    </ul>
                  </li>
                  <li>
                    <b>
                      <Trans>Experiment Changes</Trans>
                    </b>
                    <ul>
                      <li>
                        <Trans>
                          New phase without re-randomizing (carryover bias)
                        </Trans>
                      </li>
                      <li>
                        <Trans>
                          Certain targeting changes without re-randomizing
                        </Trans>{" "}
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
                    <Trans>
                      Read about troubleshooting experiments in our docs
                    </Trans>
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
          <Trans>
            No Sample Ratio Mismatch (SRM) detected: p-value above{" "}
            {srmThreshold}.
          </Trans>
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
                <Trans>View health</Trans>
              </Button>
            ) : (
              learnMoreLink
            )
          }
        >
          {showHealthLink ? (
            <Trans>
              Sample Ratio Mismatch (SRM) detected: p-value below{" "}
              {formattedThreshold}. Results are likely untrustworthy.
            </Trans>
          ) : (
            <Trans>
              Sample Ratio Mismatch (SRM) detected: p-value below{" "}
              {formattedThreshold}. There is likely a bug in the implementation.
            </Trans>
          )}
          {showHealthLink ? null : learnMoreTip}
        </Callout>
      )}
    </>
  );
};
export default SRMWarning;
