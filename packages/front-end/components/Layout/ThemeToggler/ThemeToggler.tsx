import { FC, useCallback, useMemo, useState } from "react";
import { FaMoon } from "react-icons/fa";
import { BsCircleHalf } from "react-icons/bs";
import { ImSun } from "react-icons/im";
import clsx from "clsx";
import useGlobalMenu from "@/services/useGlobalMenu";
import {
  PreferredAppearanceUITheme,
  useAppearanceUITheme,
} from "@/services/AppearanceUIThemeProvider";

// Icons
const SystemIcon = BsCircleHalf;
const DarkIcon = FaMoon;
const LightIcon = ImSun;

export const ThemeToggler: FC = () => {
  const [themeDropdownOpen, setThemeDropdownOpen] = useState(false);

  const { setTheme, preferredTheme } = useAppearanceUITheme();

  useGlobalMenu(".top-nav-theme-menu", () => setThemeDropdownOpen(false));

  const handleThemeChange = useCallback(
    (theme: PreferredAppearanceUITheme) => {
      setTheme(theme);
      setThemeDropdownOpen(false);
    },
    [setTheme]
  );

  const activeIcon = useMemo(() => {
    switch (preferredTheme) {
      case "dark":
        return <DarkIcon className="text-secondary mr-2" />;

      case "light":
        return <LightIcon className="text-secondary mr-2" />;

      case "system":
        return <SystemIcon className="text-secondary mr-2" />;
    }
  }, [preferredTheme]);

  return (
    <div className="dropdown top-nav-theme-menu">
      <button
        onClick={() => {
          setThemeDropdownOpen(!themeDropdownOpen);
        }}
        className="btn p-0 mr-1"
      >
        <span className="nav-link dropdown-toggle text-main">{activeIcon}</span>
      </button>

      <div
        className={clsx("dropdown-menu dropdown-menu-right", {
          show: themeDropdownOpen,
        })}
      >
        <button
          onClick={() => handleThemeChange("system")}
          className={clsx("dropdown-item", {
            "text-primary": preferredTheme === "system",
          })}
        >
          <SystemIcon className="mr-1" /> System Default
        </button>
        <button
          onClick={() => handleThemeChange("light")}
          className={clsx("dropdown-item", {
            "text-primary": preferredTheme === "light",
          })}
        >
          <LightIcon className="mr-1" /> Light mode
        </button>

        <button
          onClick={() => handleThemeChange("dark")}
          className={clsx("dropdown-item", {
            "text-primary": preferredTheme === "dark",
          })}
        >
          <DarkIcon className="mr-1" /> Dark mode
        </button>
      </div>
    </div>
  );
};
