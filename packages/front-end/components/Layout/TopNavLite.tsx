import Head from "next/head";
import { FaAngleRight } from "react-icons/fa";
import Link from "next/link";
import { safeLogout } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Avatar from "@/components/Avatar/Avatar";
import Button from "@/components/Button";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { usePageHead } from "@/components/Layout/PageHead";
import { ThemeToggler } from "./ThemeToggler/ThemeToggler";
import styles from "./TopNav.module.scss";

export default function TopNavLite({ pageTitle }: { pageTitle?: string }) {
  const { email, name, user } = useUser();
  const { theme } = useAppearanceUITheme();
  const { breadcrumb } = usePageHead();

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
    <div className="navbar bg-white border-bottom" style={{ minHeight: 56 }}>
      <Head>
        <title>GrowthBook</title>
      </Head>
      <div style={{ width: 240 }}>
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
      </div>
      {renderTitleOrBreadCrumb()}
      <div className="ml-auto">
        <ThemeToggler />
      </div>
      {email && (
        <div className="mr-4 d-flex">
          <Avatar email={email} size={26} name={name || ""} className="mr-2" />{" "}
          <span className="d-none d-lg-inline">{email}</span>
        </div>
      )}
      <div>
        {user && (
          <Button
            onClick={async () => {
              await safeLogout();
            }}
            color="danger"
          >
            Log Out
          </Button>
        )}
      </div>
    </div>
  );
}
