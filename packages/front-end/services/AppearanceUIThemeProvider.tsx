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

  const [systemTheme, setSystemTheme] = useState<AppearanceUITheme>("light");

  useEffect(() => {
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

      setSystemTheme(actualTheme);
    } catch (e) {
      setSystemTheme(actualTheme);
    }
  }, []);

  useEffect(function attachSystemListener() {
    const listener = (e) => {
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

  useEffect(() => {
    try {
      const themeFromStorage = localStorage.getItem(STORAGE_KEY_THEME);

      if (themeFromStorage === "dark" || themeFromStorage === "light") {
        document.documentElement.className = `theme--${themeFromStorage} ${themeFromStorage}-theme`;
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

  const theme: AppearanceUITheme = useMemo(
    () => (preferredTheme === "system" ? systemTheme : preferredTheme),
    [systemTheme, preferredTheme]
  );

  return (
    <AppearanceUIThemeContext.Provider
      value={{
        theme,
        preferredTheme,
        setTheme: handleThemeChange,
      }}
    >
      {children}
    </AppearanceUIThemeContext.Provider>
  );
};
