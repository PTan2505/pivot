import { importSkillGuides } from "@stan-bag/core/skills";
import { body, json, route } from "@/lib/server/http";

/** Loads usage guides (pack info, invocation, how-to, example prompts) for skills by name. */
export const POST = route(async (req: Request) => json(await importSkillGuides(await body(req))));
