import { FC } from "react";
import { useForm } from "react-hook-form";
import {
  SampleUserAttributeValues,
  SampleUsersInterface,
} from "back-end/types/sample-users";
import Field from "@/components/Forms/Field";
import AttributeForm from "@/components/Attributes/AttributeForm";
import Toggle from "@/components/Forms/Toggle";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useAuth } from "@/services/auth";
import Modal from "../Modal";

const SampleUserAttributesModal: FC<{
  close: () => void;
  header: string;
  initialValues?: Partial<SampleUsersInterface>;
}> = ({ close, header, initialValues }) => {
  const form = useForm<{
    name: string;
    description: string;
    attributes: SampleUserAttributeValues;
    isPublic: boolean;
  }>({
    defaultValues: {
      name: initialValues?.name || "",
      description: initialValues?.description || "",
      attributes: initialValues?.attributes || {},
      isPublic: initialValues?.isPublic || true,
    },
  });
  const { apiCall } = useAuth();

  return (
    <Modal
      open={true}
      autoCloseOnSubmit={false}
      close={close}
      cta="Save Sample User"
      successMessage="Sample user saved successfully"
      submit={form.handleSubmit(async (data) => {
        if (initialValues?.id) {
          await apiCall(`/sample-users/${initialValues.id}`, {
            method: "PUT",
            body: JSON.stringify({ ...data }),
          });
        } else {
          await apiCall("/sample-users/", {
            method: "POST",
            body: JSON.stringify({ ...data }),
          });
        }
      })}
      header={header}
    >
      <div>
        <Field label={"Name"} required={true} {...form.register("name")} />
      </div>
      <div>
        <Field
          label={"Description"}
          {...form.register("description")}
          textarea
        />
      </div>
      <div className="mb-3">
        <label className="mr-3">
          Make sample user public?{" "}
          <Tooltip
            body={
              "Allow other team members to see this sample user for testing"
            }
          />
        </label>
        <Toggle
          id="public"
          value={form.watch("isPublic")}
          setValue={(v) => form.setValue("isPublic", v)}
          label="Public"
        />
      </div>
      <div>
        <AttributeForm
          initialValues={form.watch("attributes")}
          useJSONButton={false}
          onChange={(v) => {
            form.setValue("attributes", v);
          }}
        />
      </div>
    </Modal>
  );
};

export default SampleUserAttributesModal;
