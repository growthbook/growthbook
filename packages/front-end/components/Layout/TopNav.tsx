import { FC, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { FaBars } from "react-icons/fa";
import {
  PiPlusBold,
  PiCaretDownFill,
  PiCircleHalf,
  PiHourglassHigh,
  PiListChecks,
  PiMoon,
  PiSunDim,
  PiBuildingFill,
  PiSparkle,
} from "react-icons/pi";
import Head from "next/head";
import { Flex, Text } from "@radix-ui/themes";
import router from "next/router";
import Breadcrumbs from "@/ui/Breadcrumbs";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownSubMenu,
} from "@/ui/DropdownMenu";
import Link from "@/ui/Link";
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
import UserAvatar from "@/components/Avatar/UserAvatar";
import ChangePasswordModal from "@/components/Auth/ChangePasswordModal";
import Field from "@/components/Forms/Field";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import Checkbox from "@/ui/Checkbox";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import AccountPlanNotices from "@/components/Layout/AccountPlanNotices";
import AccountPlanBadge from "@/components/Layout/AccountPlanBadge";
import { useOpenRevisionCount } from "@/hooks/useRevisions";
import { useAgentPanel } from "@/components/Agent/AgentPanelContext";
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

  const { updateUser, name, email, organization, hasCommercialFeature } =
    useUser();

  const { apiCall, logout, organizations, orgId, setOrgId } = useAuth();

  const hasApprovalFlows = hasCommercialFeature("require-approvals");
  // Lightweight count endpoint — avoids fetching every open revision document
  // just to render a badge. Filtered server-side to non-merged/non-discarded.
  const { count: openRevisionCount } = useOpenRevisionCount();
  const pendingReviewCount = hasApprovalFlows ? openRevisionCount : 0;

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

  const {
    available: agentAvailable,
    open: agentOpen,
    togglePanel: toggleAgentPanel,
  } = useAgentPanel();

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
        Edit profile
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
        onClick={() => {
          setDropdownOpen(false);
          router.push("/account/personal-access-tokens");
        }}
      >
        Personal Access Tokens
      </DropdownMenuItem>
    );
  };
  const renderMyReportsDropDown = () => {
    return (
      <DropdownMenuItem
        onClick={() => {
          setDropdownOpen(false);
          router.push("/reports");
        }}
      >
        My Reports
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
  const renderPendingReviewsDropDown = () => {
    if (!hasApprovalFlows) return null;
    return (
      <DropdownMenuItem
        className={styles.dropdownItemIconColor}
        onClick={() => {
          setDropdownOpen(false);
          router.push("/approval-requests");
        }}
      >
        <div className="align-middle d-flex align-items-center">
          <PiHourglassHigh size="16" className="mr-1" />
          Pending Reviews
          {pendingReviewCount > 0 && (
            <span
              style={{
                backgroundColor: "var(--red-9)",
                color: "white",
                borderRadius: "50%",
                minWidth: 18,
                height: 18,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 600,
                marginLeft: 6,
                padding: "0 4px",
              }}
            >
              {pendingReviewCount}
            </span>
          )}
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
        <Flex direction="row" align="center" gap="1" mr="2">
          <PiBuildingFill className="text-muted" />
          <span className="d-none d-lg-inline">{orgName}</span>
        </Flex>
      );
    }

    if (organizations && organizations.length > 1) {
      return (
        <DropdownMenu
          open={orgDropdownOpen}
          onOpenChange={(open) => {
            setOrgDropdownOpen(open);
          }}
          trigger={
            <Flex direction="row" align="center" gap="1" mr="2">
              <PiBuildingFill className="text-muted" />
              <span className="d-none d-lg-inline">
                <OverflowText maxWidth={200}>{orgName}</OverflowText>
              </span>
              <PiCaretDownFill />
            </Flex>
          }
        >
          <DropdownMenuLabel>Organization</DropdownMenuLabel>
          {organizations.map((o) => (
            <DropdownMenuItem
              key={o.id}
              onClick={() => {
                if (setOrgId) {
                  setOrgId(o.id);

                  try {
                    localStorage.setItem("gb-last-picked-org", `"${o.id}"`);
                  } catch (e) {
                    console.warn("Unable to save last org in localStorage");
                  }
                }

                setOrgDropdownOpen(false);
              }}
            >
              {o.name}
            </DropdownMenuItem>
          ))}
          {!isCloud() &&
            isMultiOrg() &&
            (showMultiOrgSelfSelector() || allowSelfOrgCreation()) && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setOrgDropdownOpen(false);
                    router.push("/settings/organizations");
                  }}
                >
                  <Flex align="center" gap="1">
                    <PiPlusBold />
                    Add Organization
                  </Flex>
                </DropdownMenuItem>
              </>
            )}
        </DropdownMenu>
      );
    }
  };

  const renderTitleOrBreadCrumb = () => {
    const breadcrumbItems =
      breadcrumb.length > 0 ? breadcrumb : [{ display: pageTitle }];

    return (
      <div className={styles.pagetitle}>
        <Breadcrumbs items={breadcrumbItems} />
      </div>
    );
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
          useRadixButton={false}
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
            <Link
              id="main-menu-toggle"
              className={styles.mobilemenu}
              aria-label="Open main menu"
              onClick={() => {
                toggleLeftMenu();
              }}
            >
              <span className="sr-only">Open main menu</span>
              <FaBars />
            </Link>
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
          {agentAvailable && (
            <button
              type="button"
              onClick={toggleAgentPanel}
              aria-label={
                agentOpen
                  ? "Close GrowthBook AI assistant"
                  : "Open GrowthBook AI assistant"
              }
              aria-pressed={agentOpen}
              title="Ask GrowthBook AI"
              className={`nav-link ${styles.agentTrigger} ${
                agentOpen ? styles.agentTriggerActive : ""
              }`}
            >
              <PiSparkle size={18} />
            </button>
          )}
          <DropdownMenu
            variant="solid"
            open={dropdownOpen}
            onOpenChange={(o) => {
              setDropdownOpen(!!o);
            }}
            trigger={
              <div className="nav-link d-flex align-items-center">
                <UserAvatar
                  email={email || ""}
                  name={name || ""}
                  size="md"
                  variant="soft"
                  mr="2"
                />{" "}
                <span className="d-none d-lg-inline">
                  <OverflowText maxWidth={200}>
                    <Text weight={"bold"} style={{ fontSize: 14 }}>
                      {email}
                    </Text>
                  </OverflowText>{" "}
                  <PiCaretDownFill />
                </span>
              </div>
            }
          >
            {renderNameAndEmailDropdownLabel()}
            {renderEditProfileDropDown()}
            <DropdownMenuSeparator />
            {renderPendingReviewsDropDown()}
            {renderMyActivityFeedsDropDown()}
            {renderThemeSubDropDown()}
            <DropdownMenuSeparator />
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
