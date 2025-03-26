import Orb from "orb-billing";

export function createOrbClient() {
  return new Orb({
    apiKey: process.env["ORB_TOKEN"],
  });
}
