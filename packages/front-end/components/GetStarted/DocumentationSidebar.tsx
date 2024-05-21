import { PiSealQuestion } from "react-icons/pi";
import { useUser } from "@/services/UserContext";
import styles from "@/components/GetStarted/GetStarted.module.scss";
import PaidFeatureBadge from "./PaidFeatureBadge";

interface Props {
  setUpgradeModal: (open: boolean) => void;
  type: "get-started" | "features" | "experiments" | "imports";
}

const DocumentationSidebar = ({
  setUpgradeModal,
  type,
}: Props): React.ReactElement => {
  const { accountPlan } = useUser();

  const canUpgrade = accountPlan !== "enterprise";

  return (
    <div id={styles.documentationSection} className="rounded p-4">
      <h6 className="text-muted mb-3">FEATURED DOCS</h6>
      {type === "features" ? (
        <ul
          id={styles.featuredDocs}
          style={{ listStyleType: "none", padding: 0 }}
        >
          <li className="mb-2">
            <a
              href="https://docs.growthbook.io/lib/"
              target="_blank"
              rel="noreferrer"
            >
              GrowthBook SDK
            </a>
          </li>
          <li className="mb-2">
            <a
              href="https://docs.growthbook.io/features/basics"
              target="_blank"
              rel="noreferrer"
            >
              Feature Flag Basics
            </a>
          </li>
          <li className="mb-2">
            <a
              href="https://docs.growthbook.io/features/targeting"
              target="_blank"
              rel="noreferrer"
            >
              Targeting Attributes
            </a>
          </li>
          <li className="mb-2">
            <a
              href="https://docs.growthbook.io/warehouses"
              target="_blank"
              rel="noreferrer"
            >
              Connect Your Data Source
            </a>
          </li>
        </ul>
      ) : type === "experiments" ? (
        <ul
          id={styles.featuredDocs}
          style={{ listStyleType: "none", padding: 0 }}
        >
          <li className="mb-2">
            <a
              href="https://docs.growthbook.io/experiments"
              target="_blank"
              rel="noreferrer"
            >
              Running Experiments
            </a>
          </li>
          <li className="mb-2">
            <a
              href="https://docs.growthbook.io/app/sticky-bucketing"
              target="_blank"
              rel="noreferrer"
            >
              Sticky Bucketing
            </a>
            <PaidFeatureBadge type="pro" />
          </li>
          <li className="mb-2">
            <a
              href="https://docs.growthbook.io/app/visual"
              target="_blank"
              rel="noreferrer"
            >
              Visual Editor
            </a>
            <PaidFeatureBadge type="pro" />
          </li>
          <li className="mb-2">
            <a
              href="https://docs.growthbook.io/app/url-redirects"
              target="_blank"
              rel="noreferrer"
            >
              URL Redirects
            </a>
            <PaidFeatureBadge type="pro" />
          </li>
        </ul>
      ) : type === "imports" ? (
        <ul
          id={styles.featuredDocs}
          style={{ listStyleType: "none", padding: 0 }}
        >
          <li className="mb-2">
            <a
              href="https://docs.growthbook.io/warehouses"
              target="_blank"
              rel="noreferrer"
            >
              Connect to Your Data Warehouse
            </a>
          </li>
          <li className="mb-2">
            <a
              href="https://docs.growthbook.io/app/fact-tables"
              target="_blank"
              rel="noreferrer"
            >
              Fact Tables
            </a>
          </li>
          <li className="mb-2">
            <a
              href="https://docs.growthbook.io/app/data-pipeline"
              target="_blank"
              rel="noreferrer"
            >
              Data Pipeline Mode
            </a>
            <PaidFeatureBadge type="enterprise" />
          </li>
          <li className="mb-2">
            <a
              href="https://docs.growthbook.io/app/experiment-results"
              target="_blank"
              rel="noreferrer"
            >
              Experiment Results
            </a>
          </li>
        </ul>
      ) : (
        <ul
          id={styles.featuredDocs}
          style={{ listStyleType: "none", padding: 0 }}
        >
          <li className="mb-2">
            <a
              href="https://docs.growthbook.io/quick-start"
              target="_blank"
              rel="noreferrer"
            >
              QuickStart Guide
            </a>
          </li>
          <li className="mb-2">
            <a
              href="https://docs.growthbook.io/overview"
              target="_blank"
              rel="noreferrer"
            >
              How it Works
            </a>
          </li>
          <li className="mb-2">
            <a
              href="https://docs.growthbook.io/lib/"
              target="_blank"
              rel="noreferrer"
            >
              SDK Docs
            </a>
          </li>
        </ul>
      )}

      <hr />

      <h6 className="text-muted mb-3">QUESTIONS?</h6>
      <ul id={styles.questions} style={{ listStyleType: "none", padding: 0 }}>
        <li className="mb-2">
          <a
            href="https://slack.growthbook.io/?ref=getstarted"
            target="_blank"
            rel="noreferrer"
          >
            <img
              className="mr-1"
              src="/images/get-started/slack-logo.svg"
              alt="Slack Logo"
              width={"18px"}
              height={"18px"}
              style={{ margin: "1px 5px 1px 2px" }}
            />{" "}
            <span className="align-middle">GrowthBook Slack</span>
          </a>
        </li>
        <li className="mb-2">
          <a
            href="https://docs.growthbook.io/faq"
            target="_blank"
            rel="noreferrer"
          >
            <PiSealQuestion
              className="mr-1"
              style={{ width: "20px", height: "20px" }}
            />{" "}
            <span className="align-middle">GrowthBook FAQs</span>
          </a>
        </li>
      </ul>
      {canUpgrade && (
        <button
          className="btn btn-primary ml-auto w-100"
          onClick={(e) => {
            e.preventDefault();
            setUpgradeModal(true);
          }}
        >
          Upgrade
        </button>
      )}
    </div>
  );
};

export default DocumentationSidebar;
