import { FC, useEffect, useState } from "react";
import { FiLogOut } from "react-icons/fi";
import { useForm } from "react-hook-form";
import { PiPlusBold } from "react-icons/pi";
import { useRouter } from "next/router";
import { OWNER_JOB_TITLES } from "shared/constants";
import {
  OwnerJobTitle,
  CreateOrganizationPostBody,
} from "shared/types/organization";
import { Box, Flex } from "@radix-ui/themes";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
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
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import Avatar from "@/ui/Avatar";
import Text from "@/ui/Text";
import style from "./CreateOrJoinOrganization.module.scss";
import WelcomeFrame from "./WelcomeFrame";

const CreateOrJoinOrganization: FC<{
  showFrame?: boolean;
  title?: string;
  subtitle?: string;
}> = ({ showFrame = true, title, subtitle }) => {
  const { t } = useLingui();
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
  const [joiningOrgId, setJoiningOrgId] = useState<string | null>(null);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState<"create" | "join">("create");
  const orgActionPending = loading || joiningOrgId !== null;

  function switchMode() {
    if (orgActionPending) return;
    setError(null);
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

  const joinOrgFormSubmit = async (org: {
    id: string;
    currentUserIsPending: boolean;
  }) => {
    if (loading || joiningOrgId) return;
    setError(null);
    setJoiningOrgId(org.id);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp: any = await apiCall("/member", {
        method: "PUT",
        body: JSON.stringify({ orgId: org.id }),
      });
      track("Join Organization");
      updateUser();
      if (resp?.isPending) {
        org.currentUserIsPending = true;
        setJoiningOrgId(null);
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
      setJoiningOrgId(null);
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
        <h1 className="title h1">
          <Trans>Welcome to GrowthBook!</Trans>
        </h1>
        {showCreate || showJoin ? (
          <p>
            <Trans>You aren&apos;t part of an organization yet.</Trans> <br />
            {showCreate && showJoin
              ? t`Create or join one here.`
              : showCreate
                ? t`Create a new one here.`
                : t`Join one here.`}
          </p>
        ) : (
          <p>
            <Trans>Ask your admin to invite you to the organization.</Trans>
          </p>
        )}
      </Box>
    </Flex>
  );

  const titleCopy = (orgs) => {
    if (title) return title;

    return orgs.length === 1
      ? t`We found your organization on GrowthBook!`
      : t`We found possible organizations for you on GrowthBook!`;
  };

  const subtitleCopy = (orgs) => {
    if (orgs.length === 0) {
      return t`There are no other organizations that you are not already a member of.`;
    }

    if (subtitle) return subtitle;

    return t`Join your organization to get started.`;
  };

  const rightSide = (
    <div
      className={`d-flex justify-content-center align-items-center ${style.container}`}
      style={{ height: "100%" }}
    >
      <div className={style.panel}>
        {showCreate || showJoin ? (
          <>
            {mode === "join" && showJoin ? (
              <>
                <div>
                  <h3>{titleCopy(orgs)}</h3>
                  <p className="text-muted">{subtitleCopy(orgs)}</p>
                </div>
                {orgs.map((org) => {
                  const memberCount = org.members;
                  return (
                    <div key={org.id} className={style.recommendedOrgBox}>
                      <Flex align="center" gap="3">
                        <Avatar size="lg" color="green" variant="soft">
                          {org.name.slice(0, 1)?.toUpperCase()}
                        </Avatar>
                        <Flex direction="column" flexGrow="1" minWidth="0">
                          <Text
                            as="div"
                            size="md"
                            weight="semibold"
                            overflowWrap="break-word"
                          >
                            {org.name}
                          </Text>
                          <Text as="div" size="sm" color="text-mid">
                            <Plural
                              value={memberCount}
                              one="# member"
                              other="# members"
                            />
                          </Text>
                        </Flex>
                        <Flex flexShrink="0">
                          <Button
                            size="md"
                            loading={joiningOrgId === org.id}
                            disabled={
                              org.currentUserIsPending ||
                              loading ||
                              (joiningOrgId !== null && joiningOrgId !== org.id)
                            }
                            onClick={() => joinOrgFormSubmit(org)}
                          >
                            {org.currentUserIsPending ? (
                              <Trans>Pending</Trans>
                            ) : (
                              <Trans>Join</Trans>
                            )}
                          </Button>
                        </Flex>
                      </Flex>
                      {org.currentUserIsPending && (
                        <Callout status="success" mt="2" mb="0">
                          <div className="mb-2">
                            <Trans>Your membership is pending.</Trans>
                          </div>
                          <div>
                            <Trans>
                              Please contact your organization&apos;s admin to
                              approve your membership.
                            </Trans>
                          </div>
                        </Callout>
                      )}
                    </div>
                  );
                })}
                {error && (
                  <Callout status="error" mt="2">
                    {error}
                  </Callout>
                )}
                {showCreate && (
                  <Button
                    variant="soft"
                    color="gray"
                    mt="4"
                    style={{ width: "100%" }}
                    icon={<PiPlusBold />}
                    disabled={orgActionPending}
                    onClick={switchMode}
                  >
                    <Trans>Create a new organization instead</Trans>
                  </Button>
                )}
              </>
            ) : (
              <>
                <form
                  onSubmit={newOrgForm.handleSubmit(async (value) => {
                    if (loading || joiningOrgId) return;
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
                      if (setOrgId) {
                        setOrgId(resp.orgId);
                      }
                      try {
                        localStorage.setItem(
                          "gb-last-picked-org",
                          `"${resp.orgId}"`,
                        );
                      } catch (e) {
                        console.warn("Cannot set gb-last-picked-org");
                      }
                      router.push("/");
                    } catch (e) {
                      setError(e.message);
                      setLoading(false);
                    }
                  })}
                >
                  <div>
                    <h2>
                      {orgs ? (
                        <Trans>Create a new organization</Trans>
                      ) : (
                        <Trans>Create an organization</Trans>
                      )}
                    </h2>
                    <p className={`mb-4 ${style.textMid}`}>
                      <Trans>Help us tailor your onboarding experience.</Trans>
                    </p>
                  </div>
                  <Field
                    size="legacy"
                    label={
                      <div className="font-weight-bold">
                        <Trans>Organization Name</Trans>
                        <span className="text-danger ml-1">*</span>
                      </div>
                    }
                    required
                    autoFocus
                    placeholder={t`My Company`}
                    autoComplete="company"
                    minLength={3}
                    maxLength={60}
                    {...newOrgForm.register("company")}
                  />
                  <SelectField
                    size="legacy"
                    label={t`Your role`}
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
                    <Trans>How will your team use Growthbook?</Trans>
                  </div>
                  <div>
                    <Checkbox
                      mt="2"
                      size="md"
                      label={t`Manage feature flags`}
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
                      label={t`Run experiments`}
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
                      label={t`Product analytics`}
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
                  <Button
                    type="submit"
                    size="lg"
                    loading={loading}
                    disabled={joiningOrgId !== null}
                    style={{ width: "100%" }}
                  >
                    <Trans>Create organization</Trans>
                  </Button>
                  {error && (
                    <Callout status="error" mt="2">
                      {error}
                    </Callout>
                  )}
                </form>

                {showJoin && (
                  <Button
                    variant="soft"
                    color="gray"
                    mt="8"
                    style={{ width: "100%" }}
                    icon={<PiPlusBold />}
                    disabled={orgActionPending}
                    onClick={switchMode}
                  >
                    <Trans>Join an organization instead</Trans>
                  </Button>
                )}
              </>
            )}
          </>
        ) : (
          <div>
            <h3 className="h2">
              <Trans>Invitation Required</Trans>
            </h3>
            <Callout status="error">
              <Trans>
                You must be invited by an administrator in order to use
                GrowthBook.
              </Trans>
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
          <a
            className="logout-link"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setLoading(true);
              logout();
            }}
          >
            <FiLogOut /> <Trans>log out</Trans>
          </a>
          {rightSide}
        </WelcomeFrame>
      </>
    );
  } else {
    return rightSide;
  }
};

export default CreateOrJoinOrganization;
