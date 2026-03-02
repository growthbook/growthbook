import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { useState } from "react";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";

export interface Props {
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  close: () => void;
  mutate: () => void;
}

export default function EditRevisionCommentModal({
  feature,
  revision,
  close,
  mutate,
}: Props) {
  const { apiCall } = useAuth();
  const [comment, setComment] = useState(revision.comment || "");

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      close={close}
      header="Edit Revision Comment"
      cta={"Save"}
      submit={async () => {
        await apiCall(`/feature/${feature.id}/${revision.version}/comment`, {
          method: "PUT",
          body: JSON.stringify({
            comment,
          }),
        });
        mutate();
      }}
    >
      <Field
        label="Revision Comment"
        value={comment}
        onChange={(e) => {
          setComment(e.target.value);
        }}
        textarea
      />
    </Modal>
  );
}
