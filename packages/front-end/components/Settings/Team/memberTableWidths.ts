// Lines the member tables up column-for-column (name + email = emailNoName,
// date + date = dateOnly). Each table sums to 100% so the fixed layout has no
// spare width to hand the actions column.
export const MEMBER_COLUMN_WIDTHS = {
  name: "12%",
  email: "18%",
  emailNoName: "30%",
  date: "12%",
  dateOnly: "24%",
  role: "14%",
  projectRoles: "14%",
  teams: "14%",
  // The project page drops Project Roles; Role and Teams split its share.
  roleOnProject: "21%",
  teamsOnProject: "21%",
  teamName: "16%",
  teamDescription: "24%",
  teamDate: "14%",
  actions: "4%",
} as const;

/**
 * Narrower than this, a member table scrolls sideways in its frame rather than
 * squeezing its columns (e.g. on a narrow window). Measured with the
 * sort icons: at 834px the members table's Date joined icon crosses into the
 * Last login column (and from 734px runs into its text). The other tables,
 * without sort icons, fit narrower. Shared, so the tables stay lined up.
 */
export const MEMBER_TABLE_MIN_WIDTH = 836;
