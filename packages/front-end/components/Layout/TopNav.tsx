import { FC, useState } from "react";
import { useForm } from "react-hook-form";
import { FaBars, FaBell, FaBuilding } from "react-icons/fa";
import Link from "next/link";
import clsx from "clsx";
import Head from "next/head";
import { useWatching } from "@/services/WatchProvider";
import useGlobalMenu from "@/services/useGlobalMenu";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import { usingSSO } from "@/services/env";
import { useDefinitions } from "@/services/DefinitionsContext";
import Modal from "../Modal";
import Avatar from "../Avatar/Avatar";
import ChangePasswordModal from "../Auth/ChangePasswordModal";
import Field from "../Forms/Field";
import styles from "./TopNav.module.scss";
import { ThemeToggler } from "./ThemeToggler/ThemeToggler";
import AccountPlanBadge from "./AccountPlanBadge";
import AccountPlanNotices from "./AccountPlanNotices";

const TopNav: FC<{
  toggleLeftMenu?: () => void;
  pageTitle?: string;
  showNotices?: boolean;
}> = ({ toggleLeftMenu, pageTitle, showNotices }) => {
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);
  const { watchedExperiments, watchedFeatures } = useWatching();
  const [editUserOpen, setEditUserOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  useGlobalMenu(".top-nav-user-menu", () => setUserDropdownOpen(false));
  useGlobalMenu(".top-nav-org-menu", () => setOrgDropdownOpen(false));

  const { updateUser, user, name, email } = useUser();

  const { datasources } = useDefinitions();

  const { apiCall, logout, organizations, orgId, setOrgId } = useAuth();

  const form = useForm({
    defaultValues: { name: name || "" },
  });

  const onSubmitEditName = form.handleSubmit(async (value) => {
    await apiCall(`/user/name`, {
      method: "PUT",
      body: JSON.stringify(value),
    });
    updateUser();
    setUserDropdownOpen(false);
  });

  let orgName = orgId || "";

  if (organizations && organizations.length) {
    organizations.forEach((o) => {
      if (o.id === orgId) {
        orgName = o.name;
      }
    });
  }

  return (
    <>
      <Head>
        <title>GrowthBook - {pageTitle}</title>
      </Head>
      {editUserOpen && (
        <Modal
          close={() => setEditUserOpen(false)}
          submit={onSubmitEditName}
          header="Edit Profile"
          open={true}
        >
          <Field label="Name" {...form.register("name")} />
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

        <span className={styles.pagetitle}>{pageTitle}</span>

        <div style={{ flex: 1 }} />

        <ThemeToggler />

        {showNotices && (
          <>
            <AccountPlanNotices />
            <AccountPlanBadge />

            {(watchedExperiments.length > 0 || watchedFeatures.length > 0) && (
              <Link href="/activity">
                <a className="nav-link mr-1 text-secondary">
                  <FaBell />
                </a>
              </Link>
            )}
          </>
        )}

        {organizations && organizations.length === 1 && (
          <div className="top-nav-org-menu mr-2">
            <FaBuilding className="text-muted mr-1" />
            <span className="d-none d-lg-inline">{orgName}</span>
          </div>
        )}
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
              <span className="d-none d-lg-inline">{orgName}</span>
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
                    setOrgId(o.id);
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

        <div className="dropdown top-nav-user-menu">
          <div
            className={`nav-link dropdown-toggle`}
            onClick={(e) => {
              e.preventDefault();
              setUserDropdownOpen(!userDropdownOpen);
            }}
            style={{ cursor: "pointer" }}
          >
            <Avatar email={email} size={26} />{" "}
            <span className="d-none d-lg-inline">{email}</span>
          </div>
          <div
            className={clsx("dropdown-menu dropdown-menu-right", {
              show: userDropdownOpen,
            })}
          >
            <div className={`mb-2 dropdown-item ${styles.userinfo}`}>
              <div className="text-muted">{email}</div>
              {name && <div style={{ fontSize: "1.3em" }}>{name}</div>}
              {user?.role && (
                <span className="badge badge-secondary">{user.role}</span>
              )}
            </div>
            {datasources?.length > 0 && (
              <>
                <div className="dropdown-divider"></div>
                <Link href={"/reports"}>
                  <a
                    className="dropdown-item"
                    onClick={() => {
                      setUserDropdownOpen(false);
                    }}
                  >
                    My Reports
                  </a>
                </Link>
              </>
            )}
            <div className="dropdown-divider"></div>
            <button
              className="dropdown-item"
              onClick={(e) => {
                e.preventDefault();
                setEditUserOpen(true);
              }}
            >
              Edit Profile
            </button>
            <div className="dropdown-divider"></div>
            {!usingSSO() && (
              <>
                <button
                  className="dropdown-item"
                  onClick={(e) => {
                    e.preventDefault();
                    setChangePasswordOpen(true);
                  }}
                >
                  Change Password
                </button>
                <div className="dropdown-divider"></div>
              </>
            )}
            <button
              className="dropdown-item"
              onClick={(e) => {
                e.preventDefault();
                logout();
                setUserDropdownOpen(false);
              }}
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
export default TopNav;
