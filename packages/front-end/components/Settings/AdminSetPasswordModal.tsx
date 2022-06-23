import React, { useState } from "react";
import Field from "../Forms/Field";
import Modal from "../Modal";
import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import type { MemberInfo } from "./MemberList";

type Props = {
  member: MemberInfo;
  close: () => void;
};

export default function AdminSetPasswordModal({ member, close }: Props) {
  const [passwordResetSuccess, setPasswordResetSuccess] = useState(false);
  const { apiCall } = useAuth();
  const form = useForm({
    defaultValues: {
      updatedPassword: "",
    },
  });

  return (
    <Modal
      close={close}
      header="Change Password"
      open={true}
      autoCloseOnSubmit={false}
      closeCta={passwordResetSuccess ? "Close" : "Cancel"}
      submit={
        passwordResetSuccess
          ? null
          : form.handleSubmit(async (data) => {
              await apiCall(`/member/${member.id}/admin-password-reset`, {
                method: "PUT",
                credentials: "include",
                body: JSON.stringify(data),
              });
              setPasswordResetSuccess(true);
            })
      }
    >
      <p>
        Change password for <strong>{member.name}</strong>:
      </p>
      {passwordResetSuccess ? (
        <div className="alert alert-success">
          Password successfully changed.
        </div>
      ) : (
        <Field
          placeholder="Enter a new password"
          type="password"
          required
          minLength={8}
          {...form.register("updatedPassword")}
        />
      )}
    </Modal>
  );
}
