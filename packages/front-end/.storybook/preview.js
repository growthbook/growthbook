import "../styles/global.scss";
import { AppearanceUIThemeProvider } from "../services/AppearanceUIThemeProvider";

export const parameters = {
  actions: { argTypesRegex: "^on[A-Z].*" },
  controls: {
    matchers: {
      color: /(background|color)$/i,
      date: /Date$/,
    },
  },
};

export const decorators = [
  (Story) => (
    <AppearanceUIThemeProvider>
      <Story />
    </AppearanceUIThemeProvider>
  ),
];
