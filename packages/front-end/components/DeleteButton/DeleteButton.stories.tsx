import { action } from "@storybook/addon-actions";
import { text } from "@storybook/addon-knobs";
import DeleteButton from "./DeleteButton";

export default {
  title: "Delete Button",
  component: DeleteButton,
};

export const Default = () => {
  const onClick = async () => {
    action("delete clicked")();
  };
  return (
    <div>
      <DeleteButton
        onClick={onClick}
        displayName={text("Display Name", "Something Important")}
        text={text("text", "Dangerous Click")}
      />
    </div>
  );
};
