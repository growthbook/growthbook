import { FC, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { FaAngleRight, FaBars } from "react-icons/fa";
import {
  PiPlusBold,
  PiCaretDownFill,
  PiCircleHalf,
  PiFiles,
  PiKey,
  PiListChecks,
  PiMoon,
  PiSunDim,
  PiBuildingFill,
} from "react-icons/pi";
import Link from "next/link";
import Head from "next/head";
import { Text } from "@radix-ui/themes";
import router from "next/router";
import clsx from "clsx";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownSubMenu,
} from "@/ui/DropdownMenu";
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
import Checkbox from "@/ui/Checkbox";
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
  showLogo?: boolean;
}> = ({ toggleLeftMenu, pageTitle, showNotices, showLogo = true }) => {
  const [editUserOpen, setEditUserOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [enableCelebrations, setEnableCelebrations] =
    useCelebrationLocalStorage();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const { breadcrumb } = usePageHead();

  const { updateUser, name, email, organization } = useUser();

  const { apiCall, logout, organizations, orgId, setOrgId } = useAuth();

  // The current org might not be in the organizations list if the user is a superAdmin
  // and selected the org from the /admin page. So we add it here.
  if (
    organizations &&
    organization.id &&
    organization.name &&
    !organizations.some((org) => org.id === organization.id)
  ) {
    organizations.push({ id: organization.id, name: organization.name });
  }

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
      <DropdownMenuItem
        key="sign-out"
        onClick={() => {
          logout();
        }}
      >
        Sign Out
      </DropdownMenuItem>
    );
  };
  const renderEditProfileDropDown = () => {
    return (
      <DropdownMenuItem
        key="edit-profile"
        onClick={() => {
          setDropdownOpen(false);
          setEditUserOpen(true);
        }}
      >
        Edit Profile
      </DropdownMenuItem>
    );
  };
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
  const renderPersonalAccessTokensDropDown = () => {
    return (
      <DropdownMenuItem
        className={styles.dropdownItemIconColor}
        onClick={() => {
          setDropdownOpen(false);
          router.push("/account/personal-access-tokens");
        }}
      >
        <div className="align-middle">
          <PiKey size="16" className="mr-1" />
          Personal Access Tokens
        </div>
      </DropdownMenuItem>
    );
  };
  const renderMyReportsDropDown = () => {
    return (
      <DropdownMenuItem
        className={styles.dropdownItemIconColor}
        onClick={() => {
          setDropdownOpen(false);
          router.push("/reports");
        }}
      >
        <div className="align-middle">
          <PiFiles size="16" className="mr-1" />
          My Reports
        </div>
      </DropdownMenuItem>
    );
  };
  const renderMyActivityFeedsDropDown = () => {
    return (
      <DropdownMenuItem
        className={styles.dropdownItemIconColor}
        onClick={() => {
          setDropdownOpen(false);
          router.push("/activity");
        }}
      >
        <div className="align-middle">
          <PiListChecks size="16" className="mr-1" />
          Activity Feed
        </div>
      </DropdownMenuItem>
    );
  };

  const renderThemeSubDropDown = () => {
    return (
      <DropdownSubMenu
        trigger={activeIcon}
        triggerClassName={styles.dropdownItemIconColor}
      >
        <DropdownMenuItem
          className={styles.dropdownItemIconColor}
          key="system"
          onClick={() => {
            setDropdownOpen(false);
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
            setDropdownOpen(false);
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
            setDropdownOpen(false);
            setTheme("dark");
          }}
        >
          <span>
            <PiMoon size="16" className="mr-1" />
            Dark
          </span>
        </DropdownMenuItem>
      </DropdownSubMenu>
    );
  };
  const renderOrganizationDropDown = () => {
    if (organizations && organizations.length === 1) {
      return (
        <div className="top-nav-org-menu mr-2">
          <PiBuildingFill className="text-muted mr-1" />
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
            <PiBuildingFill className="text-muted mr-1" />
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
                    <Link
                      href="/settings/organizations"
                      className="dropdown-item px-1"
                      onClick={() => {
                        setOrgDropdownOpen(false);
                      }}
                    >
                      <PiPlusBold />
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
        <DropdownMenuItem
          onClick={() => {
            setDropdownOpen(false);
            setChangePasswordOpen(true);
          }}
        >
          Change Password
        </DropdownMenuItem>
      );
    }
  };

  return (
    <>
      <Head>
        <title>{pageTitle ? `${pageTitle} | GrowthBook` : "GrowthBook"}</title>
      </Head>
      {editUserOpen && (
        <Modal
          trackingEventModalType=""
          close={() => setEditUserOpen(false)}
          submit={onSubmitEditProfile}
          header="Edit Profile"
          open={true}
        >
          <Field label="Name" {...form.register("name")} />
          <Checkbox
            id="allowCelebration"
            label="Allow celebration"
            description="Show confetti celebrations randomly when you complete certain actions like launching an experiment."
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
          ) : showLogo ? (
            <div>
              <img
                alt="GrowthBook"
                src="/logo/growthbook-logo.png"
                style={{ height: 40 }}
              />
            </div>
          ) : null}
          {renderTitleOrBreadCrumb()}
          {showNotices && (
            <>
              <div className="nav-link">
                <AccountPlanNotices />
              </div>
              <div className="nav-link">
                <AccountPlanBadge />
              </div>
            </>
          )}
          {renderOrganizationDropDown()}
          <DropdownMenu
            variant="solid"
            open={dropdownOpen}
            onOpenChange={(o) => {
              setDropdownOpen(!!o);
            }}
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
            {renderEditProfileDropDown()}
            {renderThemeSubDropDown()}
            {renderMyActivityFeedsDropDown()}
            {renderMyReportsDropDown()}
            {renderPersonalAccessTokensDropDown()}
            <DropdownMenuSeparator />
            {renderChangePassword()}
            {renderLogoutDropDown()}
          </DropdownMenu>
        </div>
      </div>
    </>
  );
};
export default TopNav;
