import { FC, useCallback, useEffect, useState } from "react";
import { FaLightbulb, FaMoon } from "react-icons/fa";
import clsx from "clsx";
import useGlobalMenu from "../../services/useGlobalMenu";

type UIAppearanceMode = "system" | "dark" | "light";

const HalfCircleIcon: FC = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M12 22.5C14.7848 22.5 17.4555 21.3938 19.4246 19.4246C21.3938 17.4555 22.5 14.7848 22.5 12C22.5 9.21523 21.3938 6.54451 19.4246 4.57538C17.4555 2.60625 14.7848 1.5 12 1.5V22.5ZM12 24C8.8174 24 5.76516 22.7357 3.51472 20.4853C1.26428 18.2348 0 15.1826 0 12C0 8.8174 1.26428 5.76516 3.51472 3.51472C5.76516 1.26428 8.8174 0 12 0C15.1826 0 18.2348 1.26428 20.4853 3.51472C22.7357 5.76516 24 8.8174 24 12C24 15.1826 22.7357 18.2348 20.4853 20.4853C18.2348 22.7357 15.1826 24 12 24Z"
      fill="currentColor"
    />
  </svg>
);

export const ThemeToggler: FC = () => {
  const [themeDropdownOpen, setThemeDropdownOpen] = useState(false);
  const [activeTheme, setActiveTheme] = useState<UIAppearanceMode>("system");

  useGlobalMenu(".top-nav-theme-menu", () => setThemeDropdownOpen(false));

  useEffect(() => {
    try {
      const themeFromStorage = localStorage.getItem("gb_ui_theme") as
        | UIAppearanceMode
        | undefined;

      if (themeFromStorage === "light" || themeFromStorage === "dark") {
        document.documentElement.className = `theme--${themeFromStorage}`;
        setActiveTheme(themeFromStorage);
      }
    } catch (e) {
      // We are unable to retrieve the theme changes due to the browser's privacy settings
    }
  }, []);

  const handleThemeChange = useCallback((theme: UIAppearanceMode) => {
    ["theme--dark", "theme--light"].forEach((c) => {
      document.documentElement.classList.remove(c);
    });

    setActiveTheme(theme);

    setThemeDropdownOpen(false);

    try {
      if (theme === "system") {
        localStorage.removeItem("gb_ui_theme");
      } else {
        document.documentElement.classList.add(`theme--${theme}`);
        localStorage.setItem("gb_ui_theme", theme);
      }
    } catch (e) {
      // We are unable to persist the theme changes due to the browser's privacy settings
    }
  }, []);

  return (
    <div className="dropdown top-nav-theme-menu">
      <button
        onClick={() => {
          setThemeDropdownOpen(!themeDropdownOpen);
        }}
        className="btn mr-1"
      >
        <span className="nav-link dropdown-toggle text-main">
          <FaMoon className="text-secondary mr-2" />
        </span>
      </button>

      <div
        className={clsx("dropdown-menu dropdown-menu-right", {
          show: themeDropdownOpen,
        })}
      >
        <button
          onClick={() => handleThemeChange("system")}
          className={clsx("dropdown-item", {
            "text-primary": activeTheme !== "light" && activeTheme !== "dark",
          })}
        >
          <span className="mr-2">
            <HalfCircleIcon />
          </span>
          System Default
        </button>
        <button
          onClick={() => handleThemeChange("light")}
          className={clsx("dropdown-item", {
            "text-primary": activeTheme === "light",
          })}
        >
          <FaLightbulb className="mr-1" /> Light mode
        </button>

        <button
          onClick={() => handleThemeChange("dark")}
          className={clsx("dropdown-item", {
            "text-primary": activeTheme === "dark",
          })}
        >
          <FaMoon className="mr-1" /> Dark mode
        </button>
      </div>
    </div>
  );
};
