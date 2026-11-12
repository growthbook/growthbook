import { dispatchInternal, normalizePath } from "back-end/src/agent/dispatcher";
import type { ReferenceAction } from "./scenario";
import type { ApiCall } from "./record";
import type { World } from "./world";

// Sends the ideal agent's requests through the same REST handlers the agent's
// callApi reaches, as the trial's admin.
export async function replayReferenceActions(
  world: World,
  actions: ReferenceAction[],
): Promise<{ calls: ApiCall[]; responses: unknown[] }> {
  const calls: ApiCall[] = [];
  const responses: unknown[] = [];
  for (const { method, path, query, body: requestBody } of actions) {
    const request = { method, path, query, body: requestBody };
    const { status, body } = await dispatchInternal(world.context, request);
    calls.push({ ...request, path: normalizePath(request.path), status });
    responses.push(body);
  }
  return { calls, responses };
}
