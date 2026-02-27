import { FC } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import PasswordInput from "./PasswordInput";

type FormValues = {
  currentPassword: string;
  newPassword: string;
};

const ChangePasswordModal: FC<{ close: () => void }> = ({ close }) => {
  const form = useForm<FormValues>({
    defaultValues: {
      currentPassword: "",
      newPassword: "",
    },
  });

  const { apiCall } = useAuth();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = form;

  return (
    <Modal
      trackingEventModalType=""
      header="Change Password"
      open={true}
      autoCloseOnSubmit={false}
      close={close}
      cta="Change Password"
      successMessage="Password successfully changed"
      submit={handleSubmit(async (data) => {
        await apiCall("/auth/change-password", {
          method: "POST",
          body: JSON.stringify(data),
        });
      })}
    >
      {/* Current Password */}
      <div className="mb-3">
        <label className="form-label">Current Password</label>
        <PasswordInput
          {...register("currentPassword", { required: true, minLength: 8 })}
          autoComplete="current-password"
          className={`form-control ${errors.currentPassword ? "is-invalid" : ""}`}
          placeholder="Enter current password"
          error={
            errors.currentPassword
              ? "Current password must be at least 8 characters"
              : null
          }
        />
        <div className="form-text mt-1">
          Can&apos;t remember your current password? Log out and click{" "}
          <strong>Forgot&nbsp;Password</strong> to reset it.
        </div>
      </div>

      {/* New Password */}
      <div className="mb-3">
        <label className="form-label">New Password</label>
        <PasswordInput
          {...register("newPassword", { required: true, minLength: 8 })}
          autoComplete="new-password"
          className={`form-control ${errors.newPassword ? "is-invalid" : ""}`}
          placeholder="Create a new password"
          error={
            errors.newPassword
              ? "New password must be at least 8 characters"
              : null
          }
        />
      </div>
    </Modal>
  );
};

export default ChangePasswordModal;
