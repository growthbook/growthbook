import Link from "next/link";
import { FaDesktop } from "react-icons/fa";
import { FiArrowRight } from "react-icons/fi";
import { HiCursorClick } from "react-icons/hi";
import usePermissions from "@/hooks/usePermissions";
import track from "@/services/track";
import { DocLink } from "../DocLink";

export default function DocumentationLinksSidebar({
  showVisualEditor = false,
}: {
  showVisualEditor?: boolean;
}) {
  const permissions = usePermissions();

  return (
    <div className="card gsbox mb-3">
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
            <Link href="/settings/team">
              <a className="boxlink">
                Invite team <FiArrowRight />
              </a>
            </Link>
          </span>
        </div>
      )}
      {showVisualEditor && permissions.check("manageEnvironments", "", []) && (
        <div className="card-body border-top">
          <div className="card-title">
            <h4 className="">Enable the Visual Editor</h4>
          </div>
          <div className="card-text mb-3">
            <div className="float-right mx-4 position-relative">
              <FaDesktop
                style={{
                  fontSize: "3.4em",
                  color: "#71B1E9",
                  stroke: "#fff",
                  strokeWidth: 3,
                }}
              />
              <HiCursorClick
                style={{
                  fontSize: "2.4em",
                  position: "absolute",
                  bottom: 3,
                  right: -3,
                  stroke: "#fff",
                  color: "#4A8AC2",
                  strokeWidth: "1px",
                }}
              />
            </div>
            Let your non-technical teammates implement A/B tests without writing
            code.
          </div>
          <span className="action-link non-active-step">
            <Link href="/settings">
              <a className="boxlink">
                Go to settings <FiArrowRight />
              </a>
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
