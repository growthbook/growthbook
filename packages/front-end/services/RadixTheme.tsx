import { Theme } from "@radix-ui/themes";
import { FC, PropsWithChildren } from "react";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";

export const RadixTheme: FC<PropsWithChildren> = ({ children }) => {
  const { theme } = useAppearanceUITheme();
  console.log(theme);

  return (
    <Theme
      accentColor="violet"
      scaling="90%"
      panelBackground="solid"
      appearance={theme}
    >
      {children}
    </Theme>
  );
};
