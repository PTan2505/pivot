import { getResource } from "@pivot/core/resources";
import { issueSkillWriteChallenge, ownerPassphraseStatus } from "@pivot/core/owner-approval";
import { skillContentHash } from "@pivot/core/skills";
import { HttpError, json, route, type IdParams } from "@/lib/server/http";

/**
 * A single-use challenge for writing this skill to disk as its content is stored now. Grants nothing by itself: the
 * write also needs the owner passphrase. `ready: false` when no passphrase is set yet.
 */
export const GET = route(async (_req: Request, { params }: IdParams) => {
  const r = await getResource((await params).id);
  if (!r || r.type !== "skill" || r.deletedAt) throw new HttpError(404, "Skill not found.");
  if (!ownerPassphraseStatus().set) return json({ ready: false, setup: "pnpm owner:passphrase" });
  const contentHash = skillContentHash(r.content ?? "");
  return json({ ready: true, contentHash, ...issueSkillWriteChallenge({ resourceId: r.id, contentHash }) });
});
