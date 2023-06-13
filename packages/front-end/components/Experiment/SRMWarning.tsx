import { FC, useState } from "react";
import { formatTrafficSplit } from "@/services/utils";
import Modal from "../Modal";

export const SRM_THRESHOLD = 0.001;

const SRMWarning: FC<{
  srm: number;
  expected: number[];
  observed: number[];
}> = ({ srm, expected, observed }) => {
  const [open, setOpen] = useState(false);

  if (typeof srm !== "number" || srm >= SRM_THRESHOLD) {
    return null;
  }

  srm = parseFloat(srm.toFixed(8));

  return (
    <>
      <Modal
        close={() => setOpen(false)}
        open={open}
        header="Sample Ratio Mismatch (SRM)"
        closeCta="Close"
        size="lg"
      >
        <p>
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
        </p>
        <p>
          This is a very strong indication that something is fishy with the
          results. Below are the most common causes:
        </p>
        <ul>
          <li>
            Bucketing
            <ul>
              <li>Bad randomization function</li>
              <li>Corrupted user IDs</li>
              <li>Carry over effects from previous tests</li>
              <li>Interaction effects</li>
            </ul>
          </li>
          <li>
            Execution
            <ul>
              <li>Different start times for variations</li>
              <li>Variation-specific errors or crashes</li>
              <li>Variation-specific performance issues</li>
              <li>Broken event firing</li>
            </ul>
          </li>
          <li>
            Analysis
            <ul>
              <li>Broken filtering (e.g. bot removal)</li>
              <li>Missing data</li>
              <li>Wrong start date</li>
              <li>Wrong triggering condition</li>
            </ul>
          </li>
          <li>
            Interference
            <ul>
              <li>Inconsistent ramping of variations</li>
              <li>Pausing variations during execution</li>
              <li>Injection attacks and hacks</li>
            </ul>
          </li>
        </ul>
        <p>
          If you are interested, there is a detailed write-up of common SRM
          issues at{" "}
          <a
            target="_blank"
            rel="noreferrer"
            href="https://exp-platform.com/Documents/2019_KDDFabijanGupchupFuptaOmhoverVermeerDmitriev.pdf"
          >
            https://exp-platform.com/Documents/2019_KDDFabijanGupchupFuptaOmhoverVermeerDmitriev.pdf
          </a>
        </p>
      </Modal>
      <div className="alert alert-danger">
        <strong>Warning: Sample Ratio Mismatch (SRM) detected</strong>. We
        expected a <code>{formatTrafficSplit(expected, 1)}</code> split, but
        observed a <code>{formatTrafficSplit(observed, 1)}</code> split (p-value
        = <code>{srm}</code>). There is likely a bug in the implementation.{" "}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setOpen(true);
          }}
        >
          Learn More
        </a>
      </div>
    </>
  );
};
export default SRMWarning;
