import { ThemeToggler } from "./ThemeToggler";

export default {
  title: "Configuration/Theme Toggler",
  component: ThemeToggler,
};

export const Default = () => {
  return (
    <div>
      <h1>Theme Toggler</h1>
      <p>
        Toggle the theme here. It will persist in Storybook&apos;s localstorage.
      </p>
      <div style={{ width: 200 }}>
        <ThemeToggler />
      </div>
    </div>
  );
};
