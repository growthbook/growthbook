import { useState } from "react";
import {
  CreateSDKConnectionParams,
  SDKConnectionInterface,
  SDKLanguage,
} from "@back-end/types/sdk-connection";
import { useForm } from "react-hook-form";
import { Environment } from "@back-end/types/organization";
import { getLatestSDKVersion, getSDKCapabilities } from "shared/sdk-versioning";
import PagedModal from "@/components/Modal/PagedModal";
import { useUser } from "@/services/UserContext";
import Page from "@/components/Modal/Page";
import InitiateConnectionPage from "@/components/InitialSetup/InitiateConnectionPage";
import track from "@/services/track";
import { useAuth } from "@/services/auth";
import VerifyConnectionPage from "@/components/InitialSetup/VerifyConnectionPage";
import SelectDataSourcePage from "@/components/InitialSetup/SelectDataSourcePage";
import PageHead from "@/components/Layout/PageHead";
import SetupCompletedPage from "@/components/InitialSetup/SetupCompletedPage";
import { languageMapping } from "@/components/Features/SDKConnections/SDKLanguageLogo";

export type SdkFormValues = {
  languages: SDKLanguage[];
  sdkVersion: string;
  cipher: boolean;
  environment: string;
};

export default function SetupFlow() {
  const [step, setStep] = useState(0);
  const [connection, setConnection] = useState<null | string>(null);
  const [SDKConnectionModalOpen, setSDKConnectionModalOpen] = useState(false);
  const [setupComplete, setSetupComplete] = useState(false);

  const { hasCommercialFeature } = useUser();
  const { organization } = useUser();

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

  // Mark setup as complete
  const handleSubmit = async () => {
    setSetupComplete(true);
  };

  if (setupComplete) {
    return <SetupCompletedPage />;
  }

  return (
    <div className="container pagecontents" style={{ padding: "0px 150px" }}>
      <PageHead
        breadcrumb={[{ display: "< Exit Setup", href: "/getstarted" }]}
      />

      {/* Add setup complete page */}
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

            const sdkCapabilities = getSDKCapabilities(value.languages[0]);

            const canUseVisualEditor =
              hasCommercialFeature("visual-editor") &&
              sdkCapabilities.includes("visualEditorJS");

            const canUseUrlRedirects =
              hasCommercialFeature("redirects") &&
              sdkCapabilities.includes("redirects");

            const canUseSecureConnection =
              hasCommercialFeature("hash-secure-attributes") &&
              sdkCapabilities.includes("encryption");

            const languageLabel = languageMapping[value.languages[0]].label;

            const body: Omit<CreateSDKConnectionParams, "organization"> = {
              name: `${languageLabel} SDK Connection`,
              languages: value.languages,
              sdkVersion: getLatestSDKVersion(value.languages[0]),
              environment: value.environment,
              encryptPayload: canUseSecureConnection,
              hashSecureAttributes: canUseSecureConnection,
              includeExperimentNames: !canUseSecureConnection,
              includeDraftExperiments: true,
              includeVisualExperiments: canUseVisualEditor,
              includeRedirectExperiments: canUseUrlRedirects,
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
            setConnection(res.connection.id);
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

        <Page
          display="Verify Connection"
          customNext={() => {
            setSDKConnectionModalOpen(true);
          }}
        >
          <VerifyConnectionPage
            connection={connection}
            showCheckConnectionModal={SDKConnectionModalOpen}
            closeCheckConnectionModal={() => setSDKConnectionModalOpen(false)}
            goToNextStep={() => setStep(2)}
          />
        </Page>
        <Page display="Select Data Source">
          <SelectDataSourcePage />
        </Page>
      </PagedModal>
    </div>
  );
}

SetupFlow.liteLayout = true;
