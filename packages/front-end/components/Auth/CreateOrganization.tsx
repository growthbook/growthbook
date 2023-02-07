import { ReactElement, useState } from "react";
import { FiLogOut } from "react-icons/fi";
import { useForm } from "react-hook-form";
import { FaPlus } from "react-icons/fa";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";
import { useAuth } from "@/services/auth";
import { isCloud } from "@/services/env";
import useApi from "@/hooks/useApi";
import Field from "../Forms/Field";
import LoadingOverlay from "../LoadingOverlay";
import WelcomeFrame from "./WelcomeFrame";

import style from "./CreateOrganization.module.scss";

export default function CreateOrganization(): ReactElement {
  const { data } = useApi<{
    hasOrganizations: boolean;
  }>("/auth/hasorgs");

  const form = useForm({
    defaultValues: {
      company: "",
    },
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { apiCall, logout } = useAuth();
  const { updateUser } = useUser();

  const { data: org } = useApi(`/user/getRecommendedOrg`);

  console.log(org);

  if (!data) {
    return <LoadingOverlay />;
  }

  const leftside = (
    <>
      <h1 className="title h1">Welcome to GrowthBook</h1>
      {isCloud() || !data.hasOrganizations ? (
        <p>
          You aren&apos;t part of an organization yet. <br />
          Create a new one here.
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
        {isCloud() || !data.hasOrganizations ? (
          <form
            onSubmit={form.handleSubmit(async (value) => {
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
            {org?.id && org?.name ? (
              <>
                <div>
                  <h3>We found your organization on GrowthBook!</h3>
                  <p className="text-muted">
                    Join your organization to get started.
                  </p>
                </div>
                <div className={`${style.recommendedOrgBox} mt-5 mb-3`}>
                  <div className={style.recommendedOrgLogo}>
                    <div className={style.recommendedOrgLogoText}>
                      {org.name.slice(0, 1).toUpperCase()}
                    </div>
                  </div>
                  <div className={style.recommendedOrgInfo}>
                    <div className={style.recommendedOrgName}>{org.name}</div>
                    <div className={style.recommendedOrgMembers}>
                      {org.members === 1
                        ? `${org.members} member`
                        : `${org.members} members`}
                    </div>
                  </div>
                  <div className="btn btn-primary">Join</div>
                </div>
                <div
                  className={`${style.switchModeButton} btn btn-light mt-3`}
                  onClick={() => {
                    // change mode...
                  }}
                >
                  <FaPlus /> <span>Create a new organization instead</span>
                </div>
              </>
            ) : (
              <>
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
                  {...form.register("company")}
                  error={error}
                />
                <button
                  className={`btn btn-primary btn-block btn-lg`}
                  type="submit"
                >
                  Create organization
                </button>
              </>
            )}
          </form>
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
