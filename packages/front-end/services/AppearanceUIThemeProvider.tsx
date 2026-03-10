import {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

const KEY_PREFERRED_THEME = "gb_ui_theme";

export type AppearanceUITheme = "dark" | "light";
export type PreferredAppearanceUITheme = "dark" | "light" | "system";

type AppearanceUIThemeContextType = {
  /**
   * This is the currently active theme
   */
  theme: AppearanceUITheme;

  /**
   * This is the theme that the system is currently using
   */
  systemTheme: AppearanceUITheme;

  /**
   * This is the theme that the user has explicitly configured.
   * This can be useful if you want to know if they configured it or not.
   */
  preferredTheme: PreferredAppearanceUITheme;

  /**
   * Set the currently-active theme
   * @param preferredTheme
   */
  setTheme: (preferredTheme: PreferredAppearanceUITheme) => void;
};

// Avoid flash of incorrect theme while loading
export const AppearanceUISnippet = `
  (function() {
    try {
      const themeFromStorage = localStorage.getItem("${KEY_PREFERRED_THEME}");
      if (themeFromStorage === "dark" || themeFromStorage === "light") {
        document.documentElement.classList.add(\`\${themeFromStorage}-theme\`);
      } else {
        const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        document.documentElement.classList.add(isDark ? "dark-theme" : "light-theme");
      }
    } catch (e) { }
  })();
`;

const AppearanceUIThemeContext = createContext<AppearanceUIThemeContextType>({
  theme: "light",
  systemTheme: "light",
  preferredTheme: "system",
  setTheme: () => undefined,
});

export const useAppearanceUITheme = (): AppearanceUIThemeContextType =>
  useContext(AppearanceUIThemeContext);

export const AppearanceUIThemeProvider: FC<PropsWithChildren> = ({
  children,
}) => {
  const initialSystemTheme =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : "light";
  const [systemTheme, setSystemTheme] =
    useState<AppearanceUITheme>(initialSystemTheme);

  const initialPreferredTheme =
    typeof localStorage !== "undefined"
      ? ((localStorage.getItem(
          KEY_PREFERRED_THEME,
        ) as PreferredAppearanceUITheme) ?? "system")
      : "system";
  const [preferredTheme, setPreferredTheme] =
    useState<PreferredAppearanceUITheme>(initialPreferredTheme);

  useEffect(function attachSystemListener() {
    const listener = (e: MediaQueryListEvent) => {
      const colourScheme = e.matches ? "dark" : "light";
      setSystemTheme(colourScheme);
    };

    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", listener);

    return () => {
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .removeEventListener("change", listener);
    };
  }, []);

  useLayoutEffect(() => {
    const targetTheme =
      preferredTheme !== "system" ? preferredTheme : systemTheme;
    const targetClass = `${targetTheme}-theme`;
    const otherThemeClass =
      targetTheme === "dark" ? "light-theme" : "dark-theme";

    const classList = document.documentElement.classList;
    if (!classList.contains(targetClass)) {
      classList.add(targetClass);
    }
    if (classList.contains(otherThemeClass)) {
      classList.remove(otherThemeClass);
    }
  }, [preferredTheme, systemTheme]);

  const handleThemeChange = useCallback(
    (updated: PreferredAppearanceUITheme) => {
      setPreferredTheme(updated);

      try {
        if (updated === "system") {
          localStorage.removeItem(KEY_PREFERRED_THEME);
        } else {
          localStorage.setItem(KEY_PREFERRED_THEME, updated);
        }
      } catch (e) {
        // We are unable to persist the theme changes due to the browser's privacy settings
      }
    },
    [],
  );

  const theme: AppearanceUITheme = useMemo(
    () => (preferredTheme === "system" ? systemTheme : preferredTheme),
    [systemTheme, preferredTheme],
  );

  return (
    <AppearanceUIThemeContext.Provider
      value={{
        theme,
        systemTheme,
        preferredTheme,
        setTheme: handleThemeChange,
      }}
    >
      {children}
    </AppearanceUIThemeContext.Provider>
  );
};
