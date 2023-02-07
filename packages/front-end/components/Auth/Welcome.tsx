import { ReactElement, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/router";
import track from "@/services/track";
import { getApiHost } from "@/services/env";
import Field from "../Forms/Field";
import WelcomeFrame from "./WelcomeFrame";

export default function Welcome({
  onSuccess,
  firstTime = false,
}: {
  onSuccess: (token: string) => void;
  firstTime?: boolean;
}): ReactElement {
  const [state, setState] = useState<
    "login" | "register" | "forgot" | "forgotSuccess" | "firsttime"
  >(firstTime ? "firsttime" : "login");
  const form = useForm({
    defaultValues: {
      companyname: "",
      name: "",
      email: "",
      password: "",
    },
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [welcomeMsgIndex] = useState(Math.floor(Math.random() * 4));
  const { pathname } = useRouter();

  useEffect(() => {
    if (pathname === "/invitation") {
      setState("register");
    }
  }, [pathname]);

  const welcomeMsg = [
    <>Welcome to GrowthBook!</>,
    <>Hello! Welcome to GrowthBook</>,
    "Hello there, Welcome!",
    "Hey there!",
  ];
  const cta =
    state === "login"
      ? "Log in"
      : state === "register"
      ? "Create Account"
      : state === "forgot"
      ? "Look up"
      : state === "firsttime"
      ? "Sign up"
      : "Submit";

  const submit =
    state === "forgotSuccess"
      ? undefined
      : form.handleSubmit(async (data) => {
          const res = await fetch(getApiHost() + "/auth/" + state, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify(data),
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
          if (state === "firsttime") {
            track("Register-first");
          }
          if (state === "forgot") {
            setState("forgotSuccess");
          } else {
            onSuccess(json.token);
          }
        });

  const welcomeContent =
    state === "login" ? (
      <p>Welcome back, lets get started with some experiments</p>
    ) : state === "register" ? (
      <p>
        Let&apos;s run some experiments! Enter your information to get started.
      </p>
    ) : state === "forgot" ? (
      <p>Happens to the best of us</p>
    ) : state === "firsttime" ? (
      <>
        <p>
          Getting started with GrowthBook only takes a few minutes. <br />
          To start, we&apos;ll need a bit of information about you.
        </p>
      </>
    ) : (
      <p>Let&apos;s get started with some experimentation</p>
    );

  const leftside = (
    <>
      <h1 className="title h1">{welcomeMsg[welcomeMsgIndex]}</h1>
      {welcomeContent}
    </>
  );

  const email = form.watch("email");

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
          {state === "register" && (
            <div>
              <h3 className="h2">Register</h3>
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
          {state === "firsttime" && (
            <div>
              <h3 className="h2">Set up your first account</h3>
              <p>
                This information stays on your servers and is never shared.{" "}
                <br />
                You can invite the rest of your team later.
              </p>
            </div>
          )}
          {state === "login" && (
            <div>
              <h3 className="h2">Log In</h3>
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
              <h3 className="h2">Forgot Password</h3>
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
              <h3 className="h2">Forgot Password</h3>
              <div className="alert alert-success">
                Password reset link sent to <strong>{email}</strong>.
              </div>
              <p>Click the link in the email to reset your password.</p>
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
          {state === "firsttime" && (
            <Field
              label="Company name"
              required
              autoFocus
              minLength={2}
              {...form.register("companyname")}
            />
          )}
          {(state === "register" || state === "firsttime") && (
            <Field
              label="Name"
              required
              {...form.register("name")}
              autoFocus={state === "register"}
              autoComplete="name"
              minLength={2}
            />
          )}
          {(state === "login" ||
            state === "register" ||
            state === "forgot" ||
            state === "firsttime") && (
            <Field
              label="Email Address"
              required
              type="email"
              {...form.register("email")}
              autoFocus={state === "login" || state === "forgot"}
              autoComplete="username"
            />
          )}
          {(state === "login" ||
            state === "register" ||
            state === "firsttime") && (
            <Field
              label="Password"
              required
              type="password"
              {...form.register("password")}
              autoComplete={
                state === "login" ? "current-password" : "new-password"
              }
              minLength={8}
              helpText={
                state === "login" ? (
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setState("forgot");
                    }}
                  >
                    Forgot Password?
                  </a>
                ) : null
              }
            />
          )}
          {error && <div className="alert alert-danger mr-auto">{error}</div>}
          <button className={`btn btn-primary btn-block btn-lg`} type="submit">
            {cta}
          </button>
        </form>
      </WelcomeFrame>
    </>
  );
}
