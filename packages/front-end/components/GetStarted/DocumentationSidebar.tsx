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
            <a href="https://docs.growthbook.io/lib/">GrowthBook SDK</a>
          </li>
          <li className="mb-2">
            <a href="https://docs.growthbook.io/features/basics">
              Feature Flag Basics
            </a>
          </li>
          <li className="mb-2">
            <a href="https://docs.growthbook.io/features/targeting">
              Targeting Attributes
            </a>
          </li>
          <li className="mb-2">
            <a href="https://docs.growthbook.io/warehouses">
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
            <a href="https://docs.growthbook.io/experiments">
              Running Experiments
            </a>
          </li>
          <li className="mb-2">
            <a href="https://docs.growthbook.io/app/sticky-bucketing">
              Sticky Bucketing
            </a>
            <PaidFeatureBadge type="pro" />
          </li>
          <li className="mb-2">
            <a href="https://docs.growthbook.io/app/visual">Visual Editor</a>
            <PaidFeatureBadge type="pro" />
          </li>
          <li className="mb-2">
            <a href="https://docs.growthbook.io/app/url-redirects">
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
            <a href="https://docs.growthbook.io/warehouses">
              Connect to Your Data Warehouse
            </a>
          </li>
          <li className="mb-2">
            <a href="https://docs.growthbook.io/app/fact-tables">Fact Tables</a>
          </li>
          <li className="mb-2">
            <a href="https://docs.growthbook.io/app/data-pipeline">
              Data Pipeline Mode
            </a>
            <PaidFeatureBadge type="enterprise" />
          </li>
          <li className="mb-2">
            <a href="https://docs.growthbook.io/app/experiment-results">
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
            <a href="https://docs.growthbook.io/quick-start">
              QuickStart Guide
            </a>
          </li>
          <li className="mb-2">
            <a href="https://docs.growthbook.io/overview">How it Works</a>
          </li>
          <li className="mb-2">
            <a href="https://docs.growthbook.io/lib/">SDK Docs</a>
          </li>
        </ul>
      )}

      <hr />

      <h6 className="text-muted mb-3">QUESTIONS?</h6>
      <ul id={styles.questions} style={{ listStyleType: "none", padding: 0 }}>
        <li className="mb-2">
          <a href="https://slack.growthbook.io/?ref=community-page">
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
          <a href="https://docs.growthbook.io/faq">
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
