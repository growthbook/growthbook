import React, { FC } from "react";
import { useForm } from "react-hook-form";
import Modal from "../../../Modal";
import Field from "../../../Forms/Field";

type EditIdentifierTypeProps = {
  mode: "add" | "edit";
  onCancel: () => void;
  userIdType: string;
  description: string;
  onSave: (name: string, description: string) => void;
};

export const EditIdentifierType: FC<EditIdentifierTypeProps> = ({
  mode,
  userIdType,
  description,
  onSave,
  onCancel,
}) => {
  const form = useForm({
    defaultValues: {
      userIdType: userIdType,
      description: description,
    },
  });

  const handleSubmit = form.handleSubmit(async (value) => {
    onSave(value.userIdType, value.description);
  });

  return (
    <Modal
      open={true}
      submit={handleSubmit}
      close={onCancel}
      size="max"
      header="Edit Identifier Types"
      cta="Save"
      autoFocusSelector="#id-modal-identifier-type"
    >
      <div className="row">
        <div className="col-md-7 col-lg-8">
          <h4 id="id-modal-identifier-type">Identifier Type</h4>
          <div>
            Define all the different units you use to split traffic in an
            experiment. Some examples: user_id, device_id, ip_address.
          </div>

          <Field
            label="Identifier Type"
            {...form.register("userIdType")}
            pattern="^[a-z_]+$"
            title="Only lowercase letters and underscores allowed"
            readOnly={mode === "edit"}
            required
            helpText="Only lowercase letters and underscores allowed. For example, 'user_id' or 'device_cookie'."
          />
          <Field
            label="Description (optional)"
            {...form.register("description")}
            minRows={1}
            maxRows={5}
            textarea
          />
        </div>
      </div>
    </Modal>
  );
};
