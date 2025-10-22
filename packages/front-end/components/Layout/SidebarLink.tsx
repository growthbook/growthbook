import { FC, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { IconType } from "react-icons/lib";
import { useRouter } from "next/router";
import clsx from "clsx";
import { FiChevronRight } from "react-icons/fi";
import { GrowthBook, useGrowthBook } from "@growthbook/growthbook-react";
import { GlobalPermission } from "back-end/types/organization";
import { Permissions } from "shared/permissions";
import { SegmentInterface } from "back-end/types/segment";
import { SavedQuery } from "back-end/src/validators/saved-queries";
import { AppFeatures } from "@/types/app-features";
import { isCloud, isMultiOrg } from "@/services/env";
import { PermissionFunctions, useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import useApi from "@/hooks/useApi";
import styles from "./SidebarLink.module.scss";

export type SidebarLinkProps = {
  name: string;
  href: string;
  path: RegExp;
  icon?: string;
  Icon?: IconType;
  divider?: boolean;
  sectionTitle?: string;
  className?: string;
  autoClose?: boolean;
  navigateOnExpand?: boolean;
  filter?: (props: {
    permissionsUtils: Permissions;
    segments: SegmentInterface[];
    permissions: Record<GlobalPermission, boolean> & PermissionFunctions;
    superAdmin: boolean;
    isCloud: boolean;
    isMultiOrg: boolean;
    gb?: GrowthBook<AppFeatures>;
    project?: string;
    savedQueries: SavedQuery[];
  }) => boolean;
  subLinks?: SidebarLinkProps[];
  beta?: boolean;
};

const SidebarLink: FC<SidebarLinkProps> = (props) => {
  const { permissions, superAdmin } = useUser();
  const { project, segments } = useDefinitions();
  const { data: savedQueryData } = useApi<{
    status: number;
    savedQueries: SavedQuery[];
  }>("/saved-queries");
  const savedQueries = useMemo(
    () => savedQueryData?.savedQueries ?? [],
    [savedQueryData],
  );

  const router = useRouter();

  const path = router.route.substr(1);
  const selected = props.path.test(path);
  const showSubMenuIcons = true;

  const growthbook = useGrowthBook<AppFeatures>();
  const permissionsUtils = usePermissionsUtil();

  const [open, setOpen] = useState(selected);

  // If we navigate to a page and the nav isn't expanded yet
  useEffect(() => {
    if (selected) {
      setOpen(true);
    }
  }, [selected]);

  const filterProps = {
    permissionsUtils,
    permissions,
    superAdmin: !!superAdmin,
    isCloud: isCloud(),
    isMultiOrg: isMultiOrg(),
    gb: growthbook,
    project,
    segments,
    savedQueries,
  };

  if (props.filter && !props.filter(filterProps)) {
    return null;
  }

  const permittedSubLinks = (props.subLinks || []).filter(
    (l) => !l.filter || l.filter(filterProps),
  );

  if (props.subLinks && !permittedSubLinks.length) {
    return null;
  }

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
            // Allow browser default behavior for modifier keys (cmd/ctrl/shift) or middle mouse button
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) {
              return;
            }

            e.preventDefault();
            if (props.subLinks) {
              // If it's currently closed and it's set to navigate on expand
              if (!open && !selected && props.navigateOnExpand && props.href) {
                router.push(props.href);
              }

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
          {props.beta && (
            <div
              className="badge border text-uppercase ml-2"
              style={{ opacity: 0.65 }}
            >
              beta
            </div>
          )}
          {props.subLinks && (
            <div className={clsx("float-right", styles.chevron)}>
              <FiChevronRight />
            </div>
          )}
        </a>
      </li>
      {permittedSubLinks.length > 0 ? (
        <ul
          className={clsx(styles.sublinks, {
            [styles.open]: open || selected,
          })}
        >
          {permittedSubLinks.map((l) => {
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
                  },
                )}
              >
                <Link href={l.href} className="align-middle">
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
                  {l.beta && (
                    <div className="badge badge-purple ml-2">beta</div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
};
export default SidebarLink;
