import { FC, useState } from "react";
import { ExperimentReportVariation } from "back-end/types/report";
import { useUser } from "@/services/UserContext";
import { DEFAULT_SRM_THRESHOLD } from "@/pages/settings";
import track from "@/services/track";
import { pValueFormatter } from "@/services/experiments";
import Modal from "../Modal";
import { ExperimentTab } from "./TabbedPage";
import { useSnapshot } from "./SnapshotProvider";
import VariationUsersTable from "./TabbedPage/VariationUsersTable";

const SRMWarning: FC<{
  srm: number;
  variations: ExperimentReportVariation[];
  users: number[];
  linkToHealthTab?: boolean;
  setTab?: (tab: ExperimentTab) => void;
}> = ({ srm, linkToHealthTab, setTab, variations, users }) => {
  const [open, setOpen] = useState(false);
  const { settings } = useUser();
  const { snapshot } = useSnapshot();
  const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

  if (typeof srm !== "number" || srm >= srmThreshold) {
    return null;
  }

  return (
    <>
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
          <div className="alert alert-secondary">
            The threshold for firing an SRM warning is{" "}
            <b>{pValueFormatter(srmThreshold)}</b> and the p-value for this
            experiment is <b>{pValueFormatter(srm)}</b>. This is a strong
            indicator that your traffic is imbalanced and there is a problem
            with your traffic assignment.
          </div>
          <VariationUsersTable
            variations={variations}
            users={users}
            srm={srm.toString()}
          />
          {/* <p>
          SRM happens when the actual traffic split is different from what you
          expect.
        </p>
        <p>
          For this test, the p-value of the SRM check is <code>{srm}</code>.
          {srm > 0 ? (
            <span>
              That means there&apos;s only a{" "}
              <strong>1 in {Math.floor(1 / srm)}</strong> chance the observed
              traffic split happened by random chance.
            </span>
          ) : (
            ""
          )}
        </p> */}
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
              Read about SRM issues (PDF)
            </a>
          </p>
        </div>
      </Modal>
      <div className="alert alert-warning">
        <strong>
          Sample Ratio Mismatch (SRM) detected. Expected p-value ={" "}
          {pValueFormatter(srmThreshold)}
        </strong>
        .{" "}
        {linkToHealthTab &&
        setTab &&
        snapshot?.health?.traffic.dimension?.dim_exposure_date ? (
          <>
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
          </>
        ) : (
          <p>
            {/* We expected a <code>{formatTrafficSplit(expected, 1)}</code> split,
            but observed a{" "}
            <code>
              {formatTrafficSplit(
                observed,
                getSRMNeededPrecisionP1(observed, expected)
              )}
            </code>{" "}
            split (p-value = <code>{srm}</code>). There is likely a bug in the
            implementation.{" "} */}
            There is likely a bug in the implementation.{" "}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setOpen(true);
              }}
            >
              Learn More {">"}
            </a>
          </p>
        )}
      </div>
    </>
  );
};
export default SRMWarning;
