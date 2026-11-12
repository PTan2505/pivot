import { getResource } from "@pivot/core/resources";
import { issueSkillWriteChallenge, ownerPassphraseStatus } from "@pivot/core/owner-approval";
import { skillContentHash, skillFolderName, skillsDirPath, skillWriteBinding } from "@pivot/core/skills";
import { HttpError, json, route, type IdParams } from "@/lib/server/http";

/**
 * A single-use challenge for writing this skill to disk, bound to the content as stored now, the folder it goes to and
 * whether it overwrites (`?force=1`). `?hash=` is the hash of the content the owner's page shows: if the stored content
 * differs (it changed since the page loaded), 409. Returns the content and the target, which the dialog shows. Grants
 * nothing by itself: the write also needs the owner passphrase. `ready: false` when no passphrase is set yet.
 */
export const GET = route(async (req: Request, { params }: IdParams) => {
  const r = await getResource((await params).id);
  if (!r || r.type !== "skill" || r.deletedAt) throw new HttpError(404, "Skill not found.");
  const q = new URL(req.url).searchParams;
  const content = r.content ?? "";
  const contentHash = skillContentHash(content);
  if ((q.get("hash") ?? "").toLowerCase() !== contentHash)
    throw new HttpError(
      409,
      "The skill changed since this page loaded (maybe by an agent). Reload the page and review it.",
    );
  if (!ownerPassphraseStatus().set) return json({ ready: false, setup: "pnpm owner:passphrase" });
  const force = q.get("force") === "1";
  const skillName = skillFolderName(r);
  return json({
    ready: true,
    contentHash,
    content,
    skillName,
    target: `${skillsDirPath()}/${skillName}/SKILL.md`,
    force,
    ...issueSkillWriteChallenge({ resourceId: r.id, binding: skillWriteBinding(force, skillName, contentHash) }),
  });
});
