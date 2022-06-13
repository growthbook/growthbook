import React from "react";
import Field from "../Forms/Field";

export function ResetUserPassword({
  setUpdatedPassword,
  updateOtherUserPassword,
}) {
  return (
    <>
      <Field
        placeholder="Enter a new password"
        type="password"
        required
        minLength={8}
        autoComplete="new-password"
        onChange={(e) => setUpdatedPassword(e.target.value)}
      />
      <button
        style={{ marginTop: "none" }}
        className="btn btn-primary mt-3 align-middle"
        onClick={updateOtherUserPassword}
      >
        Reset Password
      </button>
    </>
  );
}
