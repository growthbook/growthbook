import Link from "next/link";
import { FiArrowRight } from "react-icons/fi";
import usePermissions from "@/hooks/usePermissions";
import track from "@/services/track";
import { DocLink } from "@/components/DocLink";

export default function DocumentationLinksSidebar() {
  const permissions = usePermissions();

  return (
    <div className="appbox p-4 mb-3">
      <div className="card-body">
        <div className="card-title">
          <h4 className="">Documentation, help &amp; support</h4>
        </div>
        <div className="card-text">
          <div className="d-flex flex-row">
            <div className="p-1 w-100">
              Read our{" "}
              <DocLink docSection="user_guide" className="font-weight-bold">
                User Guide
              </DocLink>
            </div>
          </div>
          <div className="d-flex flex-row">
            <div className="p-1 w-100">
              Watch a quick{" "}
              <a
                href="https://youtu.be/1ASe3K46BEw"
                target="_blank"
                rel="noreferrer"
                onClick={() => {
                  track("Watch Video Tour", {
                    source: "onboarding",
                  });
                }}
              >
                <strong>Video&nbsp;Tour</strong>
              </a>
            </div>
          </div>
          <div className="d-flex flex-row">
            <div className="p-1 w-100">
              View docs for our{" "}
              <DocLink docSection="sdks" className="font-weight-bold">
                SDKs
              </DocLink>
            </div>
          </div>
          <div className="d-flex flex-row">
            <div className="p-1 w-100">
              Chat with us on{" "}
              <a
                target="_blank"
                rel="noreferrer"
                href="https://slack.growthbook.io?ref=app-getstarted"
              >
                <strong>Slack</strong>
              </a>
            </div>
          </div>
          <div className="d-flex flex-row">
            <div className="p-1 w-100">
              Open an issue on{" "}
              <a
                target="_blank"
                rel="noreferrer"
                href="https://github.com/growthbook/growthbook/issues"
              >
                <strong>GitHub</strong>
              </a>
            </div>
          </div>
        </div>
      </div>
      {permissions.manageTeam && (
        <div className="card-body border-top">
          <div className="card-title">
            <h4 className="">Invite team</h4>
          </div>
          <p className="card-text">Add teammates to your account</p>
          <span className="action-link non-active-step">
            <Link href="/settings/team" className="boxlink">
              Invite team
              <FiArrowRight />
            </Link>
          </span>
        </div>
      )}
      <div className="card-body border-top">
        <div className="card-title">
          <h4 className="">Have questions?</h4>
        </div>
        Talk to us in our{" "}
        <a
          target="_blank"
          rel="noreferrer"
          href="https://slack.growthbook.io?ref=app-havequestions"
        >
          <strong>Slack channel</strong>
        </a>
      </div>
    </div>
  );
}
