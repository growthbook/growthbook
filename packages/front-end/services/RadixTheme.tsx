import { Theme } from "@radix-ui/themes";
import { FC, PropsWithChildren } from "react";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";

interface RadixThemeProps extends PropsWithChildren {
  flip?: boolean;
}

export const RadixTheme: FC<RadixThemeProps> = ({ children, flip }) => {
  const { theme } = useAppearanceUITheme();
  // When flip is false/undefined, pass no appearance so Theme inherits from parent
  const spreadProps: { appearance?: "light" | "dark" } = flip
    ? { appearance: theme === "dark" ? "light" : "dark" }
    : {};

  return (
    <Theme accentColor="violet" panelBackground="solid" {...spreadProps}>
      {children}
    </Theme>
  );
};
