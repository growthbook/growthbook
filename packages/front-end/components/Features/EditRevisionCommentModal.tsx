import { FeatureInterface } from "back-end/types/feature";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { useState } from "react";
import { useAuth } from "@/services/auth";
import Modal from "../Modal";
import Field from "../Forms/Field";

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
