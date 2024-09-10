import { useState } from "react";
import {
  CreateSDKConnectionParams,
  SDKConnectionInterface,
  SDKLanguage,
} from "@back-end/types/sdk-connection";
import { PiPaperPlaneTiltFill } from "react-icons/pi";
import { useForm } from "react-hook-form";
import { Environment } from "@back-end/types/organization";
import PagedModal from "@/components/Modal/PagedModal";
import { useUser } from "@/services/UserContext";
import Page from "@/components/Modal/Page";
import { eventSchemas } from "@/services/eventSchema";
import DataSourceLogo from "@/components/DataSources/DataSourceLogo";
import InitiateConnectionPage from "@/components/InitialSetup/InitiateConnectionPage";
import track from "@/services/track";
import { useAuth } from "@/services/auth";
import VerifyConnectionPage from "@/components/InitialSetup/VerifyConnectionPage";

export type SdkFormValues = {
  languages: SDKLanguage[];
  sdkVersion: string;
  cipher: boolean;
  environment: string;
};

export default function SetupFlow() {
  const { organization } = useUser();
  const [step, setStep] = useState(0);
  const [connection, setConnection] = useState<null | SDKConnectionInterface>(
    null
  );

  const [eventTracker, setEventTracker] = useState<null | string>(null);

  const sdkConnectionForm = useForm<SdkFormValues>({
    defaultValues: {
      languages: ["react"],
      sdkVersion: "",
      cipher: true,
      environment: "dev",
    },
  });

  const { apiCall } = useAuth();
  // const permissionsUtil = usePermissionsUtil();

  // const canUpdate = permissionsUtil.canUpdateSDKConnection(connection, {});
  // const canUpdate = true;

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
          validate={sdkConnectionForm.handleSubmit(async (value) => {
            if (connection) {
              return Promise.resolve();
            }

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

            // Create environment first if it doesn't exist (aka not production)
            if (value.environment !== "production") {
              const newEnv: Environment = {
                id: value.environment,
                description: "",
                toggleOnList: true,
                defaultState: true,
              };
              await apiCall(`/environment`, {
                method: "POST",
                body: JSON.stringify({
                  environment: newEnv,
                }),
              });
            }

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
          <InitiateConnectionPage
            connection={connection}
            form={sdkConnectionForm}
          />
        </Page>

        <Page display="Verify Connection">
          <VerifyConnectionPage connection={connection} />
        </Page>
        <Page display="Select Data Source">
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
            <div className="appbox p-4 mb-3">
              <h3 className="mb-0 align-self-center">
                How A/B Testing Works at GrowthBook
              </h3>

              <p>
                For example, Google Analytics is an event tracker that sits on
                top of BigQuery, where your data is stored. You will need to
                configure BigQuery in order to connect GrowthBook to Google
                Analytics
              </p>
              <img
                className="mt-2"
                src="images/essential-setup/data-source-diagram.png"
              />
            </div>
          </div>
        </Page>
      </PagedModal>
    </div>
  );
}

SetupFlow.liteLayout = true;
