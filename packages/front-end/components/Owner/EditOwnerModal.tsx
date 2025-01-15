import { FC } from "react";
import { useForm } from "react-hook-form";
import { Text } from "@radix-ui/themes";
import useMembers from "@/hooks/useMembers";
import Modal from "@/components/Modal";
import metaDataStyles from "@/components/Radix/Styles/Metadata.module.scss";
import SelectField from "../Forms/SelectField";
import UserAvatar from "../Avatar/UserAvatar";

const EditOwnerModal: FC<{
  owner: string;
  save: (ownerName: string) => Promise<void>;
  cancel: () => void;
  mutate: () => void;
}> = ({ owner, save, cancel, mutate }) => {
  const { memberUsernameOptions, memberUserNameAndIdOptions } = useMembers();

  // Some resources store the owner by name and some by id, so check which one it is
  const ownerIdentifierType: "id" | "name" =
    owner.substring(0, 2) === "u_" ? "id" : "name";

  // if the resource stores owner by id, we need the id to be the value, rather than the name
  const memberOptions =
    ownerIdentifierType === "id"
      ? memberUserNameAndIdOptions
      : memberUsernameOptions;

  const currentOwner = memberOptions.find((member) =>
    ownerIdentifierType === "id"
      ? member.value === owner
      : member.display === owner
  ) || { display: "", value: "" };

  const form = useForm({
    defaultValues: {
      owner: currentOwner.display,
    },
  });

  return (
    <Modal
      trackingEventModalType=""
      header={"Edit Owner"}
      open={true}
      close={cancel}
      submit={form.handleSubmit(async (data) => {
        await save(data.owner);
        mutate();
      })}
      cta="Save"
    >
      <SelectField
        label="Owner"
        options={memberUsernameOptions.map((member) => ({
          value: member.value,
          label: member.display,
        }))}
        value={form.watch("owner")}
        onChange={(v) => form.setValue("owner", v)}
        formatOptionLabel={({ label }) => {
          return (
            <>
              <span>
                {label !== "" && (
                  <UserAvatar name={label} size="sm" variant="soft" />
                )}
                <Text
                  weight="regular"
                  className={metaDataStyles.valueColor}
                  ml="1"
                >
                  {label === "" ? "None" : label}
                </Text>
              </span>
            </>
          );
        }}
      />
    </Modal>
  );
};

export default EditOwnerModal;
