/** Below this width the sidebar becomes a drawer. */
export const NARROW_LAYOUT_BREAKPOINT_PX = 1180;

/**
 * From this width the Settings nav is a column; narrower, it's
 * SettingsJumpMenu, at the page's top. Keep in sync with global.scss.
 */
export const SETTINGS_NAV_MIN_WIDTH_PX = 1024;

/**
 * With the AI panel docked, the narrowest page area (the window less the side
 * nav and the panel) that holds the Settings nav column and two-column cards;
 * narrower, Settings takes its narrow layout too. Measured across every
 * Settings page, tab and search: at 1010px the Bandits card's "Day(s)" select
 * starts to push into the card's padding.
 */
export const SETTINGS_WIDE_MIN_PAGE_AREA_PX = 1012;
