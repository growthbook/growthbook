import Link from "next/link";
import { FiArrowRight } from "react-icons/fi";
import { Trans } from "@lingui/react/macro";
import usePermissions from "@/hooks/usePermissions";
import track from "@/services/track";
import { DocLink } from "@/components/DocLink";

export default function DocumentationLinksSidebar() {
  const permissions = usePermissions();

  return (
    <div className="appbox p-4 mb-3">
      <div className="card-body">
        <div className="card-title">
          <h4 className="">
            <Trans>Documentation, help &amp; support</Trans>
          </h4>
        </div>
        <div className="card-text">
          <div className="d-flex flex-row">
            <div className="p-1 w-100">
              <Trans>
                Read our{" "}
                <DocLink
                  useRadix={false}
                  docSection="user_guide"
                  className="font-weight-bold"
                >
                  User Guide
                </DocLink>
              </Trans>
            </div>
          </div>
          <div className="d-flex flex-row">
            <div className="p-1 w-100">
              <Trans>
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
              </Trans>
            </div>
          </div>
          <div className="d-flex flex-row">
            <div className="p-1 w-100">
              <Trans>
                View docs for our{" "}
                <DocLink
                  useRadix={false}
                  docSection="sdks"
                  className="font-weight-bold"
                >
                  SDKs
                </DocLink>
              </Trans>
            </div>
          </div>
          <div className="d-flex flex-row">
            <div className="p-1 w-100">
              <Trans>
                Chat with us on{" "}
                <a
                  target="_blank"
                  rel="noreferrer"
                  href="https://slack.growthbook.io?ref=app-getstarted"
                >
                  <strong>Slack</strong>
                </a>
              </Trans>
            </div>
          </div>
          <div className="d-flex flex-row">
            <div className="p-1 w-100">
              <Trans>
                Open an issue on{" "}
                <a
                  target="_blank"
                  rel="noreferrer"
                  href="https://github.com/growthbook/growthbook/issues"
                >
                  <strong>GitHub</strong>
                </a>
              </Trans>
            </div>
          </div>
        </div>
      </div>
      {permissions.manageTeam && (
        <div className="card-body border-top">
          <div className="card-title">
            <h4 className="">
              <Trans>Invite team</Trans>
            </h4>
          </div>
          <p className="card-text">
            <Trans>Add teammates to your account</Trans>
          </p>
          <span className="action-link non-active-step">
            <Link href="/settings/team" className="boxlink">
              <Trans>Invite team</Trans>
              <FiArrowRight />
            </Link>
          </span>
        </div>
      )}
      <div className="card-body border-top">
        <div className="card-title">
          <h4 className="">
            <Trans>Have questions?</Trans>
          </h4>
        </div>
        <Trans>
          Talk to us in our{" "}
          <a
            target="_blank"
            rel="noreferrer"
            href="https://slack.growthbook.io?ref=app-havequestions"
          >
            <strong>Slack channel</strong>
          </a>
        </Trans>
      </div>
    </div>
  );
}
