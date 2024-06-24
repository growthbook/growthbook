import { Theme } from "@radix-ui/themes";
import { FC, PropsWithChildren } from "react";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";

export const RadixTheme: FC<PropsWithChildren> = ({ children }) => {
  const { preferredTheme } = useAppearanceUITheme();
  return (
    <Theme
      accentColor="violet"
      panelBackground="solid"
      appearance={preferredTheme}
    >
      {children}
    </Theme>
  );
};
