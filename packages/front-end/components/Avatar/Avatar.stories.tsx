import { number, text } from "@storybook/addon-knobs";
import Avatar from "./Avatar";

export default {
  component: Avatar,
  title: "Avatar",
};

export const Default = () => {
  const rangeOptions = {
    range: true,
    min: 20,
    max: 400,
  };
  return (
    <div>
      <Avatar
        email={text("email", "tina@growthbook.io")}
        size={number("Size", 100, rangeOptions)}
      />
    </div>
  );
};
