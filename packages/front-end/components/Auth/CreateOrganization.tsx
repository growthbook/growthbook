import { ReactElement, useEffect, useState } from "react";
import { FiLogOut } from "react-icons/fi";
import { useForm } from "react-hook-form";
import { FaCheck, FaPlus } from "react-icons/fa";
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

export default function CreateOrganization(): ReactElement {
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

  const { apiCall, logout } = useAuth();
  const { updateUser } = useUser();

  const { data: recommendedOrgsData } = useApi<{
    organizations: [
      {
        id: string;
        name: string;
        members: number;
        currentUserIsPending: boolean;
      }
    ];
  }>(showMultiOrgSelfSelector() ? `/user/getRecommendedOrgs` : null);
  const orgs = recommendedOrgsData?.organizations;

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
      if (resp?.isPending && orgs) {
        org.currentUserIsPending = true;
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
        {showCreate || showJoin ? (
          <>
            {mode === "join" && showJoin ? (
              <>
                <div>
                  <h3>
                    We found{" "}
                    {orgs.length === 1
                      ? "your organization"
                      : "possible organizations for you"}{" "}
                    on GrowthBook!
                  </h3>
                  <p className="text-muted">
                    Join your organization to get started.
                  </p>
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
                    <h3 className="h2">Create organization</h3>
                    <p className="text-muted">You can edit this at any time.</p>
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
        )}
      </WelcomeFrame>
    </>
  );
}
