import { FC, useEffect, useState } from "react";
import { FiLogOut } from "react-icons/fi";
import { useForm } from "react-hook-form";
import { FaPlus } from "react-icons/fa";
import { useRouter } from "next/router";
import { OWNER_JOB_TITLES } from "shared/constants";
import {
  OwnerJobTitle,
  CreateOrganizationPostBody,
} from "shared/types/organization";
import { Box, Flex } from "@radix-ui/themes";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";
import { useAuth } from "@/services/auth";
import {
  allowSelfOrgCreation,
  isMultiOrg,
  showMultiOrgSelfSelector,
} from "@/services/env";
import useApi from "@/hooks/useApi";
import Field from "@/components/Forms/Field";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useProject } from "@/services/DefinitionsContext";
import SelectField from "@/components/Forms/SelectField";
import Checkbox from "@/ui/Checkbox";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import style from "./CreateOrJoinOrganization.module.scss";
import WelcomeFrame from "./WelcomeFrame";

const CreateOrJoinOrganization: FC<{
  showFrame?: boolean;
  title?: string;
  subtitle?: string;
}> = ({ showFrame = true, title, subtitle }) => {
  const { data } = useApi<{
    hasOrganizations: boolean;
  }>("/auth/hasorgs");

  const newOrgForm = useForm({
    defaultValues: {
      company: "",
      ownerJobTitle: "" as OwnerJobTitle,
      ownerFeatureFlagUsageIntent: false,
      ownerExperimentUsageIntent: false,
      ownerProductAnalyticsUsageIntent: false,
    },
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState<"create" | "join">("create");
  function switchMode() {
    setMode(mode === "create" ? "join" : "create");
  }

  const { apiCall, logout, setOrgId } = useAuth();
  const { updateUser } = useUser();
  const [, setProject] = useProject();

  const { data: recommendedOrgsData } = useApi<{
    organizations: {
      id: string;
      name: string;
      members: number;
      currentUserIsPending: boolean;
    }[];
  }>(`/user/getRecommendedOrgs`, {
    shouldRun: () => showMultiOrgSelfSelector(),
  });
  const orgs = recommendedOrgsData?.organizations;
  const router = useRouter();

  useEffect(() => {
    if (orgs) {
      setMode("join");
    } else {
      setMode("create");
    }
  }, [orgs]);

  const joinOrgFormSubmit = async (org) => {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp: any = await apiCall("/member", {
        method: "PUT",
        body: JSON.stringify({ orgId: org.id }),
      });
      track("Join Organization");
      updateUser();
      setLoading(false);
      if (resp?.isPending) {
        org.currentUserIsPending = true;
      } else {
        if (setOrgId) {
          setOrgId(org.id);
        }
        try {
          localStorage.setItem("gb-last-picked-org", `"${org.id}"`);
        } catch (e) {
          console.warn("Cannot set gb-last-picked-org");
        }
        router.push("/");
      }
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  };

  if (!data || (showMultiOrgSelfSelector() && !recommendedOrgsData)) {
    return <LoadingOverlay />;
  }

  const showCreate =
    (isMultiOrg() && allowSelfOrgCreation()) || !data.hasOrganizations;

  const showJoin = isMultiOrg() && showMultiOrgSelfSelector() && orgs;

  const leftside = (
    <Flex direction="column" justify="between" height="100%" p="6">
      <Box>
        <a href="https://www.growthbook.io" target="_blank" rel="noreferrer">
          <img
            src="/logo/growth-book-logo-white.svg"
            style={{ maxWidth: "150px" }}
            alt="GrowthBook"
          />
        </a>
      </Box>
      <Box>
        <h1 className="title h1">Welcome to GrowthBook!</h1>
        {showCreate || showJoin ? (
          <p>
            You aren&apos;t part of an organization yet. <br />
            {showCreate && showJoin
              ? `Create or join one here.`
              : showCreate
                ? `Create a new one here.`
                : `Join one here.`}
          </p>
        ) : (
          <p>Ask your admin to invite you to the organization.</p>
        )}
      </Box>
    </Flex>
  );

  const titleCopy = (orgs) => {
    if (title) return title;

    return `We found ${
      orgs.length === 1 ? "your organization" : "possible organizations for you"
    } on GrowthBook!`;
  };

  const subtitleCopy = (orgs) => {
    if (orgs.length === 0) {
      return "There are no other organizations that you are not already a member of.";
    }

    if (subtitle) return subtitle;

    return "Join your organization to get started.";
  };

  const rightSide = (
    <div
      className={`d-flex justify-content-center align-items-center ${style.container}`}
      style={{ height: "100%" }}
    >
      <div style={{ maxWidth: "800px" }}>
        {showCreate || showJoin ? (
          <>
            {mode === "join" && showJoin ? (
              <>
                <div>
                  <h3>{titleCopy(orgs)}</h3>
                  <p className="text-muted">{subtitleCopy(orgs)}</p>
                </div>
                {orgs.map((org) => (
                  <div key={org.id} className={`${style.recommendedOrgBox}`}>
                    <div className={`${style.recommendedOrgRow}`}>
                      <div className={style.recommendedOrgLogo}>
                        <div className={style.recommendedOrgLogoText}>
                          {org.name.slice(0, 1)?.toUpperCase()}
                        </div>
                      </div>
                      <div className={style.recommendedOrgInfo}>
                        <div className={style.recommendedOrgName}>
                          {org.name}
                        </div>
                        <div className={style.recommendedOrgMembers}>
                          {org.members === 1
                            ? `${org.members} member`
                            : `${org.members} members`}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-lg btn-primary"
                        onClick={() => {
                          joinOrgFormSubmit(org);
                        }}
                        disabled={org.currentUserIsPending || false}
                      >
                        {org.currentUserIsPending ? "Pending" : "Join"}
                      </button>
                    </div>
                    {org.currentUserIsPending && (
                      <Callout status="success" mt="2" mb="0">
                        <div className="mb-2">Your membership is pending.</div>
                        <div>
                          Please contact your organization&apos;s admin to
                          approve your membership.
                        </div>
                      </Callout>
                    )}
                  </div>
                ))}
                {showCreate && (
                  <div
                    className={`${style.switchModeButton} btn btn-light mt-3`}
                    onClick={switchMode}
                  >
                    <FaPlus /> <span>Create a new organization instead</span>
                  </div>
                )}
              </>
            ) : (
              <>
                <form
                  onSubmit={newOrgForm.handleSubmit(async (value) => {
                    if (loading) return;
                    setError(null);
                    setLoading(true);
                    try {
                      const body: CreateOrganizationPostBody = {
                        company: value.company,
                        demographicData: {
                          ownerJobTitle: value.ownerJobTitle,
                          ownerUsageIntents: [],
                        },
                      };
                      if (value.ownerFeatureFlagUsageIntent) {
                        body.demographicData?.ownerUsageIntents?.push(
                          "featureFlags",
                        );
                      }
                      if (value.ownerExperimentUsageIntent) {
                        body.demographicData?.ownerUsageIntents?.push(
                          "experiments",
                        );
                      }
                      if (value.ownerProductAnalyticsUsageIntent) {
                        body.demographicData?.ownerUsageIntents?.push(
                          "productAnalytics",
                        );
                      }
                      const resp = await apiCall<{
                        orgId: string;
                        status: number;
                        message?: string;
                        projectId?: string;
                      }>("/organization", {
                        method: "POST",
                        body: JSON.stringify(body),
                      });
                      track("Create Organization");
                      updateUser();
                      if (resp.projectId) {
                        setProject(resp.projectId);
                      }
                      setLoading(false);
                    } catch (e) {
                      setError(e.message);
                      setLoading(false);
                    }
                  })}
                >
                  <div>
                    <h2>Create {orgs ? "a new" : "an"} organization</h2>
                    <p className={`mb-4 ${style.textMid}`}>
                      Help us tailor your onboarding experience.
                    </p>
                  </div>
                  <Field
                    label={
                      <div className="font-weight-bold">
                        Organization Name
                        <span className="text-danger ml-1">*</span>
                      </div>
                    }
                    required
                    autoFocus
                    placeholder="My Company"
                    autoComplete="company"
                    minLength={3}
                    maxLength={60}
                    {...newOrgForm.register("company")}
                  />
                  <SelectField
                    label="Your role"
                    labelClassName="font-weight-bold"
                    markRequired
                    required
                    sort={false}
                    options={Object.entries(OWNER_JOB_TITLES).map(
                      ([key, title]) => ({
                        label: title,
                        value: key,
                      }),
                    )}
                    onChange={(value: OwnerJobTitle) => {
                      newOrgForm.setValue("ownerJobTitle", value);
                    }}
                    value={newOrgForm.watch("ownerJobTitle")}
                  />
                  <div className="mt-4 font-weight-bold">
                    How will your team use Growthbook?
                  </div>
                  <div>
                    <Checkbox
                      mt="2"
                      size="md"
                      label="Manage feature flags"
                      value={!!newOrgForm.watch("ownerFeatureFlagUsageIntent")}
                      setValue={(v) => {
                        newOrgForm.setValue(
                          "ownerFeatureFlagUsageIntent",
                          v === true,
                        );
                      }}
                    />
                  </div>
                  <div>
                    <Checkbox
                      mt="2"
                      size="md"
                      label="Run experiments"
                      value={!!newOrgForm.watch("ownerExperimentUsageIntent")}
                      setValue={(v) => {
                        newOrgForm.setValue(
                          "ownerExperimentUsageIntent",
                          v === true,
                        );
                      }}
                    />
                  </div>
                  <div>
                    <Checkbox
                      mt="2"
                      mb="6"
                      size="md"
                      label="Product analytics"
                      value={
                        !!newOrgForm.watch("ownerProductAnalyticsUsageIntent")
                      }
                      setValue={(v) => {
                        newOrgForm.setValue(
                          "ownerProductAnalyticsUsageIntent",
                          v === true,
                        );
                      }}
                    />
                  </div>
                  <button
                    className={`btn btn-primary btn-block btn-lg`}
                    type="submit"
                  >
                    Create organization
                  </button>
                  {error && (
                    <Callout status="error" mt="2">
                      {error}
                    </Callout>
                  )}
                </form>

                {showJoin && (
                  <div
                    className={`${style.switchModeButton} btn btn-light mt-5`}
                    onClick={switchMode}
                  >
                    <FaPlus /> <span>Join an organization instead</span>
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <div>
            <h3 className="h2">Invitation Required</h3>
            <Callout status="error">
              You must be invited by an administrator in order to use
              GrowthBook.
            </Callout>
          </div>
        )}{" "}
      </div>
    </div>
  );

  if (showFrame) {
    return (
      <>
        <WelcomeFrame
          leftside={leftside}
          loading={loading}
          pathName="/create-org"
        >
          <Link
            className="logout-link"
            onClick={() => {
              setLoading(true);
              logout();
            }}
          >
            <FiLogOut /> log out
          </Link>
          {rightSide}
        </WelcomeFrame>
      </>
    );
  } else {
    return rightSide;
  }
};

export default CreateOrJoinOrganization;
