import { ReactElement, useContext, useState } from "react";
import { useAuth } from "../../services/auth";
import track from "../../services/track";
import WelcomeFrame from "./WelcomeFrame";
import { UserContext } from "../ProtectedPage";
import { FiLogOut } from "react-icons/fi";
import { useForm } from "react-hook-form";
import Field from "../Forms/Field";
import { isCloud } from "../../services/env";

export default function CreateOrganization(): ReactElement {
  const form = useForm({
    defaultValues: {
      company: "",
    },
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { apiCall, logout } = useAuth();
  const { update } = useContext(UserContext);

  const leftside = (
    <>
      <h1 className="title h1">Welcome to GrowthBook</h1>
      {isCloud() ? (
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
        {isCloud() ? (
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
                update();
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
              {...form.register("company")}
              error={error}
            />
            <button
              className={`btn btn-primary btn-block btn-lg`}
              type="submit"
            >
              Create organization
            </button>
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
