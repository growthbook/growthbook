import React, { FC, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { FaExclamationTriangle } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import { isCloud } from "@/services/env";
import { useUser } from "@/services/UserContext";
import Field from "../Forms/Field";
import Modal from "../Modal";
import styles from "./EditLicenseForm.module.scss";

const EditLicenseModal: FC<{
  close: () => void;
  mutate: () => Promise<unknown>;
}> = ({ close, mutate }) => {
  const { license, updateUser } = useUser();
  const { apiCall } = useAuth();
  const [closeCta, setCloseCta] = useState("Cancel");
  const [successMessage, setSuccessMessage] = useState("");
  const [editField, setEditField] = useState(!license);

  const form = useForm({
    defaultValues: {
      licenseKey: "",
    },
  });

  useEffect(() => {
    if (isCloud()) {
      close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCloud]);

  if (isCloud()) {
    return null;
  }

  return (
    <Modal
      header="Enter License Key"
      open={true}
      close={close}
      submit={form.handleSubmit(async (value) => {
        await apiCall("/organization/license", {
          method: "PUT",
          body: JSON.stringify(value),
        });
        await updateUser();
        await mutate();
        setCloseCta("Close");
        setEditField(false);
        setSuccessMessage("License key accepted. Thank you!");
      })}
      cta="Save"
      ctaEnabled={editField && form.watch("licenseKey").length > 0}
      closeCta={closeCta}
      autoCloseOnSubmit={false}
    >
      {editField ? (
        <>
          <Field
            label="License Key"
            className={styles.textarea}
            textarea={true}
            minRows={12}
            maxRows={12}
            required
            {...form.register("licenseKey")}
            placeholder={
              license
                ? "License key present. Enter a new key here."
                : "Enter a license key here."
            }
          />
        </>
      ) : (
        <div className="form-group">
          <label>Enter License Key</label>
          <div>
            <div
              className="d-inline-block form-control mb-3 bg-disabled mr-3 text-center text-muted"
              style={{
                width: 300,
                verticalAlign: "top",
                pointerEvents: "none",
                overflow: "hidden",
              }}
            >
              *******************************************
            </div>
            <button
              className="btn btn-md btn-primary"
              onClick={() => {
                setEditField(true);
              }}
            >
              Change
            </button>
            {successMessage ? (
              <div className="alert alert-success">{successMessage}</div>
            ) : (
              <div className="alert alert-warning">
                <FaExclamationTriangle /> You already have an active license.
                Click &quot;Change&quot; to enter a new license key.
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
};
export default EditLicenseModal;
