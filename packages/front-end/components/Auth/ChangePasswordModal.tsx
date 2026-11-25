import { FC } from "react";
import { useForm } from "react-hook-form";
import { Trans, useLingui } from "@lingui/react/macro";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import Modal from "@/components/Modal";

const ChangePasswordModal: FC<{
  close: () => void;
}> = ({ close }) => {
  const { t } = useLingui();
  const form = useForm({
    defaultValues: {
      currentPassword: "",
      newPassword: "",
    },
  });
  const { apiCall } = useAuth();

  return (
    <Modal
      trackingEventModalType=""
      header={t`Change Password`}
      open={true}
      autoCloseOnSubmit={false}
      close={close}
      cta={t`Change Password`}
      successMessage={t`Password successfully changed`}
      submit={form.handleSubmit(async (data) => {
        await apiCall("/auth/change-password", {
          method: "POST",
          body: JSON.stringify(data),
        });
      })}
    >
      <Field
        size="legacy"
        label={t`Current Password`}
        type="password"
        required
        minLength={8}
        autoComplete="current-password"
        {...form.register("currentPassword")}
        helpText={
          <Trans>
            Can&apos;t remember your current password? Log out and click on{" "}
            <strong>Forgot&nbsp;Password</strong> to reset it.
          </Trans>
        }
      />
      <Field
        size="legacy"
        label={t`New Password`}
        type="password"
        required
        minLength={8}
        autoComplete="new-password"
        {...form.register("newPassword")}
      />
    </Modal>
  );
};
export default ChangePasswordModal;
