import { DataSourceQueryEditingModalBaseProps } from "../types";
import React, { FC } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import cloneDeep from "lodash/cloneDeep";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
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
    >
      <div className="row">
        <div className="col-md-7 col-lg-8">
          <h4>Identifier Type</h4>
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

    // return (
    //   <Modal
    //     open={true}
    //     submit={handleSubmit}
    //     close={onCancel}
    //     size="max"
    //     header="Edit Identifier Types"
    //     cta="Save"
    //   >
    //     <>
    //       <div className="mb-4">
    //         <h4>Identifier Types</h4>
    //         <div>
    //           Define all the different units you use to split traffic in an
    //           experiment. Some examples: user_id, device_id, ip_address.
    //         </div>
    //
    //         {userIdTypes.fields.map((userIdType, i) => {
    //           return (
    //             <div
    //               key={userIdType.id}
    //               className="bg-light border my-2 p-3 ml-3"
    //             >
    //               <div className="row">
    //                 <div className="col-auto">
    //                   <h5>
    //                     {i + 1}. {form.watch(`userIdTypes.${i}.userIdType`)}
    //                   </h5>
    //                 </div>
    //                 <div className="col-auto ml-auto">
    //                   <a
    //                     className="text-danger"
    //                     href="#"
    //                     title="Remove identifier type"
    //                     onClick={(e) => {
    //                       e.preventDefault();
    //                       userIdTypes.remove(i);
    //                     }}
    //                   >
    //                     delete
    //                   </a>
    //                 </div>
    //               </div>
    //               <div className="row">
    //                 <div className="col-md-7 col-lg-8">
    //                   <Field
    //                     label="Identifier Type"
    //                     pattern="^[a-z_]+$"
    //                     title="Only lowercase letters and underscores allowed"
    //                     required
    //                     {...form.register(`userIdTypes.${i}.userIdType`)}
    //                     helpText="Only lowercase letters and underscores allowed. For example, 'user_id' or 'device_cookie'."
    //                   />
    //                   <Field
    //                     label="Description (optional)"
    //                     {...form.register(`userIdTypes.${i}.description`)}
    //                     minRows={1}
    //                     maxRows={5}
    //                     textarea
    //                   />
    //                 </div>
    //               </div>
    //             </div>
    //           );
    //         })}
    //         <button
    //           className="btn btn-outline-primary ml-3"
    //           type="button"
    //           onClick={(e) => {
    //             e.preventDefault();
    //             userIdTypes.append({
    //               userIdType: "",
    //               description: "",
    //             });
    //           }}
    //         >
    //           Add New Identifier Type
    //         </button>
    //       </div>
    //     </>
    //   </Modal>
  );
};
