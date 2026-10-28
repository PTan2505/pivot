import { unstable_rethrow } from "next/navigation";
import { connection, NextResponse } from "next/server";
import { ZodError } from "zod";
import { AssetError } from "@pivot/core/assets";
import { UnsafeUrlError } from "@pivot/core/net-guard";
import { SkillConflictError } from "@pivot/core/skills";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

/**
 * Wraps a route handler: always runs at request time (never prerendered at build, which would
 * open the database), and thrown errors become `{ error }` JSON with a sensible status.
 */
export function route<Args extends unknown[]>(fn: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    await connection();
    try {
      return await fn(...args);
    } catch (err) {
      unstable_rethrow(err);
      if (err instanceof HttpError) return json({ error: err.message }, { status: err.status });
      if (err instanceof ZodError) {
        const first = err.issues[0];
        return json({ error: `${first?.path.join(".") || "input"}: ${first?.message}` }, { status: 400 });
      }
      if (err instanceof UnsafeUrlError || err instanceof AssetError)
        return json({ error: err.message }, { status: 400 });
      if (err instanceof SkillConflictError) return json({ error: err.message, conflict: true }, { status: 409 });
      console.error("[pivot]", err);
      return json({ error: err instanceof Error ? err.message : "Something went wrong" }, { status: 500 });
    }
  };
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Request body must be JSON.");
  }
}

export type IdParams = { params: Promise<{ id: string }> };
