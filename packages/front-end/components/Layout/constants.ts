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
 * narrower, Settings takes its narrow layout too. Measured on General: at
 * 950px a card's select runs past its edge.
 */
export const SETTINGS_WIDE_MIN_PAGE_AREA_PX = 952;
