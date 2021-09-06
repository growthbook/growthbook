import { ReactElement, useState } from "react";
import track from "../../services/track";
import { getApiHost } from "../../services/env";
import Modal from "../Modal";
import { useForm } from "react-hook-form";

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
      form={form}
      submit={
        state === "forgotSuccess"
          ? undefined
          : async (data) => {
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
            }
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
            Password reset link sent to{" "}
            <strong>{form.getValues().email}</strong>.
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
        <div className="form-group">
          Name
          <input
            required
            type="text"
            name="name"
            autoComplete="name"
            minLength={2}
            {...form.register("name")}
            className="form-control"
          />
        </div>
      )}
      {(state === "login" || state === "register" || state === "forgot") && (
        <div className="form-group">
          Email Address
          <input
            required
            type="email"
            name="email"
            autoComplete="username"
            {...form.register("email")}
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
              state === "login" ? "current-password" : "new-password"
            }
            minLength={8}
            {...form.register("password")}
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
    </Modal>
  );
}
