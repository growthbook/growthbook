import { FC, useState } from "react";
import useForm from "../../hooks/useForm";
import { useAuth } from "../../services/auth";
import Modal from "../Modal";

const ChangePasswordModal: FC<{
  close: () => void;
}> = ({ close }) => {
  const [success, setSuccess] = useState(false);
  const [value, inputProps] = useForm({
    currentPassword: "",
    newPassword: "",
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
          : async () => {
              await apiCall("/auth/change-password", {
                method: "POST",
                body: JSON.stringify(value),
              });
              setSuccess(true);
            }
      }
    >
      {success ? (
        <div className="alert alert-success">
          Password successfully changed. It will take effect the next time you
          login.
        </div>
      ) : (
        <>
          <div className="form-group">
            Current Password
            <input
              type="password"
              name="current"
              required
              minLength={8}
              className="form-control"
              autoComplete="current-password"
              {...inputProps.currentPassword}
            />
            <small className="form-text text-muted">
              Can&apos;t remember your current password? Log out and click on{" "}
              <strong>Forgot&nbsp;Password</strong> to reset it.
            </small>
          </div>
          <div className="form-group">
            New Password
            <input
              type="password"
              name="new"
              required
              minLength={8}
              className="form-control"
              autoComplete="new-password"
              {...inputProps.newPassword}
            />
          </div>
        </>
      )}
    </Modal>
  );
};
export default ChangePasswordModal;
