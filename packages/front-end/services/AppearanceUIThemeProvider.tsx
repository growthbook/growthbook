import {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const STORAGE_KEY_THEME = "gb_ui_theme";

export type AppearanceUITheme = "dark" | "light";
export type PreferredAppearanceUITheme = "dark" | "light" | "system";

type AppearanceUIThemeContextType = {
  /**
   * This is the one that should be currently active
   */
  theme: AppearanceUITheme;

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

const AppearanceUIThemeContext = createContext<AppearanceUIThemeContextType>({
  theme: "light",
  preferredTheme: "system",
  setTheme: () => undefined,
});

/**
 * Get the currently inferred theme and the user's explicitly-selected theme. Set the theme.
 */
export const useAppearanceUITheme = (): AppearanceUIThemeContextType =>
  useContext(AppearanceUIThemeContext);

/**
 * Provides the UI appearance mode preference, e.g. Dark, Light, System
 */
export const AppearanceUIThemeProvider: FC<PropsWithChildren> = ({
  children,
}) => {
  const [
    preferredTheme,
    setPreferredTheme,
  ] = useState<PreferredAppearanceUITheme>("system");

  useEffect(() => {
    try {
      const themeFromStorage = localStorage.getItem(STORAGE_KEY_THEME) as
        | AppearanceUITheme
        | undefined;

      if (themeFromStorage === "light" || themeFromStorage === "dark") {
        document.documentElement.className = `theme--${themeFromStorage}`;
        setPreferredTheme(themeFromStorage);
      }
    } catch (e) {
      // We are unable to retrieve the theme changes due to the browser's privacy settings
    }
  }, []);

  const handleThemeChange = useCallback(
    (updated: PreferredAppearanceUITheme) => {
      ["theme--dark", "theme--light"].forEach((c) => {
        document.documentElement.classList.remove(c);
      });

      setPreferredTheme(updated);

      try {
        if (updated === "system") {
          localStorage.removeItem(STORAGE_KEY_THEME);
        } else {
          document.documentElement.classList.add(`theme--${updated}`);
          localStorage.setItem(STORAGE_KEY_THEME, updated);
        }
      } catch (e) {
        // We are unable to persist the theme changes due to the browser's privacy settings
      }
    },
    []
  );

  const inferredTheme: AppearanceUITheme = useMemo(() => {
    let actualTheme: AppearanceUITheme = "light";

    try {
      const fromStorage = localStorage.getItem(STORAGE_KEY_THEME);
      if (
        !fromStorage &&
        window.matchMedia("(prefers-color-scheme: dark)")?.matches
      ) {
        actualTheme = "dark";
      }

      if (fromStorage === "dark") {
        actualTheme = "dark";
      }
    } catch (e) {
      return actualTheme;
    }

    return actualTheme;
  }, []);

  return (
    <AppearanceUIThemeContext.Provider
      value={{
        theme: inferredTheme,
        preferredTheme,
        setTheme: handleThemeChange,
      }}
    >
      {children}
    </AppearanceUIThemeContext.Provider>
  );
};
