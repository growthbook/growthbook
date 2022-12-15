import { ReactElement, useState } from "react";
import { useForm } from "react-hook-form";
import track from "@/services/track";
import { getApiHost } from "@/services/env";
import Modal from "../Modal";
import Field from "../Forms/Field";

export default function Auth({
  onSuccess,
}: {
  onSuccess: (token: string) => void;
}): ReactElement {
  const [state, setState] = useState<
    "login" | "register" | "forgot" | "forgotSuccess"
  >("login");

  const form = useForm({
    defaultValues: {
      name: "",
      email: "",
      password: "",
    },
  });

  return (
    <Modal
      solidOverlay={true}
      open={true}
      submit={
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

              if (state === "forgot") {
                setState("forgotSuccess");
              } else {
                onSuccess(json.token);
              }
            })
      }
      cta={"Submit"}
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
            Password reset link sent to <strong>{form.watch("email")}</strong>.
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
      {state === "register" && (
        <Field
          required
          label="Name"
          autoComplete="name"
          minLength={2}
          {...form.register("name")}
        />
      )}
      {(state === "login" || state === "register" || state === "forgot") && (
        <Field
          required
          label="Email Address"
          type="email"
          autoComplete="username"
          {...form.register("email")}
        />
      )}
      {(state === "login" || state === "register") && (
        <Field
          required
          label="Password"
          type="password"
          autoComplete={state === "login" ? "current-password" : "new-password"}
          minLength={8}
          {...form.register("password")}
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
    </Modal>
  );
}
