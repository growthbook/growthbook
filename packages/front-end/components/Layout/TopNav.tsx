import { FC, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { FaAngleRight, FaBars, FaBuilding } from "react-icons/fa";
import {
  PiPlusBold,
  PiCaretDownFill,
  PiCircleHalf,
  PiFiles,
  PiKey,
  PiListChecks,
  PiMoon,
  PiSunDim,
} from "react-icons/pi";
import Link from "next/link";
import Head from "next/head";
import { DropdownMenu, Text } from "@radix-ui/themes";
import router from "next/router";
import clsx from "clsx";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import {
  allowSelfOrgCreation,
  isCloud,
  isMultiOrg,
  showMultiOrgSelfSelector,
  usingSSO,
} from "@/services/env";
import { useCelebrationLocalStorage } from "@/hooks/useCelebration";
import Modal from "@/components/Modal";
import Avatar from "@/components/Avatar/Avatar";
import ChangePasswordModal from "@/components/Auth/ChangePasswordModal";
import Field from "@/components/Forms/Field";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import Toggle from "@/components/Forms/Toggle";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import AccountPlanNotices from "@/components/Layout/AccountPlanNotices";
import AccountPlanBadge from "@/components/Layout/AccountPlanBadge";
import useGlobalMenu from "@/services/useGlobalMenu";
import styles from "./TopNav.module.scss";
import { usePageHead } from "./PageHead";

const TopNav: FC<{
  toggleLeftMenu?: () => void;
  pageTitle: string;
  showNotices?: boolean;
}> = ({ toggleLeftMenu, pageTitle, showNotices }) => {
  const [editUserOpen, setEditUserOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [
    enableCelebrations,
    setEnableCelebrations,
  ] = useCelebrationLocalStorage();

  const { breadcrumb } = usePageHead();

  const { updateUser, name, email } = useUser();

  const { apiCall, logout, organizations, orgId, setOrgId } = useAuth();
  const { setTheme, preferredTheme } = useAppearanceUITheme();
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);
  useGlobalMenu(".top-nav-org-menu", () => setOrgDropdownOpen(false));

  const form = useForm({
    defaultValues: { name: name || "", enableCelebrations },
  });

  const onSubmitEditProfile = form.handleSubmit(async (value) => {
    if (value.name !== name) {
      await apiCall(`/user/name`, {
        method: "PUT",
        body: JSON.stringify({ name: value.name }),
      });
      updateUser();
    }

    if (value.enableCelebrations !== enableCelebrations) {
      setEnableCelebrations(value.enableCelebrations);
    }
  });

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

  let orgName = orgId || "";
  if (organizations && organizations.length) {
    organizations.forEach((o) => {
      if (o.id === orgId) {
        orgName = o.name;
      }
    });
  }
  const renderLogoutDropDown = () => {
    return (
      <DropdownMenu.Item
        key="sign-out"
        onSelect={() => {
          logout();
        }}
      >
        Sign Out
      </DropdownMenu.Item>
    );
  };
  const renderEditProfileDropDown = () => {
    return (
      <DropdownMenu.Item
        key="edit-profile"
        onSelect={() => {
          setEditUserOpen(true);
        }}
      >
        Edit Profile
      </DropdownMenu.Item>
    );
  };
  const renderNameAndEmailDropdownLabel = () => {
    return (
      <>
        <DropdownMenu.Group style={{ marginBottom: 4 }}>
          <DropdownMenu.Label style={{ height: "inherit" }}>
            {name && (
              <Text weight="bold" className="text-main">
                {name}
              </Text>
            )}
          </DropdownMenu.Label>
          <DropdownMenu.Label style={{ height: "inherit" }}>
            <Text className="text-secondary">{email}</Text>
          </DropdownMenu.Label>
        </DropdownMenu.Group>
      </>
    );
  };
  const renderPersonalAccessTokensDropDown = () => {
    return (
      <DropdownMenu.Item
        className="dropdown-text-color"
        onClick={() => {
          router.push("/account/personal-access-tokens");
        }}
      >
        <div className="align-middle">
          <PiKey size="16" className="mr-1" />
          Personal Access Tokens
        </div>
      </DropdownMenu.Item>
    );
  };
  const renderMyReportsDropDown = () => {
    return (
      <DropdownMenu.Item
        className="dropdown-text-color"
        onClick={() => {
          router.push("/reports");
        }}
      >
        <div className="align-middle">
          <PiFiles size="16" className="mr-1" />
          My Reports
        </div>
      </DropdownMenu.Item>
    );
  };
  const renderMyActivityFeedsDropDown = () => {
    return (
      <DropdownMenu.Item
        className="dropdown-text-color"
        onClick={() => {
          router.push("/activity");
        }}
      >
        <div className="align-middle">
          <PiListChecks size="16" className="mr-1" />
          Activity Feed
        </div>
      </DropdownMenu.Item>
    );
  };

  const renderThemeSubDropDown = () => {
    return (
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger className="dropdown-text-color">
          {activeIcon}
        </DropdownMenu.SubTrigger>
        <DropdownMenu.SubContent>
          <DropdownMenu.Item
            className="dropdown-text-color"
            key="system"
            onSelect={() => {
              setTheme("system");
            }}
          >
            <span>
              <PiCircleHalf size="16" className="mr-1" />
              System Default
            </span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="dropdown-text-color"
            key="light"
            onSelect={() => {
              setTheme("light");
            }}
          >
            <span>
              <PiSunDim size="16" className="mr-1" />
              Light
            </span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="dropdown-text-color"
            key="dark"
            onSelect={() => {
              setTheme("dark");
            }}
          >
            <span>
              <PiMoon size="16" className="mr-1" />
              Dark
            </span>
          </DropdownMenu.Item>
        </DropdownMenu.SubContent>
      </DropdownMenu.Sub>
    );
  };
  const renderOrganizationDropDown = () => {
    if (organizations && organizations.length === 1) {
      return (
        <div className="top-nav-org-menu mr-2">
          <FaBuilding className="text-muted mr-1" />
          <span className="d-none d-lg-inline">{orgName}</span>
        </div>
      );
    }

    if (organizations && organizations.length > 1) {
      return (
        <div className="dropdown top-nav-org-menu">
          <div
            className={`nav-link dropdown-toggle`}
            onClick={(e) => {
              e.preventDefault();
              setOrgDropdownOpen(!orgDropdownOpen);
            }}
            style={{ cursor: "pointer" }}
          >
            <FaBuilding className="text-muted mr-1" />
            <span className="d-none d-lg-inline">
              <OverflowText maxWidth={200}>{orgName}</OverflowText>
            </span>
          </div>
          <div
            className={clsx("dropdown-menu dropdown-menu-right", {
              show: orgDropdownOpen,
            })}
          >
            <div className="dropdown-header">Organization</div>
            {organizations.map((o) => (
              <a
                className={clsx("dropdown-item", {
                  active: o.id === orgId,
                })}
                key={o.id}
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  if (setOrgId) {
                    setOrgId(o.id);
                  }

                  try {
                    localStorage.setItem("gb-last-picked-org", `"${o.id}"`);
                  } catch (e) {
                    console.warn("Cannot set gb-last-picked-org");
                  }

                  setOrgDropdownOpen(false);
                }}
              >
                <span className="status"></span>
                {o.name}
              </a>
            ))}
            {!isCloud() &&
              isMultiOrg() &&
              (showMultiOrgSelfSelector() || allowSelfOrgCreation()) && (
                <div className={styles["add-organization"]}>
                  <hr />
                  <div>
                    <div>
                      <PiPlusBold />
                    </div>
                    <Link
                      href="/settings/organizations"
                      className="dropdown-item"
                      onClick={() => {
                        setOrgDropdownOpen(false);
                      }}
                    >
                      Add Organization
                    </Link>
                  </div>
                </div>
              )}
          </div>
        </div>
      );
    }
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
    let titleOrBreadCrumb: string | JSX.Element[] = pageTitle;
    if (breadcrumb.length > 0) {
      titleOrBreadCrumb = renderBreadCrumb();
    }
    return <div className={styles.pagetitle}>{titleOrBreadCrumb}</div>;
  };
  const renderChangePassword = () => {
    if (!usingSSO()) {
      return (
        <DropdownMenu.Item
          className="dropdown-item"
          onSelect={(e) => {
            e.preventDefault();
            setChangePasswordOpen(true);
          }}
        >
          Change Password
        </DropdownMenu.Item>
      );
    }
  };

  return (
    <>
      <Head>
        <title>GrowthBook &gt; {pageTitle}</title>
      </Head>
      {editUserOpen && (
        <Modal
          close={() => setEditUserOpen(false)}
          submit={onSubmitEditProfile}
          header="Edit Profile"
          open={true}
        >
          <Field label="Name" {...form.register("name")} />
          <label className="mr-3">
            Allow Celebrations{" "}
            <Tooltip
              body={
                "GrowthBook adds on-screen confetti celebrations randomly when you complete certain actions like launching an experiment. You can disable this if you find it distracting."
              }
            />
          </label>
          <Toggle
            id="allowCelebration"
            label="Allow celebration"
            value={form.watch("enableCelebrations")}
            setValue={(v) => form.setValue("enableCelebrations", v)}
          />
        </Modal>
      )}
      {changePasswordOpen && (
        <ChangePasswordModal close={() => setChangePasswordOpen(false)} />
      )}
      <div
        className={`navbar ${styles.topbar} mb-2 position-fixed`}
        style={{
          left: toggleLeftMenu ? undefined : 0,
        }}
      >
        <div className={styles.navbar}>
          {toggleLeftMenu ? (
            <a
              href="#main-menu"
              id="main-menu-toggle"
              className={styles.mobilemenu}
              aria-label="Open main menu"
              onClick={(e) => {
                e.preventDefault();
                toggleLeftMenu();
              }}
            >
              <span className="sr-only">Open main menu</span>
              <FaBars />
            </a>
          ) : (
            <div>
              <img
                alt="GrowthBook"
                src="/logo/growthbook-logo.png"
                style={{ height: 40 }}
              />
            </div>
          )}
          {renderTitleOrBreadCrumb()}
          {showNotices && (
            <div className="mr-2">
              <AccountPlanNotices />
              <AccountPlanBadge />
            </div>
          )}
          {renderOrganizationDropDown()}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <div className="nav-link d-flex">
                <Avatar
                  email={email || ""}
                  size={26}
                  name={name}
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
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="start">
              {renderNameAndEmailDropdownLabel()}
              {renderEditProfileDropDown()}
              {renderThemeSubDropDown()}
              {renderMyActivityFeedsDropDown()}
              {renderMyReportsDropDown()}
              {renderPersonalAccessTokensDropDown()}
              <DropdownMenu.Separator />
              {renderChangePassword()}
              {renderLogoutDropDown()}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      </div>
    </>
  );
};
export default TopNav;
