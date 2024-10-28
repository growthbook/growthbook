import { useEffect, useState } from "react";
import {
  CreateSDKConnectionParams,
  SDKConnectionInterface,
  SDKLanguage,
} from "back-end/types/sdk-connection";
import { getLatestSDKVersion, getSDKCapabilities } from "shared/sdk-versioning";
import { ProjectInterface } from "back-end/types/project";
import { Environment } from "back-end/types/organization";
import { useForm } from "react-hook-form";
import { SchemaFormat } from "back-end/types/datasource";
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
import { useDefinitions } from "@/services/DefinitionsContext";
import useSDKConnections from "@/hooks/useSDKConnections";

export type SdkFormValues = {
  languages: SDKLanguage[];
  sdkVersion: string;
  environment: string;
};

export type ProjectApiResponse = {
  project: ProjectInterface;
};

export default function SetupFlow() {
  const [step, setStep] = useState(0);
  const [connection, setConnection] = useState<null | string>(null);
  const [eventTracker, setEventTracker] = useState<null | SchemaFormat>(null);
  const [SDKConnectionModalOpen, setSDKConnectionModalOpen] = useState(false);
  const [setupComplete, setSetupComplete] = useState(false);
  const [skipped, setSkipped] = useState<Set<number>>(() => new Set());

  const { hasCommercialFeature } = useUser();
  const { apiCall } = useAuth();
  const { data: sdkConnectionData } = useSDKConnections();
  const { organization, refreshOrganization } = useUser();
  const { datasources, mutateDefinitions, project } = useDefinitions();
  const environments = useEnvironments();

  const sdkConnectionForm = useForm<SdkFormValues>({
    defaultValues: {
      languages: ["react"],
      sdkVersion: "",
      environment: "dev",
    },
  });

  // Start off user on the correct step depending on how much has already been set up
  useEffect(() => {
    if (!sdkConnectionData?.connections.length || connection) {
      return;
    }
    const firstConnection = sdkConnectionData.connections[0];
    setConnection(firstConnection.id);
    sdkConnectionForm.setValue("languages", firstConnection.languages);
    sdkConnectionForm.setValue("environment", firstConnection.environment);

    if (!firstConnection.connected) {
      setStep(1);
    } else if (firstConnection.connected) {
      if (datasources.length === 0) {
        setStep(2);
      } else {
        setSetupComplete(true);
      }
    }
  }, [sdkConnectionData, datasources, sdkConnectionForm, connection]);

  const permissionsUtil = usePermissionsUtil();

  const canUseSetupFlow =
    permissionsUtil.canCreateSDKConnection({
      projects: [project],
      environment: "production",
    }) &&
    permissionsUtil.canCreateEnvironment({
      projects: [project],
      id: "production",
    });

  // Mark setup as complete
  const handleSubmit = async () => {
    if (eventTracker) {
      await apiCall(`/organization/setup-event-tracker`, {
        method: "PUT",
        body: JSON.stringify({
          eventTracker: eventTracker,
        }),
      });
      refreshOrganization();
    }
    track("Finish Essential Setup", {
      source: "EssentialSetup",
      skippedSteps: skipped,
    });
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
    <div className="container pagecontents pt-5" style={{ maxWidth: "1100px" }}>
      <PageHead
        breadcrumb={[{ display: "< Exit Setup", href: "/getstarted" }]}
      />
      <h1 style={{ padding: "0px 65px" }}>
        Setup GrowthBook for {organization.name}
      </h1>
      <PagedModal
        trackingEventModalType="setup-growthbook"
        header={""}
        submit={() => handleSubmit()}
        cta={"Finish Setup"}
        closeCta="Cancel"
        step={step}
        setStep={(step) => {
          if (skipped.has(step)) {
            setSkipped((prev) => {
              const next = new Set(prev);
              next.delete(step);
              return next;
            });
          }
          setStep(step);
        }}
        inline
        className="bg-transparent border-0"
        navStyle={"default"}
        stickyFooter
        onSkip={
          step === 0
            ? undefined
            : async () => {
                setSkipped((prev) => {
                  const next = new Set(prev);
                  next.add(step);
                  return next;
                });

                if (step >= 2) {
                  handleSubmit();
                } else {
                  setStep((prev) => prev + 1);
                }
              }
        }
        skipped={skipped}
      >
        <Page
          enabled={!connection}
          display="Initiate Connection"
          validate={sdkConnectionForm.handleSubmit(async (value) => {
            if (connection) {
              return Promise.resolve();
            }

            // Create the selected environment if it doesn't exist
            if (
              environments.find((e) => e.id === value.environment) === undefined
            ) {
              const newEnv: Environment = {
                id: value.environment,
                description: "",
                toggleOnList: true,
                defaultState: true,
                projects: [project],
              };
              await apiCall(`/environment`, {
                method: "POST",
                body: JSON.stringify({
                  environment: newEnv,
                }),
              });
            }

            // Create a new SDK connection within the new project for the selected environment
            // Default to enabling encryption, Visual Editor, and URL Redirects if the org has the feature and the SDK supports it

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
              projects: [project],
            };

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

            await refreshOrganization();
            await mutateDefinitions();
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
            setSkipped={() =>
              setSkipped((prev) => {
                const next = new Set(prev);
                next.add(step);
                return next;
              })
            }
          />
        </Page>
        <Page enabled={!datasources.length} display="Select Data Source">
          <SelectDataSourcePage
            eventTracker={eventTracker}
            setEventTracker={setEventTracker}
          />
        </Page>
      </PagedModal>
    </div>
  );
}

SetupFlow.liteLayout = true;
