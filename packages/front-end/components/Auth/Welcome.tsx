import { ReactElement, useState } from "react";
import useForm from "../../hooks/useForm";
import track from "../../services/track";
import { getApiHost } from "../../services/utils";
import LoadingOverlay from "../../components/LoadingOverlay";

const apiHost = getApiHost();

export default function Auth({
  onSuccess,
}: {
  onSuccess: (token: string) => void;
}): ReactElement {
  const [state, setState] = useState<
    "login" | "register" | "forgot" | "forgotSuccess"
  >("login");
  const [value, inputProps] = useForm({
    name: "",
    email: "",
    password: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [welcomeMsgIndex] = useState(Math.floor(Math.random() * 4));

  const welcomeMsg = [
    "Welcome to Growth Book!",
    "Hello! Welcome to Growth Book",
    "Hello there, Welcome!",
    "Hey there!",
  ];
  const cta =
    state === "login"
      ? "Log in"
      : state === "register"
      ? "Sign in"
      : state === "forgot"
      ? "Look up"
      : "Submit";

  const submit =
    state === "forgotSuccess"
      ? undefined
      : async () => {
          const res = await fetch(apiHost + "/auth/" + state, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify({
              email: value.email,
              name: value.name,
              password: value.password,
            }),
          });
          const json: {
            status: number;
            token: string;
            message?: string;
          } = await res.json();
          if (json.status > 200) {
            throw new Error(
              json.message || "An error occurred. Please try again."
            );
          }

          if (state === "register") {
            track("Register");
          }

          if (state === "forgot") {
            setState("forgotSuccess");
          } else {
            onSuccess(json.token);
          }
        };

  return (
    <>
      <div className="welcome">
        {loading && <LoadingOverlay />}
        <div className="row full-height align-items-stretch d-flex flex-fill d-flex justify-content-start">
          <div className="col-sm-5 intro-side ">
            <div className="ghosted-logo"></div>
            <div className="p-sm-1 p-md-3 pt-3 pt-sm-3 pt-md-5 d-flex align-items-center justify-content-center h-100">
              <div className="text-center">
                <h1 className="title h1">{welcomeMsg[welcomeMsgIndex]}</h1>
                <p>Let&apos;s get started with some experimentation.</p>
              </div>
            </div>
            <div className="logo">
              <a
                href="https://www.growthbook.io"
                target="_blank"
                rel="noreferrer"
              >
                <img
                  src="/logo/growth-book-logo-white.png"
                  style={{ maxWidth: "150px" }}
                />
              </a>
            </div>
          </div>
          <div className="col-sm-7 form-side ">
            <div className="welcomemodal p-4 h-100">
              <div className="h-100 align-items-center d-flex ">
                <div className="formwrap">
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
                    {state === "register" && (
                      <div>
                        <h3>Register</h3>
                        <p>
                          Already have an account?{" "}
                          <a
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              setState("login");
                            }}
                          >
                            Log In
                          </a>
                        </p>
                      </div>
                    )}
                    {state === "login" && (
                      <div>
                        <h3>Log In</h3>
                        <p>
                          Don&apos;t have an account yet?{" "}
                          <a
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              setState("register");
                            }}
                          >
                            Register
                          </a>
                        </p>
                      </div>
                    )}
                    {state === "forgot" && (
                      <div>
                        <h3>Forgot Password</h3>
                        <p>
                          <a
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              setState("login");
                            }}
                          >
                            Go back to Log In
                          </a>
                        </p>
                      </div>
                    )}
                    {state === "forgotSuccess" && (
                      <div>
                        <h3>Forgot Password</h3>
                        <div className="alert alert-success">
                          Password reset link sent to{" "}
                          <strong>{value.email}</strong>.
                        </div>
                        <p>
                          Click the link in the email to reset your password.
                        </p>
                        <p>
                          Sent to the wrong email or need to resend?{" "}
                          <a
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              setState("forgot");
                            }}
                          >
                            Go Back
                          </a>
                        </p>
                      </div>
                    )}
                    {state === "register" && (
                      <div className="form-group">
                        Name
                        <input
                          required
                          type="text"
                          name="name"
                          autoComplete="name"
                          minLength={2}
                          {...inputProps.name}
                          className="form-control"
                        />
                      </div>
                    )}
                    {(state === "login" ||
                      state === "register" ||
                      state === "forgot") && (
                      <div className="form-group">
                        Email Address
                        <input
                          required
                          type="email"
                          name="email"
                          autoComplete="username"
                          {...inputProps.email}
                          className="form-control"
                        />
                      </div>
                    )}
                    {(state === "login" || state === "register") && (
                      <div className="form-group">
                        Password
                        <input
                          required
                          type="password"
                          name="password"
                          autoComplete={
                            state === "login"
                              ? "current-password"
                              : "new-password"
                          }
                          minLength={8}
                          {...inputProps.password}
                          className="form-control"
                        />
                        {state === "login" && (
                          <small className="form-text text-muted">
                            <a
                              href="#"
                              onClick={(e) => {
                                e.preventDefault();
                                setState("forgot");
                              }}
                            >
                              Forgot Password?
                            </a>
                          </small>
                        )}
                      </div>
                    )}
                    {error && (
                      <div className="alert alert-danger mr-auto">{error}</div>
                    )}
                    <button className={`btn btn-primary w-100`} type="submit">
                      {cta}
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
