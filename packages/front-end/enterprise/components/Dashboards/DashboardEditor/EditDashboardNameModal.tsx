import { DashboardInterface } from "back-end/src/enterprise/validators/dashboard";
import { useForm } from "react-hook-form";
import Field from "@/components/Forms/Field";
import Modal from "@/components/Modal";
import { useAuth } from "@/services/auth";

export default function EditDashboardNameModal({
  dashboard,
  close,
  trackingEventModalType,
  trackingEventModalSource,
}: {
  dashboard: DashboardInterface;
  close: () => void;
  trackingEventModalType: string;
  trackingEventModalSource: string;
}) {
  const { apiCall } = useAuth();
  const form = useForm({
    defaultValues: {
      title: dashboard.title,
    },
  });
  return (
    <Modal
      trackingEventModalType={trackingEventModalType}
      trackingEventModalSource={trackingEventModalSource}
      open={true}
      close={close}
      header="Edit Dashboard Name"
      submit={async () => {
        const res = await apiCall<{
          status: number;
          dashboard: DashboardInterface;
        }>(`/dashboards/${dashboard.id}`, {
          method: "PUT",
          body: JSON.stringify(form.getValues()),
        });
        if (res.status === 200) {
          close();
        }
      }}
    >
      <Field label="Name" required {...form.register("title")} />
    </Modal>
  );
}
