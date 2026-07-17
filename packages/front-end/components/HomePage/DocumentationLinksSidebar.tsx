import NextLink from "next/link";
import { FiArrowRight } from "react-icons/fi";
import usePermissions from "@/hooks/usePermissions";
import track from "@/services/track";
import { DocLink } from "@/components/DocLink";
import Link from "@/ui/Link";

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
              <DocLink
                useRadix={false}
                docSection="user_guide"
                className="font-weight-bold"
              >
                User Guide
              </DocLink>
            </div>
          </div>
          <div className="d-flex flex-row">
            <div className="p-1 w-100">
              Watch a quick{" "}
              <Link
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
              </Link>
            </div>
          </div>
          <div className="d-flex flex-row">
            <div className="p-1 w-100">
              View docs for our{" "}
              <DocLink
                useRadix={false}
                docSection="sdks"
                className="font-weight-bold"
              >
                SDKs
              </DocLink>
            </div>
          </div>
          <div className="d-flex flex-row">
            <div className="p-1 w-100">
              Chat with us on{" "}
              <Link
                target="_blank"
                rel="noreferrer"
                href="https://slack.growthbook.io?ref=app-getstarted"
              >
                <strong>Slack</strong>
              </Link>
            </div>
          </div>
          <div className="d-flex flex-row">
            <div className="p-1 w-100">
              Open an issue on{" "}
              <Link
                target="_blank"
                rel="noreferrer"
                href="https://github.com/growthbook/growthbook/issues"
              >
                <strong>GitHub</strong>
              </Link>
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
            <NextLink href="/settings/team" className="boxlink">
              Invite team
              <FiArrowRight />
            </NextLink>
          </span>
        </div>
      )}
      <div className="card-body border-top">
        <div className="card-title">
          <h4 className="">Have questions?</h4>
        </div>
        Talk to us in our{" "}
        <Link
          target="_blank"
          rel="noreferrer"
          href="https://slack.growthbook.io?ref=app-havequestions"
        >
          <strong>Slack channel</strong>
        </Link>
      </div>
    </div>
  );
}
