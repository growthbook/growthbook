import { FC, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import {
  FaAngleRight,
  FaBars,
  FaBell,
  FaBuilding,
  FaMoon,
} from "react-icons/fa";
import Link from "next/link";
import clsx from "clsx";
import Head from "next/head";
import { DropdownMenu } from "@radix-ui/themes";
import { BsCircleHalf } from "react-icons/bs";
import { ImSun } from "react-icons/im";
import { render } from "react-dom";
import { useWatching } from "@/services/WatchProvider";
import useGlobalMenu from "@/services/useGlobalMenu";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import { usingSSO } from "@/services/env";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useCelebrationLocalStorage } from "@/hooks/useCelebration";
import Modal from "@/components/Modal";
import Avatar from "@/components/Avatar/Avatar";
import ChangePasswordModal from "@/components/Auth/ChangePasswordModal";
import Field from "@/components/Forms/Field";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import Toggle from "@/components/Forms/Toggle";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import styles from "./TopNav.module.scss";
import { ThemeToggler } from "./ThemeToggler/ThemeToggler";
import AccountPlanBadge from "./AccountPlanBadge";
import AccountPlanNotices from "./AccountPlanNotices";
import { usePageHead } from "./PageHead";

const TopNav: FC<{
  toggleLeftMenu?: () => void;
  pageTitle: string;
  showNotices?: boolean;
}> = ({ toggleLeftMenu, pageTitle, showNotices }) => {
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);
  const { watchedExperiments, watchedFeatures } = useWatching();
  const [editUserOpen, setEditUserOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  useGlobalMenu(".top-nav-user-menu", () => setUserDropdownOpen(false));
  useGlobalMenu(".top-nav-org-menu", () => setOrgDropdownOpen(false));
  const [
    enableCelebrations,
    setEnableCelebrations,
  ] = useCelebrationLocalStorage();

  const { breadcrumb } = usePageHead();

  const { updateUser, name, email, effectiveAccountPlan } = useUser();

  const { datasources } = useDefinitions();

  const { apiCall, logout, organizations, orgId, setOrgId } = useAuth();
  const { setTheme, preferredTheme } = useAppearanceUITheme();

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
      setUserDropdownOpen(false);
    }

    if (value.enableCelebrations !== enableCelebrations) {
      setEnableCelebrations(value.enableCelebrations);
    }
  });

  const planCopy =
    effectiveAccountPlan === "enterprise"
      ? "ENTERPRISE"
      : effectiveAccountPlan === "pro"
      ? "PRO"
      : effectiveAccountPlan === "pro_sso"
      ? "PRO + SSO"
      : "";

  const activeIcon = useMemo(() => {
    switch (preferredTheme) {
      case "dark":
        return (
          <>
            <FaMoon className="text-secondary mr-2" /> Dark
          </>
        );

      case "light":
        return (
          <>
            <ImSun className="text-secondary mr-2" />
            Light
          </>
        );

      case "system":
        return (
          <>
            <BsCircleHalf className="text-secondary mr-2" /> System Default
          </>
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
        <DropdownMenu.Label>
          {name && <div style={{ fontSize: "1.3em" }}>{name}</div>}
        </DropdownMenu.Label>
        <DropdownMenu.Label>
          <div>{email}</div>
        </DropdownMenu.Label>
      </>
    );
  };
  const renderPersonalAccessTokensDropDown = () => {
    return (
      <DropdownMenu.Item>
        <Link href="/account/personal-access-tokens">
          My Personal Access Tokens
        </Link>
      </DropdownMenu.Item>
    );
  };
  const renderMyReportsDropDown = () => {
    return (
      <DropdownMenu.Item>
        <Link href="/reports" className="nav-link mr-1 text-secondary">
          My Reports
        </Link>
      </DropdownMenu.Item>
    );
  };
  const renderMyActivityFeedsDropDown = () => {
    return (
      <DropdownMenu.Item>
        <Link href="/activity" className="nav-link mr-1 text-secondary">
          <FaBell />
        </Link>
      </DropdownMenu.Item>
    );
  };

  const renderThemeSubDropDown = () => {
    return (
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger>{activeIcon}</DropdownMenu.SubTrigger>
        <DropdownMenu.SubContent>
          <DropdownMenu.Item
            key="system"
            onSelect={() => {
              setTheme("system");
            }}
          >
            <BsCircleHalf className="mr-3" /> System Default
          </DropdownMenu.Item>
          <DropdownMenu.Item
            key="light"
            onSelect={() => {
              setTheme("light");
            }}
          >
            <ImSun className="mr-3" /> Light
          </DropdownMenu.Item>
          <DropdownMenu.Item
            key="dark"
            onSelect={() => {
              setTheme("dark");
            }}
          >
            <FaMoon className="mr-3" /> Dark
          </DropdownMenu.Item>
        </DropdownMenu.SubContent>
      </DropdownMenu.Sub>
    );
  };
  const renderOrganizationSubDropDown = () => {
    if (organizations && organizations.length === 1) {
      return <DropdownMenu.Label>{orgName}</DropdownMenu.Label>;
    }
    return (
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger>{orgName}</DropdownMenu.SubTrigger>
        <DropdownMenu.SubContent ali>
          {organizations?.map((o) => (
            <DropdownMenu.Item
              key={o.id}
              onSelect={() => {
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
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.SubContent>
      </DropdownMenu.Sub>
    );
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
          <div className={styles.pagetitle}>
            {breadcrumb.length > 0 ? (
              breadcrumb.map((b, i) => (
                <span
                  key={i}
                  className={
                    i < breadcrumb.length - 1 ? "d-none d-lg-inline" : ""
                  }
                  title={b.display}
                >
                  {i > 0 && (
                    <FaAngleRight className="mx-2 d-none d-lg-inline" />
                  )}
                  {b.href ? (
                    <Link className={styles.breadcrumblink} href={b.href}>
                      {b.display}
                    </Link>
                  ) : (
                    b.display
                  )}
                </span>
              ))
            ) : (
              <>{pageTitle}</>
            )}
          </div>
          {/* <AccountPlanBadge /> */}

          {/* {showNotices && (
            <>
              <AccountPlanNotices />

              {(watchedExperiments.length > 0 ||
                watchedFeatures.length > 0) && (
                <Link href="/activity" className="nav-link mr-1 text-secondary">
                  <FaBell />
                </Link>
              )}
            </>
          )} */}

          {/*  */}
          {organizations && organizations.length > 1 && (
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
              </div>
            </div>
          )}

          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <div className="nav-link">
                <Avatar email={email || ""} size={26} />{" "}
                <span className="d-none d-lg-inline">
                  <OverflowText maxWidth={200}>{email}</OverflowText>
                </span>
              </div>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="start">
              <DropdownMenu.Label>{planCopy}</DropdownMenu.Label>
              {renderOrganizationSubDropDown()}
              {renderThemeSubDropDown()}
              {renderMyActivityFeedsDropDown()}
              {renderMyReportsDropDown()}
              {renderPersonalAccessTokensDropDown()}
              <DropdownMenu.Separator />
              {renderNameAndEmailDropdownLabel()}
              {renderEditProfileDropDown()}
              {renderLogoutDropDown()}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      </div>
    </>
  );
};
export default TopNav;
