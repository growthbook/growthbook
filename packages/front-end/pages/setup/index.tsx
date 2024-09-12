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
import { useEnvironments } from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

export type SdkFormValues = {
  languages: SDKLanguage[];
  sdkVersion: string;
  environment: string;
};

export default function SetupFlow() {
  const [step, setStep] = useState(0);
  const [connection, setConnection] = useState<null | string>(null);
  const [SDKConnectionModalOpen, setSDKConnectionModalOpen] = useState(false);
  const [setupComplete, setSetupComplete] = useState(false);

  const { hasCommercialFeature } = useUser();
  const { organization } = useUser();
  const environments = useEnvironments();

  const sdkConnectionForm = useForm<SdkFormValues>({
    defaultValues: {
      languages: ["react"],
      sdkVersion: "",
      environment: "dev",
    },
  });

  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();

  const canUseSetupFlow =
    permissionsUtil.canCreateSDKConnection({
      projects: [],
      environment: "production",
    }) &&
    permissionsUtil.canCreateEnvironment({ projects: [], id: "production" }) &&
    permissionsUtil.canCreateDataSource({ projects: [] });

  // Mark setup as complete
  const handleSubmit = async () => {
    setSetupComplete(true);
  };

  if (!canUseSetupFlow) {
    return (
      <div className="alert alert-warning mt-5">
        You do not have permission to use this setup flow.
      </div>
    );
  }

  if (setupComplete) {
    return <SetupCompletedPage />;
  }

  return (
    <div className="container pagecontents" style={{ padding: "0px 150px" }}>
      <PageHead
        breadcrumb={[{ display: "< Exit Setup", href: "/getstarted" }]}
      />
      <h1 className="mt-5" style={{ padding: "0px 65px" }}>
        Setup GrowthBook for {organization.name}
      </h1>
      <PagedModal
        header={""}
        submit={() => handleSubmit()}
        cta={"Finish Setup"}
        closeCta="Cancel"
        step={step}
        setStep={setStep}
        inline
        className="bg-light border-0"
        navStyle={"default"}
        stickyFooter
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

            if (
              environments.find((e) => e.id === value.environment) === undefined
            ) {
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
              ciphered: canUseSecureConnection,
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
