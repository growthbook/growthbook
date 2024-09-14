import {
  createContext,
  FC,
  PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";

const HELLOWEEN_STORAGE_KEY = "gb_hello_theme";

type HelloweenThemeContextType = {
  showHelloweenTheme: boolean;
  setShowHelloweenTheme: (themeStatus: boolean) => void;
};

const HelloweenThemeContext = createContext<HelloweenThemeContextType>({
  showHelloweenTheme: false,
  setShowHelloweenTheme: () => undefined,
});

/**
 * Get the currently inferred theme and the user's explicitly-selected theme. Set the theme.
 */
export const useHelloweenThemeContext = (): HelloweenThemeContextType =>
  useContext(HelloweenThemeContext);

/**
 * Provides the UI appearance mode preference, e.g. Dark, Light, System
 */
export const HelloweenThemeProvider: FC<PropsWithChildren> = ({ children }) => {
  const [showHelloweenTheme, setShowHelloweenTheme] = useLocalStorage<boolean>(
    HELLOWEEN_STORAGE_KEY,
    false
  );
  const { setTheme, preferredTheme } = useAppearanceUITheme();
  const [previousTheme] = useState(preferredTheme);
  const [spiders, setSpiders] = useState();
  useEffect(() => {
    if (showHelloweenTheme) {
      if (!spiders) {
        try {
          setSpiders(
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            new SpiderController({
              minBugs: 1,
              maxBugs: 4,
              mouseOver: "die",
              imageSprite: "/images/helloween/spider-sprite.png",
            })
          );
        } catch (e) {
          setTimeout(() => {
            setSpiders(
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-expect-error
              new SpiderController({
                minBugs: 3,
                maxBugs: 10,
                mouseOver: "die",
                imageSprite: "/images/helloween/spider-sprite.png",
              })
            );
          }, 1000);
        }
      } else {
        setTheme("dark");
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        spiders.reset();
      }
    } else {
      setTheme(previousTheme);
      if (spiders) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        spiders.end();
      }
    }
  }, [showHelloweenTheme, spiders, previousTheme, setTheme]);

  return (
    <HelloweenThemeContext.Provider
      value={{
        showHelloweenTheme,
        setShowHelloweenTheme,
      }}
    >
      {children}
    </HelloweenThemeContext.Provider>
  );
};
