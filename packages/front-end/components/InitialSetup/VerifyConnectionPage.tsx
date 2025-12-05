import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { useCallback, useEffect, useState } from "react";
import {
  FaAngleDown,
  FaAngleRight,
  FaExclamationCircle,
  FaExclamationTriangle,
} from "react-icons/fa";
import { PiArrowRight, PiPaperPlaneTiltFill } from "react-icons/pi";
import LoadingOverlay from "@/components/LoadingOverlay";
import { getApiBaseUrl } from "@/components/Features/CodeSnippetModal";
import InstallationCodeSnippet from "@/components/SyntaxHighlighting/Snippets/InstallationCodeSnippet";
import GrowthBookSetupCodeSnippet from "@/components/SyntaxHighlighting/Snippets/GrowthBookSetupCodeSnippet";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAttributeSchema } from "@/services/features";
import TargetingAttributeCodeSnippet from "@/components/SyntaxHighlighting/Snippets/TargetingAttributeCodeSnippet";
import { GBHashLock } from "@/components/Icons";
import Code from "@/components/SyntaxHighlighting/Code";
import InviteModal from "@/components/Settings/Team/InviteModal";
import { useUser } from "@/services/UserContext";
import CheckSDKConnectionModal from "@/components/GuidedGetStarted/CheckSDKConnectionModal";
import useSDKConnections from "@/hooks/useSDKConnections";
import { DocLink } from "@/components/DocLink";
import { languageMapping } from "@/components/Features/SDKConnections/SDKLanguageLogo";
import Link from "@/ui/Link";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import track from "@/services/track";

interface Props {
  connection: string | null;
  showCheckConnectionModal: boolean;
  closeCheckConnectionModal: () => void;
  goToNextStep: () => void;
  setSkipped: () => void;
}

const VerifyConnectionPage = ({
  connection,
  showCheckConnectionModal,
  closeCheckConnectionModal,
  goToNextStep,
  setSkipped,
}: Props) => {
  const [installationOpen, setInstallationOpen] = useState(true);
  const [setupOpen, setSetupOpen] = useState(true);
  const [attributesOpen, setAttributesOpen] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [eventTracker, setEventTracker] = useState("");

  const { refreshOrganization, organization } = useUser();
  const settings = useOrgSettings();
  const attributeSchema = useAttributeSchema();
  const { data, error, mutate } = useSDKConnections();

  const currentConnection: SDKConnectionInterface | null =
    data?.connections.find((c) => c.id === connection) || null;

  useEffect(() => {
    if (currentConnection) {
      setEventTracker(currentConnection?.eventTracker || "");
    }
  }, [currentConnection]);
  const permissionsUtil = usePermissionsUtil();
  const canUpdate = currentConnection
    ? permissionsUtil.canUpdateSDKConnection(currentConnection, {})
    : false;
  const { apiCall } = useAuth();
  const updateEventTracker = useCallback(
    async (value: string) => {
      try {
        track("Event Tracker Selected", {
          eventTracker,
          language: currentConnection?.languages || [],
        });
        if (canUpdate && currentConnection?.id) {
          await apiCall(`/sdk-connections/${currentConnection.id}`, {
            method: "PUT",
            body: JSON.stringify({
              eventTracker: value,
            }),
          });
        }
        setEventTracker(value);
      } catch (e) {
        setEventTracker(value);
      }
    },
    [apiCall, canUpdate, currentConnection, eventTracker],
  );
  const apiHost = currentConnection ? getApiBaseUrl(currentConnection) : "";
  const language = currentConnection?.languages[0] || "javascript";
  const { docs } = languageMapping[language];
  const hashSecureAttributes = !!currentConnection?.hashSecureAttributes;
  const secureAttributes =
    attributeSchema?.filter((a) =>
      ["secureString", "secureString[]"].includes(a.datatype),
    ) || [];
  const secureAttributeSalt = settings.secureAttributeSalt ?? "";

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }

  return (
    <div className="mt-5" style={{ padding: "0px 57px" }}>
      {!currentConnection && <LoadingOverlay />}
      {inviting && (
        <InviteModal
          close={() => setInviting(false)}
          defaultRole="engineer"
          mutate={refreshOrganization}
        />
      )}
      {currentConnection && showCheckConnectionModal && (
        <CheckSDKConnectionModal
          connection={currentConnection}
          cta={currentConnection.connected ? "Continue" : "Skip"}
          close={closeCheckConnectionModal}
          goToNextStep={() => {
            if (!currentConnection.connected) {
              setSkipped();
            }
            goToNextStep();
          }}
          mutate={mutate}
          showModalClose
        />
      )}
      {currentConnection && (
        <div>
          <div className="d-flex mb-1">
            <h3>
              SDK Installation Instructions for {currentConnection.environment}{" "}
              Environment
            </h3>

            {organization.demographicData?.ownerJobTitle !== "engineer" && (
              <div className="ml-auto">
                <button
                  className="btn btn-link"
                  onClick={(e) => {
                    e.preventDefault();
                    setInviting(true);
                  }}
                >
                  <PiPaperPlaneTiltFill className="mr-1" />
                  Invite your developer
                </button>
              </div>
            )}
          </div>
          <DocLink docSection={docs}>
            View documentation <PiArrowRight />
          </DocLink>
          <div className="mt-4 mb-3">
            <h4
              className="cursor-pointer"
              onClick={(e) => {
                e.preventDefault();
                setInstallationOpen(!installationOpen);
              }}
            >
              Installation{" "}
              {installationOpen ? <FaAngleDown /> : <FaAngleRight />}
            </h4>
            {installationOpen && (
              <div className="appbox bg-light p-3">
                <InstallationCodeSnippet
                  language={currentConnection.languages[0]}
                  eventTracker={eventTracker}
                  setEventTracker={updateEventTracker}
                  apiHost={apiHost}
                  apiKey={currentConnection.key}
                  encryptionKey={
                    currentConnection.encryptPayload
                      ? currentConnection.encryptionKey
                      : undefined
                  }
                  remoteEvalEnabled={
                    currentConnection.remoteEvalEnabled || false
                  }
                />
              </div>
            )}
          </div>
          <div className="mb-3">
            <h4
              className="cursor-pointer"
              onClick={(e) => {
                e.preventDefault();
                setSetupOpen(!setupOpen);
              }}
            >
              Setup {setupOpen ? <FaAngleDown /> : <FaAngleRight />}
            </h4>
            {setupOpen && (
              <div className="appbox bg-light p-3">
                <GrowthBookSetupCodeSnippet
                  language={currentConnection.languages[0]}
                  version={currentConnection.sdkVersion}
                  apiHost={apiHost}
                  apiKey={currentConnection.key}
                  encryptionKey={
                    currentConnection.encryptPayload
                      ? currentConnection.encryptionKey
                      : undefined
                  }
                  remoteEvalEnabled={
                    currentConnection.remoteEvalEnabled || false
                  }
                  eventTracker={eventTracker}
                  setEventTracker={updateEventTracker}
                />
              </div>
            )}
          </div>
          {!(language.match(/^edge-/) || language === "other") && (
            <div className="mb-3">
              <h4
                className="cursor-pointer"
                onClick={(e) => {
                  e.preventDefault();
                  setAttributesOpen(!attributesOpen);
                }}
              >
                Targeting Attributes (Optional){" "}
                {attributesOpen ? <FaAngleDown /> : <FaAngleRight />}
              </h4>
              {attributesOpen && (
                <div className="appbox bg-light p-3">
                  <TargetingAttributeCodeSnippet
                    language={language}
                    hashSecureAttributes={hashSecureAttributes}
                    secureAttributeSalt={secureAttributeSalt}
                    version={currentConnection.sdkVersion}
                  />

                  {hashSecureAttributes && secureAttributes.length > 0 && (
                    <div
                      className="appbox mt-4"
                      style={{ background: "rgb(209 236 241 / 25%)" }}
                    >
                      <div className="alert alert-info mb-0">
                        <GBHashLock className="text-blue" /> This connection has{" "}
                        <strong>secure attribute hashing</strong> enabled. You
                        must manually hash all attributes with datatype{" "}
                        <code>secureString</code> or <code>secureString[]</code>{" "}
                        in your SDK implementation code.
                      </div>
                      <div className="px-3 pb-3">
                        <div className="mt-3">
                          Your organization currently has{" "}
                          {secureAttributes.length} secure attribute
                          {secureAttributes.length === 1 ? "" : "s"}
                          {secureAttributes.length > 0 && (
                            <>
                              {" "}
                              which need to be hashed before using them in the
                              SDK:
                              <table className="table table-borderless w-auto mt-1 ml-2">
                                <tbody>
                                  {secureAttributes.map((a, i) => (
                                    <tr key={i}>
                                      <td className="pt-1 pb-0">
                                        <code className="font-weight-bold">
                                          {a.property}
                                        </code>
                                      </td>
                                      <td className="pt-1 pb-0">
                                        <span className="text-gray">
                                          {a.datatype}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </>
                          )}
                        </div>
                        <div className="mt-3">
                          To hash an attribute, use a cryptographic library with{" "}
                          <strong>SHA-256</strong> support, and compute the
                          SHA-256 hashed value of your attribute <em>plus</em>{" "}
                          your organization&apos;s secure attribute salt.
                        </div>
                        <div className="mt-2">
                          Example, using your organization&apos;s secure
                          attribute salt:
                          {secureAttributeSalt === "" && (
                            <div className="alert alert-warning mt-2 px-2 py-1">
                              <FaExclamationTriangle /> Your organization has an
                              empty salt string. Add a salt string in your{" "}
                              <Link href="/settings">
                                organization settings
                              </Link>{" "}
                              to improve the security of hashed targeting
                              conditions.
                            </div>
                          )}
                          <Code
                            filename="pseudocode"
                            language="javascript"
                            code={`const salt = "${secureAttributeSalt}";

// hashing a secureString attribute
myAttribute = sha256(salt + myAttribute);

// hashing a secureString[] attribute
myAttributes = myAttributes.map(attribute => sha256(salt + attribute));`}
                          />
                        </div>
                        <div className="alert text-warning-orange mt-3 mb-0 px-2 py-1">
                          <FaExclamationCircle /> When using an insecure
                          environment (such as a browser), do not rely
                          exclusively on hashing as a means of securing highly
                          sensitive data. Hashing is an obfuscation technique
                          that makes it very difficult, but not impossible, to
                          extract sensitive data.
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
export default VerifyConnectionPage;
