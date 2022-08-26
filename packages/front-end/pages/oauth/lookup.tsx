import { useRouter } from "next/router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import oidcAuthSource, {
  lookupByEmail,
} from "../../authSources/oidcAuthSource";
import Field from "../../components/Forms/Field";
import { GBCircleArrowLeft } from "../../components/Icons";
import LoadingOverlay from "../../components/LoadingOverlay";
import { setLastSSOConnectionId } from "../../services/auth";

export default function OAuthLookup() {
  const form = useForm({
    defaultValues: {
      email: "",
    },
  });

  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  return (
    <div className="container">
      <h1>Enterprise SSO Login</h1>
      <p>
        Enter your email address and you will be redirected to your
        company&apos;s SSO portal, if configured.
      </p>
      <form
        className="form"
        onSubmit={form.handleSubmit(async ({ email }) => {
          setLoading(true);
          setError("");
          try {
            // This will lookup the SSO config id and store it in a cookie
            await lookupByEmail(email);
            // This will redirect to the IdP
            await oidcAuthSource.login({
              router,
              setAuthComponent: () => {
                /*Do nothing*/
              },
            });
          } catch (e) {
            setError(
              e.message ||
                "Could not find an SSO connection for that email address."
            );
          }
          setLoading(false);
        })}
      >
        {loading && <LoadingOverlay />}
        {error && <div className="alert alert-danger">{error}</div>}
        <Field label="Email Address" {...form.register("email")} type="email" />
        <button type="submit" className="btn btn-primary">
          Submit
        </button>
        <div>
          <a
            href="#"
            onClick={async (e) => {
              e.preventDefault();
              setLoading(true);
              setLastSSOConnectionId("");
              try {
                await oidcAuthSource.login({
                  router,
                  setAuthComponent: () => {
                    /* Do nothing */
                  },
                });
              } catch (e) {
                console.error(e);
              }
              setLoading(false);
            }}
          >
            <GBCircleArrowLeft /> back to regular login page
          </a>
        </div>
      </form>
    </div>
  );
}

// Skip the normal authentication flow
OAuthLookup.preAuth = true;
