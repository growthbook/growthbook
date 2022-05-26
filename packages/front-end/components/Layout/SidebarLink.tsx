import { FC, useState } from "react";
import Link from "next/link";
import { IconType } from "react-icons/lib";
import useUser from "../../hooks/useUser";
import { useRouter } from "next/router";
import clsx from "clsx";
import styles from "./SidebarLink.module.scss";
import { FiChevronRight } from "react-icons/fi";
import { isCloud } from "../../services/env";
import { Permissions } from "back-end/types/organization";

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
  permissions?: (keyof Permissions)[];
  subLinks?: SidebarLinkProps[];
  beta?: boolean;
};

const SidebarLink: FC<SidebarLinkProps> = (props) => {
  const { permissions, admin } = useUser();
  const router = useRouter();

  if (props.superAdmin && !admin) return null;
  if (props.permissions) {
    for (let i = 0; i < props.permissions.length; i++) {
      if (!permissions[props.permissions[i]]) {
        return null;
      }
    }
  }

  if (props.cloudOnly && !isCloud()) {
    return null;
  }
  if (props.selfHostedOnly && isCloud()) {
    return null;
  }

  const path = router.route.substr(1);
  const selected = props.path.test(path);
  const showSubMenuIcons = true;

  const [open, setOpen] = useState(selected);

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
          [styles.expanded]: open,
        })}
      >
        <a
          className={clsx("align-middle", {
            "no-close": props.subLinks && !props.autoClose,
          })}
          href={props.href}
          onClick={(e) => {
            e.preventDefault();
            if (props.subLinks) {
              setOpen(!open);
              e.stopPropagation();
            } else {
              router.push(props.href);
            }
          }}
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
            <div className={clsx("float-right", styles.chevron)}>
              <FiChevronRight />
            </div>
          )}
        </a>
      </li>
      {props.subLinks && (
        <ul
          className={clsx(styles.sublinks, {
            [styles.open]: open || selected,
          })}
        >
          {props.subLinks.map((l) => {
            if (l.superAdmin && !admin) return null;

            if (l.permissions) {
              for (let i = 0; i < l.permissions.length; i++) {
                if (!permissions[l.permissions[i]]) {
                  return null;
                }
              }
            }
            if (l.cloudOnly && !isCloud()) {
              return null;
            }
            if (l.selfHostedOnly && isCloud()) {
              return null;
            }

            const sublinkSelected = l.path.test(path);

            return (
              <li
                key={l.href}
                className={clsx(
                  "sidebarlink sublink",
                  styles.link,
                  styles.sublink,
                  {
                    [styles.subdivider]: l.divider,
                    [styles.selected]: sublinkSelected,
                    selected: sublinkSelected,
                    [styles.collapsed]: !open && !sublinkSelected,
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
