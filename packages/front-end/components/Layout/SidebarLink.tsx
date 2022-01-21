import { FC } from "react";
import Link from "next/link";
import { IconType } from "react-icons/lib";
import useUser from "../../hooks/useUser";
import { useRouter } from "next/router";
import clsx from "clsx";
import styles from "./SidebarLink.module.scss";
import { FiChevronDown } from "react-icons/fi";
import { isCloud } from "../../services/env";

export type SidebarLinkProps = {
  name: string;
  href: string;
  path: RegExp;
  icon?: string;
  Icon?: IconType;
  divider?: boolean;
  sectionTitle?: string;
  className?: string;
  superAdmin?: boolean;
  cloudOnly?: boolean;
  selfHostedOnly?: boolean;
  autoClose?: boolean;
  settingsPermission?: boolean;
  subLinks?: SidebarLinkProps[];
  beta?: boolean;
};

const SidebarLink: FC<SidebarLinkProps> = (props) => {
  const { permissions, admin } = useUser();
  const router = useRouter();

  if (props.superAdmin && !admin) return null;
  if (props.settingsPermission && !permissions.organizationSettings)
    return null;

  if (props.cloudOnly && !isCloud()) {
    return null;
  }
  if (props.selfHostedOnly && isCloud()) {
    return null;
  }

  const path = router.route.substr(1);
  const selected = props.path.test(path);
  const showSubMenuIcons = true;

  return (
    <>
      {props.divider && (
        <li
          className={clsx(styles.menuSection, {
            [styles.divider]: props.divider,
          })}
        >
          {props.sectionTitle}
        </li>
      )}
      <li
        key={props.href}
        className={clsx("sidebarlink", props.className, styles.link, {
          [styles.selected]: selected,
          selected: selected,
          [styles.submenusection]: selected && props.subLinks,
        })}
      >
        <Link href={props.href}>
          <a
            className={clsx("align-middle", {
              "no-close": props.subLinks && !props.autoClose,
            })}
          >
            {props.Icon && <props.Icon className={styles.icon} />}
            {props.icon && (
              <span>
                <img src={`/icons/${props.icon}`} />
              </span>
            )}
            {props.name}
            {props.beta && <div className="badge badge-warning ml-2">beta</div>}
            {props.subLinks && (
              <div className="float-right">
                <FiChevronDown />
              </div>
            )}
          </a>
        </Link>
      </li>
      {selected && props.subLinks && (
        <ul className={styles.sublinks}>
          {props.subLinks.map((l) => {
            if (l.superAdmin && !admin) return null;
            if (l.settingsPermission && !permissions.organizationSettings)
              return null;
            if (l.cloudOnly && !isCloud()) {
              return null;
            }
            if (l.selfHostedOnly && isCloud()) {
              return null;
            }

            return (
              <li
                key={l.href}
                className={clsx(
                  "sidebarlink sublink",
                  styles.link,
                  styles.sublink,
                  {
                    [styles.selected]: l.path.test(path),
                    selected: l.path.test(path),
                  }
                )}
              >
                <Link href={l.href}>
                  <a className="align-middle">
                    {showSubMenuIcons && (
                      <>
                        {l.Icon && <l.Icon className={styles.icon} />}
                        {l.icon && (
                          <span>
                            <img src={`/icons/${l.icon}`} />
                          </span>
                        )}
                      </>
                    )}
                    {l.name}
                  </a>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
};
export default SidebarLink;
