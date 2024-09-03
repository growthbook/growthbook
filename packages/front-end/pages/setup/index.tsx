import { useState } from "react";
import { useForm } from "react-hook-form";
import { getLatestSDKVersion } from "shared/sdk-versioning";
import {
  CreateSDKConnectionParams,
  SDKConnectionInterface,
  SDKLanguage,
} from "@back-end/types/sdk-connection";
import { Checkbox, RadioGroup } from "@radix-ui/themes";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import { BsArrowRepeat } from "react-icons/bs";
import { PiPaperPlaneTiltFill } from "react-icons/pi";
import PagedModal from "@/components/Modal/PagedModal";
import { useUser } from "@/services/UserContext";
import Page from "@/components/Modal/Page";
import SDKLanguageSelector from "@/components/Features/SDKConnections/SDKLanguageSelector";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { getApiBaseUrl } from "@/components/Features/CodeSnippetModal";
import useSDKConnections from "@/hooks/useSDKConnections";
import InstallationCodeSnippet from "@/components/SyntaxHighlighting/Snippets/InstallationCodeSnippet";
import GrowthBookSetupCodeSnippet from "@/components/SyntaxHighlighting/Snippets/GrowthBookSetupCodeSnippet";
import LoadingOverlay from "@/components/LoadingOverlay";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/components/Button";
import ConnectionStatus from "@/components/Features/SDKConnections/ConnectionStatus";
import ConnectionNode from "@/components/Features/SDKConnections/ConnectionNode";
import SDKLanguageLogo from "@/components/Features/SDKConnections/SDKLanguageLogo";
import { GBAddCircle } from "@/components/Icons";
import AttributeModal from "@/components/Features/AttributeModal";
import { useAttributeSchema } from "@/services/features";
import { eventSchemas } from "@/services/eventSchema";
import DataSourceLogo from "@/components/DataSources/DataSourceLogo";

type FormValues = {
  languages: SDKLanguage[];
  sdkVersion: string;
  cipher: boolean;
  environment: string;
};

export default function SetupFlow() {
  const { organization } = useUser();
  const [step, setStep] = useState(0);
  const [languageError, setLanguageError] = useState("");
  const [installationOpen, setInstallationOpen] = useState(true);
  const [setupOpen, setSetupOpen] = useState(true);
  const [attributeModalData, setAttributeModalData] = useState<null | string>(
    null
  );
  const [connection, setConnection] = useState<SDKConnectionInterface | null>();
  const [eventTracker, setEventTracker] = useState<null | string>("ga4");

  const { data, mutate, error } = useSDKConnections();
  const permissionsUtil = usePermissionsUtil();

  // Figure out how to mutate after a user adds a new attribute
  const attributeSchema = useAttributeSchema(false, "");
  const { apiCall } = useAuth();
  const form = useForm<FormValues>({
    defaultValues: {
      languages: ["react"],
      sdkVersion: "",
      cipher: true,
      environment: "dev",
    },
  });

  // const canUpdate = permissionsUtil.canUpdateSDKConnection(connection, {});
  const canCreateAttributes = permissionsUtil.canViewAttributeModal("");
  const canUpdate = true;
  const apiHost = connection ? getApiBaseUrl(connection) : "";

  const identifierAttributes = attributeSchema.filter((a) => !!a.hashAttribute);
  const otherAttributes = attributeSchema.filter((a) => !a.hashAttribute);
  const eventTrackerDescription = eventSchemas.find(
    (e) => e.value === eventTracker
  )?.intro;

  const handleSubmit = async () => undefined;

  return (
    <div className="container pagecontents" style={{ padding: "0px 150px" }}>
      <h1 className="mt-5" style={{ padding: "0px 57px" }}>
        Setup GrowthBook for {organization.name}
      </h1>
      <PagedModal
        header={""}
        submit={() => handleSubmit()}
        cta={"Finish Setup"}
        closeCta="Cancel"
        size="fill"
        step={step}
        setStep={setStep}
        inline
        className="bg-transparent border-0"
        navStyle={"default"}
      >
        <Page
          display="Initiate Connection"
          validate={form.handleSubmit(async (value) => {
            const body: Omit<CreateSDKConnectionParams, "organization"> = {
              name: `${value.languages[0]} SDK Connection`,
              languages: value.languages,
              sdkVersion: value.sdkVersion,
              environment: value.environment,
              encryptPayload: value.cipher,
              hashSecureAttributes: value.cipher,
              includeExperimentNames: value.cipher,
              includeDraftExperiments: true,
              includeVisualExperiments:
                value.languages[0] === "nodejs" ? false : true,
              includeRedirectExperiments: true,
              projects: [],
            };

            const res = await apiCall<{ connection: SDKConnectionInterface }>(
              `/sdk-connections`,
              {
                method: "POST",
                body: JSON.stringify(body),
              }
            );
            setConnection(res.connection);
            track("Create SDK Connection", {
              source: "EssentialSetup",
              languages: value.languages,
              ciphered: value.cipher,
              environment: value.environment,
            });
          })}
        >
          <div className="mt-5" style={{ padding: "0px 57px" }}>
            <h4>Select your SDK Language</h4>
            <div className="form-group">
              {/* <label>SDK Language</label> */}
              {languageError ? (
                <span className="ml-3 alert px-1 py-0 mb-0 alert-danger">
                  {languageError}
                </span>
              ) : null}
              <SDKLanguageSelector
                value={form.watch("languages")}
                setValue={(languages) => {
                  form.setValue("languages", languages);
                  if (languages?.length === 1) {
                    form.setValue(
                      "sdkVersion",
                      getLatestSDKVersion(languages[0])
                    );
                  }
                }}
                limitLanguages={[
                  "react",
                  "javascript",
                  "nodejs",
                  "nocode-other",
                ]}
                multiple={form.watch("languages").length > 1}
                includeOther={false}
                skipLabel={form.watch("languages").length <= 1}
                hideShowAllLanguages={true}
              />
            </div>
            <div>
              <Checkbox
                id="toggle-secure-connection"
                checked={form.watch("cipher")}
                onCheckedChange={(val) =>
                  form.setValue("cipher", val === "indeterminate" ? true : val)
                }
              />
              <label
                htmlFor="toggle-secure-connection"
                className="ml-2 text-dark"
              >
                <b>Use secure connection</b>
                <p className="text-muted">
                  Your SDK Connection will be ciphered, adding obfuscation while
                  remaining cacheable.
                </p>
              </label>
            </div>
            <div>
              <h4>How will you start using GrowthBook?</h4>
              <RadioGroup.Root
                value={form.watch("environment")}
                onValueChange={(val) => form.setValue("environment", val)}
              >
                <RadioGroup.Item value="production">
                  <>
                    <b>On our live website or app</b>
                    <p className="text-muted">
                      The SDK will be available for the{" "}
                      <strong>production</strong> environment.
                    </p>
                  </>
                </RadioGroup.Item>
                <RadioGroup.Item value="dev">
                  <>
                    <b>
                      For testing and previewing before pushing features and
                      experiments live
                    </b>
                    <p className="text-muted">
                      The SDK will be available for the <strong>dev</strong>{" "}
                      environment.
                    </p>
                  </>
                </RadioGroup.Item>
              </RadioGroup.Root>
            </div>
          </div>
        </Page>
        <Page display="Verify Connection">
          <div className="mt-4" style={{ padding: "0px 57px" }}>
            {(!data || !connection) && <LoadingOverlay />}
            {connection && data && (
              <div>
                <div className="mb-3">
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
                        language={connection.languages[0]}
                        apiHost={apiHost}
                        apiKey={connection.key}
                        encryptionKey={
                          connection.encryptPayload
                            ? connection.encryptionKey
                            : undefined
                        }
                        remoteEvalEnabled={
                          connection.remoteEvalEnabled || false
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
                        language={connection.languages[0]}
                        version={connection.sdkVersion}
                        apiHost={apiHost}
                        apiKey={connection.key}
                        encryptionKey={
                          connection.encryptPayload
                            ? connection.encryptionKey
                            : undefined
                        }
                        remoteEvalEnabled={
                          connection.remoteEvalEnabled || false
                        }
                      />
                    </div>
                  )}
                </div>
                <div
                  className="d-flex align-items-center position-relative mt-5"
                  style={{
                    justifyContent: "space-between",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: 10,
                      right: 10,
                      height: 6,
                      marginTop: -9,
                      backgroundColor: "var(--text-color-primary)",
                    }}
                  />
                  <ConnectionNode first title="Your App">
                    <div
                      className="d-flex flex-wrap justify-content-center"
                      style={{ maxWidth: 325 }}
                    >
                      {connection.languages.map((language) => (
                        <div className="mx-1" key={language}>
                          <SDKLanguageLogo
                            showLabel={true}
                            language={language}
                            version={
                              connection.languages?.length === 1
                                ? connection.sdkVersion
                                : undefined
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </ConnectionNode>
                  <ConnectionStatus
                    connected={connection.connected}
                    canRefresh={canUpdate && !connection.connected}
                    refresh={
                      <Button
                        color="link"
                        className="btn-sm"
                        onClick={async () => {
                          await mutate();
                        }}
                      >
                        <BsArrowRepeat /> re-check
                      </Button>
                    }
                  />
                  <ConnectionNode
                    title={
                      <>
                        <img
                          src="/logo/growthbook-logo.png"
                          style={{ width: 130 }}
                          alt="GrowthBook"
                        />
                        <span style={{ verticalAlign: "sub", marginLeft: 3 }}>
                          API
                        </span>
                      </>
                    }
                    last
                  >
                    <code className="text-muted">{apiHost}</code>
                  </ConnectionNode>
                </div>
              </div>
            )}
          </div>
        </Page>
        <Page display="Targeting Attributes">
          <div className="mt-5" style={{ padding: "0px 57px" }}>
            <div className="d-flex mb-3">
              <h3 className="mb-0 align-self-center">Targeting Attributes</h3>
              {canCreateAttributes && (
                <div className="ml-auto">
                  <button
                    className="btn btn-primary"
                    onClick={(e) => {
                      e.preventDefault();
                      setAttributeModalData("");
                    }}
                  >
                    <span
                      style={{ position: "relative", top: "-1px" }}
                      className="mr-2"
                    >
                      <GBAddCircle />
                    </span>
                    Targeting Attribute
                  </button>
                </div>
              )}
            </div>
            <p>
              Targeting attributes can be used in Feature Flags and Experiments
              to determine the experience for various users. By default, several
              targeting attributes are defined. To use, they will need to be
              passed through to your SDK.
            </p>
            <div className="container">
              <div className="row row-cols-2">
                <div className="col">
                  <h4 className="mb-3">Identifiers</h4>
                  <ul style={{ listStyle: "none", paddingLeft: "0px" }}>
                    {identifierAttributes.map((a) => (
                      <li key={a.property} className="mb-4">
                        <strong>
                          {a.property}{" "}
                          <span
                            className="badge badge badge-light ml-2"
                            style={{ background: "#0000330F" }}
                          >
                            {a.datatype}
                          </span>
                        </strong>
                        <p>{a.description}</p>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="col">
                  <h4 className="mb-3">Other Targeting Attributes</h4>
                  <ul style={{ listStyle: "none", paddingLeft: "0px" }}>
                    {otherAttributes.map((a) => (
                      <li key={a.property} className="mb-4">
                        <strong>
                          {a.property}{" "}
                          <span
                            className="badge badge badge-light ml-2"
                            style={{ background: "#0000330F" }}
                          >
                            {a.datatype}
                          </span>
                        </strong>
                        <p>{a.description}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
          {attributeModalData !== null && (
            <AttributeModal
              close={() => setAttributeModalData(null)}
              attribute={attributeModalData}
            />
          )}
        </Page>
        <Page display="Data Source">
          <div className="mt-5" style={{ padding: "0px 57px" }}>
            <div className="d-flex mb-3">
              <h3 className="mb-0 align-self-center">
                Select your Event Tracker
              </h3>

              <div className="ml-auto">
                <a href="#">
                  <PiPaperPlaneTiltFill className="mr-1" />
                  Send to your Data Specialist
                </a>
              </div>
            </div>
            <p>
              GrowthBook has built-in support for a number of popular event
              tracking systems, and can work with virtually any type of data
              with a custom integration. Add a custom data source if you don’t
              see yours listed below.
            </p>
            <div className="row mb-5">
              <div className="col-auto">
                <div
                  className="d-flex flex-wrap pb-3"
                  style={{ rowGap: "1em", columnGap: "1em" }}
                >
                  {eventSchemas
                    .filter((s) => s.value !== "mixpanel")
                    .map((eventSchema) => (
                      <div
                        className={`hover-highlight cursor-pointer border rounded ${
                          eventTracker === eventSchema.value ? "bg-light" : ""
                        }`}
                        style={{
                          height: 50,
                          padding: 10,
                          boxShadow:
                            eventTracker === eventSchema.value
                              ? "0 0 0 1px var(--text-color-primary)"
                              : "",
                        }}
                        key={eventSchema.value}
                        onClick={(e) => {
                          e.preventDefault();
                          if (eventTracker === eventSchema.value) {
                            setEventTracker(null);
                          } else {
                            setEventTracker(eventSchema.value);
                          }
                        }}
                      >
                        <DataSourceLogo
                          language={eventSchema.value}
                          showLabel={true}
                        />
                      </div>
                    ))}
                </div>
              </div>
            </div>
            <div className="d-flex mb-3">
              <h3 className="mb-0 align-self-center">
                About Google Analytics v4
              </h3>

              <div className="ml-auto">
                <Button
                  color="primary"
                  className="btn-sm"
                  onClick={async () => {
                    await mutate();
                  }}
                >
                  Connect Data Source
                </Button>
              </div>
            </div>
            <p>{eventTrackerDescription}</p>
            <img
              className="mt-2"
              src="images/essential-setup/data-source-diagram.png"
            />
          </div>
        </Page>
      </PagedModal>
    </div>
  );
}

SetupFlow.liteLayout = true;
