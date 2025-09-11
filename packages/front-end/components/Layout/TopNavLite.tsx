import Head from "next/head";
import { FaAngleRight } from "react-icons/fa";
import Link from "next/link";
import { Text } from "@radix-ui/themes";
import {
  PiCaretDownFill,
  PiCircleHalf,
  PiMoon,
  PiSunDim,
} from "react-icons/pi";
import { useMemo } from "react";
import { safeLogout } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Avatar from "@/components/Avatar/Avatar";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { usePageHead } from "@/components/Layout/PageHead";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownSubMenu,
} from "@/ui/DropdownMenu";
import styles from "./TopNav.module.scss";

export default function TopNavLite({ pageTitle }: { pageTitle?: string }) {
  const { email, name, user } = useUser();
  const { theme, setTheme, preferredTheme } = useAppearanceUITheme();
  const { breadcrumb } = usePageHead();

  const activeIcon = useMemo(() => {
    switch (preferredTheme) {
      case "dark":
        return (
          <div className="align-middle">
            <PiMoon size="16" className="mr-1 " />
            Theme
          </div>
        );

      case "light":
        return (
          <div className="align-middle">
            <PiSunDim size="16" className="mr-1" />
            Theme
          </div>
        );

      case "system":
        return (
          <div className="align-middle">
            <PiCircleHalf size="16" className="mr-1" />
            Theme
          </div>
        );
    }
  }, [preferredTheme]);

  const renderNameAndEmailDropdownLabel = () => {
    return (
      <>
        <DropdownMenuGroup style={{ marginBottom: 4 }}>
          <DropdownMenuLabel style={{ height: "inherit" }}>
            {name && (
              <Text weight="bold" className="text-main">
                {name}
              </Text>
            )}
          </DropdownMenuLabel>
          <DropdownMenuLabel style={{ height: "inherit" }}>
            <Text className="text-secondary">{email}</Text>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
      </>
    );
  };
  const renderThemeDropDown = (isMenu?: boolean) => {
    const components = (
      <>
        <DropdownMenuItem
          className={styles.dropdownItemIconColor}
          key="system"
          onClick={() => {
            setTheme("system");
          }}
        >
          <span>
            <PiCircleHalf size="16" className="mr-1" />
            System Default
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={styles.dropdownItemIconColor}
          key="light"
          onClick={() => {
            setTheme("light");
          }}
        >
          <span>
            <PiSunDim size="16" className="mr-1" />
            Light
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={styles.dropdownItemIconColor}
          key="dark"
          onClick={() => {
            setTheme("dark");
          }}
        >
          <span>
            <PiMoon size="16" className="mr-1" />
            Dark
          </span>
        </DropdownMenuItem>
      </>
    );

    if (isMenu) {
      return (
        <DropdownMenu
          trigger={activeIcon}
          triggerClassName={styles.dropdownItemIconColor}
        >
          {components}
        </DropdownMenu>
      );
    }
    return (
      <DropdownSubMenu
        trigger={activeIcon}
        triggerClassName={styles.dropdownItemIconColor}
      >
        {components}
      </DropdownSubMenu>
    );
  };
  const renderLogoutDropDown = () => {
    return (
      <DropdownMenuItem
        key="sign-out"
        onClick={() => {
          safeLogout();
        }}
      >
        Sign Out
      </DropdownMenuItem>
    );
  };

  const renderBreadCrumb = () => {
    return breadcrumb?.map((b, i) => (
      <span
        key={i}
        className={i < breadcrumb.length - 1 ? "d-none d-lg-inline" : ""}
        title={b.display}
      >
        {i > 0 && <FaAngleRight className="mx-2 d-none d-lg-inline" />}
        {b.href ? (
          <Link className={styles.breadcrumblink} href={b.href}>
            {b.display}
          </Link>
        ) : (
          b.display
        )}
      </span>
    ));
  };
  const renderTitleOrBreadCrumb = () => {
    let titleOrBreadCrumb: string | JSX.Element[] = pageTitle || "";
    if (breadcrumb.length > 0) {
      titleOrBreadCrumb = renderBreadCrumb();
    }
    return <div className={styles.pagetitle}>{titleOrBreadCrumb}</div>;
  };

  return (
    <div className={`navbar ${styles.topbarlite}`}>
      <Head>
        <title>GrowthBook</title>
      </Head>
      <div style={{ width: 240 }}>
        <Link href="/">
          {theme === "dark" ? (
            <>
              <img
                alt="GrowthBook"
                src="/logo/growth-book-logo-white.svg"
                style={{ width: 160, height: 30, marginLeft: 4, marginTop: -8 }}
              />
            </>
          ) : (
            <>
              <img
                alt="GrowthBook"
                src="/logo/growth-book-logo-color.svg"
                style={{ width: 160, height: 30, marginLeft: 4, marginTop: -8 }}
              />
            </>
          )}
        </Link>
      </div>
      {renderTitleOrBreadCrumb()}
      <div className="ml-auto">
        {user ? (
          <DropdownMenu
            variant="solid"
            trigger={
              <div className="nav-link d-flex">
                <Avatar
                  email={email || ""}
                  size={26}
                  name={name || ""}
                  className="mr-2"
                />{" "}
                <span className="d-none d-lg-inline">
                  <OverflowText maxWidth={200}>
                    <Text weight={"bold"} style={{ fontSize: 14 }}>
                      {email}
                    </Text>{" "}
                    <PiCaretDownFill />
                  </OverflowText>
                </span>
              </div>
            }
          >
            {renderNameAndEmailDropdownLabel()}
            {renderThemeDropDown()}
            <DropdownMenuSeparator />
            {renderLogoutDropDown()}
          </DropdownMenu>
        ) : (
          <div className="mr-1">{renderThemeDropDown(true)}</div>
        )}
      </div>
    </div>
  );
}
