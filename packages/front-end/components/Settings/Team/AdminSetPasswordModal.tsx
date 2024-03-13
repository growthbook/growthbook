import React from "react";
import { useForm } from "react-hook-form";
import { ExpandedMember } from "back-end/types/organization";
import Field from "@front-end/components/Forms/Field";
import Modal from "@front-end/components/Modal";
import { useAuth } from "@front-end/services/auth";

type Props = {
  member: ExpandedMember;
  close: () => void;
};

export default function AdminSetPasswordModal({ member, close }: Props) {
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
      successMessage="Password successfully changed."
      submit={form.handleSubmit(async (data) => {
        await apiCall(`/member/${member.id}/admin-password-reset`, {
          method: "PUT",
          credentials: "include",
          body: JSON.stringify(data),
        });
      })}
    >
      <p>
        Change password for <strong>{member.name}</strong>:
      </p>
      <Field
        placeholder="Enter a new password"
        type="password"
        required
        minLength={8}
        {...form.register("updatedPassword")}
      />
    </Modal>
  );
}
