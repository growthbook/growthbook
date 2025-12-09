import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import { useRouter } from "next/router";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { SavedQuery } from "back-end/src/validators/saved-queries";
import { AppFeatures } from "@/types/app-features";
import { isCloud, isMultiOrg } from "@/services/env";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import useApi from "@/hooks/useApi";
import { navlinks, SidebarLinkProps } from "./sidebarLinksConfig";
import { useCommandPalette } from "./CommandPaletteContext";
import styles from "./CommandPalette.module.scss";

export default function CommandPalette() {
  const { isCommandPaletteOpen, setIsCommandPaletteOpen } = useCommandPalette();
  const [search, setSearch] = useState("");
  const router = useRouter();

  // Toggle with Cmd+K
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsCommandPaletteOpen((open) => {
          if (open) setSearch("");
          return !open;
        });
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setIsCommandPaletteOpen(false);
        setSearch("");
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [setIsCommandPaletteOpen]);

  // Hooks for filtering
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
  const growthbook = useGrowthBook<AppFeatures>();
  const permissionsUtils = usePermissionsUtil();

  // Filter items based on search
  const filteredGroups = useMemo(() => {
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

    const groups: {
      heading: string;
      parentItem?: SidebarLinkProps;
      items: SidebarLinkProps[];
      showHeading: boolean;
    }[] = [];

    const normalize = (s: string) => s.toLowerCase().trim();
    const term = normalize(search);

    // Helper to check if item matches
    const matches = (item: SidebarLinkProps) => {
      if (!term) return true;
      return normalize(item.name).includes(term);
    };

    navlinks.forEach((link) => {
      if (link.filter && !link.filter(filterProps)) return;

      // If no search, only show top-level items
      if (!term) {
        groups.push({
          heading: link.name,
          items: [link],
          showHeading: false, // Don't show heading in default view, just the item
        });
        return;
      }

      const linkMatches = matches(link);
      const validSubLinks = (link.subLinks || []).filter((sl) => {
        if (sl.filter && !sl.filter(filterProps)) return false;
        return matches(sl);
      });

      if (linkMatches || validSubLinks.length > 0) {
        // Determine what to show
        const groupItems: SidebarLinkProps[] = [];
        let showHeading = false;

        if (linkMatches) {
          // If parent matches, show it first
          groupItems.push(link);
          // And show all matching children indented
          groupItems.push(...validSubLinks);
        } else {
          // Parent doesn't match, but children do.
          // Show Heading (Breadcrumb) and then children
          showHeading = true;
          groupItems.push(...validSubLinks);
        }

        groups.push({
          heading: link.name,
          parentItem: link,
          items: groupItems,
          showHeading,
        });
      }
    });

    return groups;
  }, [
    search,
    permissionsUtils,
    permissions,
    superAdmin,
    growthbook,
    project,
    segments,
    savedQueries,
  ]);

  if (!isCommandPaletteOpen) return null;

  return (
    <div
      className={styles.overlay}
      onClick={() => {
        setIsCommandPaletteOpen(false);
        setSearch("");
      }}
    >
      <div onClick={(e) => e.stopPropagation()}>
        <Command
          className={styles.content}
          loop
          shouldFilter={false} // We filter manually
        >
          <Command.Input
            autoFocus
            className={styles.input}
            placeholder="Type a command or search..."
            value={search}
            onValueChange={setSearch}
          />
          <Command.List className={styles.list}>
            <Command.Empty className={styles.empty}>
              No results found.
            </Command.Empty>

            {filteredGroups.map((group) => (
              <div key={group.heading} className={styles.group}>
                {group.showHeading && (
                  <div className={styles.groupHeading}>{group.heading}</div>
                )}
                {group.items.map((item) => {
                  const isChild = group.parentItem && item !== group.parentItem;
                  return (
                    <Command.Item
                      key={item.name + item.href}
                      className={styles.item}
                      data-child={isChild}
                      onSelect={() => {
                        router.push(item.href);
                        setIsCommandPaletteOpen(false);
                        setSearch("");
                      }}
                      value={item.name}
                    >
                      <div className={styles.itemIcon}>
                        {item.Icon ? (
                          <item.Icon />
                        ) : item.icon ? (
                          <img
                            src={`/icons/${item.icon}`}
                            alt=""
                            style={{ width: "100%", height: "100%" }}
                          />
                        ) : null}
                      </div>
                      {item.name}
                    </Command.Item>
                  );
                })}
              </div>
            ))}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
