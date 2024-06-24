import { Theme } from "@radix-ui/themes";
import { FC, PropsWithChildren } from "react";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";

export const RadixTheme: FC<PropsWithChildren> = ({ children }) => {
  const { theme } = useAppearanceUITheme();
  return (
    <Theme accentColor="violet" panelBackground="solid" appearance={theme}>
      {children}
    </Theme>
  );
};
