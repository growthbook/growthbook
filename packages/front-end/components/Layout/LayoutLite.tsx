import clsx from "clsx";
import styles from "./LayoutLite.module.scss";
import TopNav from "./TopNav";

const LayoutLite = (): React.ReactElement => {
  return (
    <>
      <div
        className={clsx(styles.sidebar, "sidebar mb-5")}
        style={{ height: "auto" }}
      >
        <div className="">
          <div className="app-sidebar-header">
            <div className="app-sidebar-logo">
              <div
                aria-current="page"
                className="app-sidebar-logo active"
                title="GrowthBook Home"
              >
                <div className={styles.sidebarlogo}>
                  <img
                    className={styles.logo}
                    alt="GrowthBook"
                    src="/logo/growth-book-logomark-white.svg"
                  />
                  <img
                    className={styles.logotext}
                    alt="GrowthBook"
                    src="/logo/growth-book-name-white.svg"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <TopNav showNotices={false} />
    </>
  );
};

export default LayoutLite;
