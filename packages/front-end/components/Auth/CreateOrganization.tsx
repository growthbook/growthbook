import { ReactElement, useContext, useState } from "react";
import useForm from "../../hooks/useForm";
import { useAuth } from "../../services/auth";
import track from "../../services/track";
import WelcomeFrame from "./WelcomeFrame";
import { UserContext } from "../ProtectedPage";

export default function CreateOrganization(): ReactElement {
  const [value, inputProps] = useForm({
    company: "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { apiCall } = useAuth();
  const { update } = useContext(UserContext);

  const submit = async () => {
    await apiCall("/organization", {
      method: "POST",
      body: JSON.stringify({
        company: value.company,
      }),
    });
    track("Create Organization");
    update();
  };

  const leftside = (
    <>
      <h1 className="title h1">Welcome to Growth&nbsp;Book</h1>
      <p>
        you aren&apos;t part of an organization yet. <br />
        Create a new one here.
      </p>
    </>
  );
  return (
    <>
      <WelcomeFrame leftside={leftside} loading={loading}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (loading) return;
            setError(null);
            setLoading(true);
            try {
              await submit();
              setLoading(false);
            } catch (e) {
              setError(e.message);
              setLoading(false);
            }
          }}
        >
          <div>
            <h3 className="h2">Create organization</h3>
            <p className="text-muted">You can edit this at any time.</p>
          </div>

          <div className="form-group">
            Company name
            <input
              required
              type="text"
              name="companyname"
              autoFocus
              autoComplete="companyname"
              minLength={3}
              {...inputProps.company}
              className="form-control"
            />
          </div>

          {error && <div className="alert alert-danger mr-auto">{error}</div>}
          <button className={`btn btn-primary btn-block btn-lg`} type="submit">
            Create organization
          </button>
        </form>
      </WelcomeFrame>
    </>
  );
}
