import { SSOConnectionInterface } from "back-end/types/sso-connection";
import { useState } from "react";
import { isCloud } from "@/services/env";
import Code from "../SyntaxHighlighting/Code";

export interface Props {
  ssoConnection: Partial<SSOConnectionInterface> | null;
}

export default function SSOSettings({ ssoConnection }: Props) {
  const [expanded, setExpanded] = useState(false);

  // No custom enterprise SSO configured on GrowthBook Cloud
  if (!ssoConnection) return null;

  return (
    <div className="alert alert-info">
      <div className="d-flex">
        <div>
          <h3>Enterprise SSO Enabled</h3>
          {ssoConnection.emailDomain && (
            <div>
              Users can auto-join your account when signing in through your
              Identity Provider with an email matching{" "}
              <strong>*@{ssoConnection.emailDomain}</strong>
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
    </div>
  );
}
