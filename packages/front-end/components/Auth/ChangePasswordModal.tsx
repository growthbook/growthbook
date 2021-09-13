import { FC, useState } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import Field from "../Forms/Field";
import Modal from "../Modal";

const ChangePasswordModal: FC<{
  close: () => void;
}> = ({ close }) => {
  const [success, setSuccess] = useState(false);
  const form = useForm({
    defaultValues: {
      currentPassword: "",
      newPassword: "",
    },
  });
  const { apiCall } = useAuth();

  return (
    <Modal
      header="Change Password"
      open={true}
      autoCloseOnSubmit={false}
      close={close}
      cta="Change Password"
      closeCta={success ? "Close" : "Cancel"}
      submit={
        success
          ? null
          : form.handleSubmit(async (data) => {
              await apiCall("/auth/change-password", {
                method: "POST",
                body: JSON.stringify(data),
              });
              setSuccess(true);
            })
      }
    >
      {success ? (
        <div className="alert alert-success">
          Password successfully changed. It will take effect the next time you
          login.
        </div>
      ) : (
        <>
          <Field
            label="Current Password"
            type="password"
            required
            minLength={8}
            autoComplete="current-password"
            {...form.register("currentPassword")}
            helpText={
              <>
                Can&apos;t remember your current password? Log out and click on{" "}
                <strong>Forgot&nbsp;Password</strong> to reset it.
              </>
            }
          />
          <Field
            label="New Password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            {...form.register("newPassword")}
          />
        </>
      )}
    </Modal>
  );
};
export default ChangePasswordModal;
