import { FC, useState } from "react";
import { ExperimentReportVariation } from "back-end/types/report";
import { FaExternalLinkAlt } from "react-icons/fa";
import { MdInfoOutline } from "react-icons/md";
import { useUser } from "@/services/UserContext";
import { DEFAULT_SRM_THRESHOLD } from "@/pages/settings";
import track from "@/services/track";
import { pValueFormatter } from "@/services/experiments";
import Modal from "../Modal";
import Tooltip from "../Tooltip/Tooltip";
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
        href="#"
        onClick={(e) => {
          e.preventDefault();
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
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
            }}
          >
            Learn More <MdInfoOutline style={{ color: "#029dd1" }} />
          </a>
        </Tooltip>
      </span>
    );
  }
};

const SRMWarning: FC<{
  srm: number;
  variations: ExperimentReportVariation[];
  users: number[];
  linkToHealthTab?: boolean;
  showWhenHealthy?: boolean;
  type?: "simple" | "with_modal";
  setTab?: (tab: ExperimentTab) => void;
}> = ({
  srm,
  linkToHealthTab,
  setTab,
  variations,
  users,
  showWhenHealthy = false,
  type = "with_modal",
}) => {
  const [open, setOpen] = useState(false);
  const { settings } = useUser();
  const { snapshot } = useSnapshot();
  const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

  const srmWarningMessage = (
    <>
      The threshold for firing an SRM warning is{" "}
      <b>{pValueFormatter(srmThreshold)}</b> and the p-value for this experiment
      is <b>{srm}</b>. This is a strong indicator that your traffic is
      imbalanced and there is a problem with your traffic assignment.
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
          closeCta="Okay"
          size="lg"
        >
          <div className="mx-2">
            {srm >= srmThreshold ? (
              <>
                <div className="alert alert-secondary">
                  {NOT_ENOUGH_EVIDENCE_MESSAGE}
                </div>
                <VariationUsersTable
                  variations={variations}
                  users={users}
                  srm={srm}
                />
              </>
            ) : (
              <>
                <div className="alert alert-secondary">{srmWarningMessage}</div>
                <VariationUsersTable
                  variations={variations}
                  users={users}
                  srm={srm}
                />
                <p>Most common causes:</p>
                <ul style={{ columnCount: 2, columnGap: "20px" }}>
                  <li>
                    <b>Bucketing</b>
                    <ul>
                      <li>Bad randomization function</li>
                      <li>Corrupted user IDs</li>
                      <li>Carry over effects from previous tests</li>
                      <li>Interaction effects</li>
                    </ul>
                  </li>
                  <li>
                    <b>Execution</b>
                    <ul>
                      <li>Different start times for variations</li>
                      <li>Variation-specific errors or crashes</li>
                      <li>Variation-specific performance issues</li>
                      <li>Broken event firing</li>
                    </ul>
                  </li>
                  <li>
                    <b>Analysis</b>
                    <ul>
                      <li>Broken filtering (e.g. bot removal)</li>
                      <li>Missing data</li>
                      <li>Wrong start date</li>
                      <li>Wrong triggering condition</li>
                    </ul>
                  </li>
                  <li>
                    <b>Interference</b>
                    <ul>
                      <li>Inconsistent ramping of variations</li>
                      <li>Pausing variations during execution</li>
                      <li>Injection attacks and hacks</li>
                    </ul>
                  </li>
                </ul>
                <p>
                  <a
                    target="_blank"
                    rel="noreferrer"
                    href="https://exp-platform.com/Documents/2019_KDDFabijanGupchupFuptaOmhoverVermeerDmitriev.pdf"
                  >
                    Read about SRM issues (PDF) <FaExternalLinkAlt />
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
            No Sample Ratio Mismatch (SRM) detected. P-value above{" "}
            {srmThreshold}
          </b>
          <div>
            <LearnMore
              type={type}
              setOpen={setOpen}
              body={NOT_ENOUGH_EVIDENCE_MESSAGE}
            />
          </div>
        </div>
      ) : (
        <div className="alert alert-warning">
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
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  track("Open health tab");
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
        </div>
      )}
    </>
  );
};
export default SRMWarning;
