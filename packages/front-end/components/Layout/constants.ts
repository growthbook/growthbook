// The experiment page's and the redesigned feature page's tab row. Keep in
// sync with --tabs-bar-height in global.scss.
export const TABS_BAR_HEIGHT_PX = 45;

/** Below this width the sidebar becomes a drawer. */
export const NARROW_LAYOUT_BREAKPOINT_PX = 1180;

/**
 * From this width the Settings nav is a column; narrower, it's
 * SettingsJumpMenu, at the page's top. Keep in sync with global.scss.
 */
export const SETTINGS_NAV_MIN_WIDTH_PX = 1024;

export const SETTINGS_WIDE_MIN_PAGE_AREA_PX = 1012;

// Where an in-page link lands, just under the pinned tab bar.
export const SCROLL_MARGIN_UNDER_TABS =
  "calc(var(--tabs-bottom) + var(--space-1))";
