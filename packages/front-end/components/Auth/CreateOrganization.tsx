import { FC, useEffect, useState } from "react";
import { FiLogOut } from "react-icons/fi";
import { useForm } from "react-hook-form";
import { FaCheck, FaPlus } from "react-icons/fa";
import { useRouter } from "next/router";
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
import WelcomeFrame from "./WelcomeFrame";

import style from "./CreateOrganization.module.scss";

const CreateOrganization: FC<{
  showFrame?: boolean;
  title?: string;
  subtitle?: string;
}> = ({ showFrame = true, title = "", subtitle = "" }) => {
  const { data } = useApi<{
    hasOrganizations: boolean;
  }>("/auth/hasorgs");

  const newOrgForm = useForm({
    defaultValues: {
      company: "",
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

  const { data: recommendedOrgsData } = useApi<{
    organizations: [
      {
        id: string;
        name: string;
        members: number;
        currentUserIsPending: boolean;
        currentUserIsMember: boolean;
      }
    ];
  }>(showMultiOrgSelfSelector() ? `/user/getRecommendedOrgs` : null);
  const orgs = recommendedOrgsData?.organizations;
  const joinableOrgs = orgs?.filter((org) => !org.currentUserIsMember);
  const router = useRouter();

  useEffect(() => {
    if (orgs) {
      setMode("join");
    } else {
      setMode("create");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const showJoin = isMultiOrg() && showMultiOrgSelfSelector() && joinableOrgs;

  const leftside = (
    <>
      <h1 className="title h1">Welcome to GrowthBook</h1>
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
    </>
  );

  const rightSide = (
    <div
      className="d-flex justify-content-center align-items-center"
      style={{ height: "100%" }}
    >
      <div style={{ maxWidth: "800px" }}>
        {showCreate || showJoin ? (
          <>
            {mode === "join" && showJoin ? (
              <>
                <div>
                  <h3>
                    {title
                      ? title
                      : `We found 
                    ${
                      orgs.length === 1
                        ? "your organization"
                        : "possible organizations for you"
                    } 
                    on GrowthBook!`}
                  </h3>
                  <p className="text-muted">
                    {joinableOrgs.length === 0
                      ? "There are no other organizations that you are not already a member of."
                      : subtitle
                      ? subtitle
                      : "Join your organization to get started."}
                  </p>
                </div>
                {joinableOrgs?.map((org) => (
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
                        disabled={
                          org.currentUserIsPending ||
                          org.currentUserIsMember ||
                          false
                        }
                      >
                        {org.currentUserIsPending ? "Pending" : "Join"}
                      </button>
                    </div>
                    {org.currentUserIsPending && (
                      <div className="alert alert-success mt-2 mb-0">
                        <div className="mb-2">
                          <FaCheck /> Your membership is pending.
                        </div>
                        <div>
                          Please contact your organization&apos;s admin to
                          approve your membership.
                        </div>
                      </div>
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
                      await apiCall("/organization", {
                        method: "POST",
                        body: JSON.stringify(value),
                      });
                      track("Create Organization");
                      updateUser();
                      setLoading(false);
                    } catch (e) {
                      setError(e.message);
                      setLoading(false);
                    }
                  })}
                >
                  <div>
                    <h3 className="h2">
                      Create {orgs ? "a new" : ""} organization
                    </h3>
                    <p className="text-muted">
                      You can edit the name at any time.
                    </p>
                  </div>
                  <Field
                    label="Company name"
                    required
                    autoFocus
                    autoComplete="company"
                    minLength={3}
                    {...newOrgForm.register("company")}
                    error={error}
                  />
                  <button
                    className={`btn btn-primary btn-block btn-lg`}
                    type="submit"
                  >
                    Create organization
                  </button>
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
            <div className="alert alert-danger">
              You must be invited by an administrator in order to use
              GrowthBook.
            </div>
          </div>
        )}{" "}
      </div>
    </div>
  );

  if (showFrame) {
    return (
      <>
        <WelcomeFrame leftside={leftside} loading={loading}>
          <a
            className="logout-link"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setLoading(true);
              logout();
            }}
          >
            <FiLogOut /> log out
          </a>
          {rightSide}
        </WelcomeFrame>
      </>
    );
  } else {
    return rightSide;
  }
};

export default CreateOrganization;
