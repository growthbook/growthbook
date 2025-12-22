import { useEffect, useState } from "react";
import {
  CreateSDKConnectionParams,
  SDKConnectionInterface,
  SDKLanguage,
} from "shared/types/sdk-connection";
import { getLatestSDKVersion, getSDKCapabilities } from "shared/sdk-versioning";
import { ProjectInterface } from "back-end/types/project";
import { Environment } from "back-end/types/organization";
import { useForm } from "react-hook-form";
import { useRouter } from "next/router";
import PagedModal from "@/components/Modal/PagedModal";
import { useUser } from "@/services/UserContext";
import Page from "@/components/Modal/Page";
import track from "@/services/track";
import { useAuth } from "@/services/auth";
import VerifyConnectionPage from "@/components/InitialSetup/VerifyConnectionPage";
import PageHead from "@/components/Layout/PageHead";
import SetupCompletedPage from "@/components/InitialSetup/SetupCompletedPage";
import {
  getConnectionLanguageFilter,
  LanguageFilter,
  languageMapping,
} from "@/components/Features/SDKConnections/SDKLanguageLogo";
import { useEnvironments } from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import useSDKConnections from "@/hooks/useSDKConnections";
import SDKLanguageSelector from "@/components/Features/SDKConnections/SDKLanguageSelector";
import SetupAbandonedPage from "@/components/InitialSetup/SetupAbandonedPage";

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
  const router = useRouter();
  const exitHref =
    router.query.exitLocation === "features" ? "/features" : "/getstarted";

  const [connection, setConnection] = useState<null | string>(null);
  const [SDKConnectionModalOpen, setSDKConnectionModalOpen] = useState(false);
  const [skipped, setSkipped] = useState<Set<number>>(() => new Set());

  const { hasCommercialFeature } = useUser();
  const { apiCall } = useAuth();
  const { data: sdkConnectionData } = useSDKConnections();
  const { organization, refreshOrganization } = useUser();
  const { datasources, mutateDefinitions, project } = useDefinitions();
  const environments = useEnvironments();
  const [languageFilter, setLanguageFilter] = useState<LanguageFilter>(
    getConnectionLanguageFilter([]),
  );

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
      setStep(2);
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

  if (!canUseSetupFlow) {
    return (
      <div className="alert alert-warning mt-5">
        You do not have permission to use this setup flow.
      </div>
    );
  }

  return (
    <div className="container pagecontents pt-5" style={{ maxWidth: "1100px" }}>
      <PageHead breadcrumb={[{ display: "< Exit Setup", href: exitHref }]} />
      {step < 2 && (
        <h1 style={{ padding: "0px 65px" }}>
          Setup GrowthBook for {organization.name}
        </h1>
      )}
      <PagedModal
        trackingEventModalType="setup-growthbook"
        header={""}
        submit={async () => {}}
        hideCta={step >= 2}
        cta={"Next"}
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
        hideNav
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

                setStep((prev) => prev + 1);
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
              sdkCapabilities.includes("visualEditorJS");

            const canUseUrlRedirects = sdkCapabilities.includes("redirects");

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
              includeRuleIds: true,
              includeProjectPublicId: false,
              projects: project ? [project] : [],
            };

            const res = await apiCall<{ connection: SDKConnectionInterface }>(
              `/sdk-connections`,
              {
                method: "POST",
                body: JSON.stringify(body),
              },
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
          <div style={{ padding: "0px 49px" }}>
            <h2>Select your SDK Language</h2>
            <SDKLanguageSelector
              value={[sdkConnectionForm.watch("languages")[0]]}
              setValue={([language]) => {
                const version = getLatestSDKVersion(language);
                sdkConnectionForm.setValue("sdkVersion", version);
                sdkConnectionForm.setValue("languages", [language]);
              }}
              multiple={false}
              includeOther={false}
              languageFilter={languageFilter}
              setLanguageFilter={setLanguageFilter}
            />
          </div>
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
            goToNextStep={() => {
              track("Finish Essential Setup", {
                source: "EssentialSetup",
                skippedSteps: skipped,
              });
              setStep((prev) => prev + 1);
            }}
            setSkipped={() =>
              setSkipped((prev) => {
                const next = new Set(prev);
                next.add(step);
                return next;
              })
            }
          />
        </Page>

        <Page display="">
          {skipped.size > 0 ? (
            <SetupAbandonedPage exitHref={exitHref} />
          ) : (
            <SetupCompletedPage exitHref={exitHref} />
          )}
        </Page>
      </PagedModal>
    </div>
  );
}

SetupFlow.liteLayout = true;
