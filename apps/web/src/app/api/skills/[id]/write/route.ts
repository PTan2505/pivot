import { z } from "zod";
import { OwnerAuthError } from "@pivot/core/owner-approval";
import { writeSkillToDisk } from "@pivot/core/skills";
import { body, HttpError, json, route, type IdParams } from "@/lib/server/http";

/**
 * Writes the skill to Claude Code's skills folder. Owner only: a skill there is loaded into every Claude Code session as
 * instructions, so the API token (an agent's) can't do it. Needs the owner passphrase, a challenge from
 * `write-challenge`, and the hash of the content the owner saw.
 */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const input = z
    .object({
      force: z.boolean().optional(),
      passphrase: z.string().max(1000).optional(),
      challenge: z.string().max(200).optional(),
      contentHash: z.string().max(200).default(""),
    })
    .parse(await body(req));
  try {
    return json(
      await writeSkillToDisk((await params).id, {
        force: !!input.force,
        owner: {
          bearer: req.headers.get("authorization"),
          passphrase: input.passphrase,
          challenge: input.challenge,
          contentHash: input.contentHash,
        },
      }),
    );
  } catch (err) {
    if (err instanceof OwnerAuthError) throw new HttpError(err.status, err.message);
    throw err;
  }
});
