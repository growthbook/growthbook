import { useForm } from "react-hook-form";
import { SafeRolloutInterface } from "back-end/src/models/SafeRolloutModel";
import { useAuth } from "@/services/auth";
export interface Props {
  safeRollout: SafeRolloutInterface;
  open: boolean;
  setStatusModalOpen: (open: boolean) => void;
}

export default function SafeRolloutStatusModal({
  safeRollout,
  open,
  setStatusModalOpen,
}: Props) {
  const form = useForm<Partial<SafeRolloutInterface>>({
    defaultValues: {
      ...safeRollout,
    },
  });

  const { apiCall } = useAuth();
  const onSubmit = async (value: Partial<SafeRolloutInterface>) => {
    await apiCall(`/safe-rollout/${safeRollout.id}`, {
      method: "PUT",
      body: JSON.stringify(value),
    });
  };

  return (
    <></>
    // <Modal
    //   open={open}
    //   onClose={() => setStatusModalOpen(false)}
    //   header={`Edit Safe Rollout`}
    //   submit={form.handleSubmit(async (value) => {
    //     validateSavedGroupTargeting(value.savedGroups);

    //     await apiCall(`todo`, {
    //       method: "PUT",
    //       body: JSON.stringify(value),
    //     });
    //     mutate();
    //   })}
    //   size="lg"
    //   bodyClassName="px-4 pt-4"
    // ></Modal>
  );
}
