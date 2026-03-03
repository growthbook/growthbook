import { Theme } from "@radix-ui/themes";
import { FC, PropsWithChildren } from "react";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";

interface RadixThemeProps extends PropsWithChildren {
  flip?: boolean;
}

export const RadixTheme: FC<RadixThemeProps> = ({ children, flip }) => {
  const { theme } = useAppearanceUITheme();
  const computedTheme = flip ? (theme === "dark" ? "light" : "dark") : theme;
  const spreadProps = flip
    ? { appearance: computedTheme }
    : { appearance: theme };

  return (
    <Theme accentColor="violet" panelBackground="solid" {...spreadProps}>
      {children}
    </Theme>
  );
};
