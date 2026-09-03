import { SSOConnectionInterface } from "shared/types/sso-connection";
import { Fragment, useState } from "react";
import { isDefined } from "shared/util";
import { isCloud } from "@/services/env";
import Code from "@/components/SyntaxHighlighting/Code";
import Callout from "@/ui/Callout";

export interface Props {
  ssoConnection: Partial<SSOConnectionInterface> | null;
}

export default function SSOSettings({ ssoConnection }: Props) {
  const [expanded, setExpanded] = useState(false);

  // No custom enterprise SSO configured on GrowthBook Cloud
  if (!ssoConnection) return null;

  return (
    <Callout status="info">
      <div className="d-flex">
        <div>
          <h3>Enterprise SSO Enabled</h3>
          {isDefined(ssoConnection.emailDomains) &&
            ssoConnection.emailDomains.length > 0 && (
              <div>
                Users can auto-join your account when signing in through your
                Identity Provider with an email matching{" "}
                <strong>*@{ssoConnection.emailDomains[0]}</strong>
                {ssoConnection.emailDomains.length > 1 && (
                  <div className="small mt-1">
                    or any of the following email domains:{" "}
                    {ssoConnection.emailDomains.slice(1).map((d, i) => (
                      <Fragment key={d}>
                        <strong>{d}</strong>
                        {i < (ssoConnection.emailDomains?.length || 0) - 2 &&
                          ", "}
                      </Fragment>
                    ))}
                  </div>
                )}
              </div>
            )}
          {isCloud() && (
            <div className="mt-2">
              Contact{" "}
              <a href="mailto:hello@growthbook.io">hello@growthbook.io</a> to
              make changes to your SSO configuration.
            </div>
          )}
        </div>
        <div className="ml-auto pl-3">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setExpanded(!expanded);
            }}
          >
            {expanded ? "hide" : "view"} details
          </a>
        </div>
      </div>
      {expanded && (
        <Code
          className="mt-2"
          language="json"
          code={JSON.stringify(ssoConnection, null, 2)}
        />
      )}
    </Callout>
  );
}
