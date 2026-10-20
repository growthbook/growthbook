import {
  getRolePermissions,
  Permissions,
  userHasPermission,
} from "shared/permissions";
import {
  buildGridOrg,
  buildGridPersonas,
  endpointPermissions,
  ENV_SCOPED,
  GRID_ATOMS,
  GRID_ENVS,
  GRID_PROJECTS,
  GRID_TEAMS,
  referenceHasAtom,
  referenceHasUnrestricted,
} from "./grid.fixture";

/**
 * Every persona in the grid, asked every atom in every project and environment,
 * three ways at once:
 *   reference — an independent re-derivation of the documented precedence
 *   control   — what the UI holds (getRolePermissions -> userHasPermission)
 *   endpoint  — what a request holds (ReqContextClass -> canRevisionAction)
 * The three must agree cell for cell. A resolver change that shifts any answer
 * fails here with the exact persona and cell named.
 */

const personas = buildGridPersonas();
const org = buildGridOrg(personas);

const PROJECT_SCOPES = [undefined, ...GRID_PROJECTS] as const;

// canRevisionAction speaks in actions; the control path speaks in atoms.
const ATOM_ACTION = {
  reviewFeatures: "review",
  publishFeatures: "publish",
  editFeatureDrafts: "draft",
} as const;

describe("persona grid: reference, control and endpoint agree", () => {
  it(`covers the full grid (${personas.length} personas)`, () => {
    expect(personas.length).toBe(144);
  });

  describe.each(personas.map((p) => [p.id, p] as const))(
    "%s",
    (_id, persona) => {
      it("answers every atom x project x environment the same three ways", () => {
        const controlPerms = getRolePermissions(
          persona.member,
          org,
          GRID_TEAMS,
        );
        const control = new Permissions(controlPerms);
        const endpoint = endpointPermissions(org, persona);
        const disagreements: string[] = [];
        for (const atom of GRID_ATOMS) {
          for (const project of PROJECT_SCOPES) {
            for (const env of GRID_ENVS) {
              const expected = referenceHasAtom(
                persona.member,
                atom,
                project,
                env,
              );
              // Env constraint only where the atom is env-scoped — the same
              // routing the Permissions class does by REVISION_PERMISSIONS scope.
              const viaControl = userHasPermission(
                controlPerms,
                atom,
                project,
                ENV_SCOPED[atom] ? [env] : undefined,
              );
              const entity = { project: project ?? "" };
              const viaEndpoint = endpoint.canRevisionAction(
                "feature",
                ATOM_ACTION[atom],
                entity,
                [env],
              );
              const viaControlClass = control.canRevisionAction(
                "feature",
                ATOM_ACTION[atom],
                entity,
                [env],
              );
              for (const [name, actual] of [
                ["control", viaControl],
                ["endpoint", viaEndpoint],
                ["control-class", viaControlClass],
              ] as const) {
                if (actual !== expected) {
                  disagreements.push(
                    `${atom} project=${project ?? "(none)"} env=${env}: ${name}=${actual}, reference=${expected}`,
                  );
                }
              }
            }

            // The unbound form: authority no environment limit restricts.
            const expectedUnrestricted = referenceHasUnrestricted(
              persona.member,
              atom,
              project,
            );
            if (ATOM_ACTION[atom] === "review") {
              const viaEndpoint = endpoint.canRevisionAction(
                "feature",
                "review",
                { project: project ?? "" },
                [],
              );
              if (viaEndpoint !== expectedUnrestricted) {
                disagreements.push(
                  `${atom} project=${project ?? "(none)"} unbound: endpoint=${viaEndpoint}, reference=${expectedUnrestricted}`,
                );
              }
            }
          }
        }
        expect(disagreements).toEqual([]);
      });
    },
  );
});
