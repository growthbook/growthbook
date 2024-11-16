import { FC } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import Modal from "@/components/Modal";

const ChangePasswordModal: FC<{
  close: () => void;
}> = ({ close }) => {
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
      header="修改密码"
      open={true}
      autoCloseOnSubmit={false}
      close={close}
      cta="修改密码"
      successMessage="密码修改成功"
      submit={form.handleSubmit(async (data) => {
        await apiCall("/auth/change-password", {
          method: "POST",
          body: JSON.stringify(data),
        });
      })}
    >
      <Field
        label="当前密码"
        type="password"
        required
        minLength={8}
        autoComplete="current-password"
        {...form.register("currentPassword")}
        helpText={
          <>
            忘记当前密码了？请退出登录，然后点击{" "}
            <strong>忘记密码</strong>来重置密码。
          </>
        }
      />
      <Field
        label="新密码"
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
