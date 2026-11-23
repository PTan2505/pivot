import { unstable_rethrow } from "next/navigation";
import { connection, NextResponse } from "next/server";
import { ZodError } from "zod";
import { AssetError } from "@pivot/core/assets";
import { ComponentConflictError, ComponentError } from "@pivot/core/components";
import { retryOnConnectionError } from "@pivot/core/db/connection";
import { UnsafeUrlError } from "@pivot/core/net-guard";
import { ResourceRuleError } from "@pivot/core/resources";
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

/** GET and HEAD don't change anything, so they can run again; other methods never are. */
const isSafeRequest = (req: unknown) => req instanceof Request && (req.method === "GET" || req.method === "HEAD");

/**
 * Wraps a route handler: always runs at request time (never prerendered at build, which would
 * open the database), and thrown errors become `{ error }` JSON with a sensible status. A GET or
 * HEAD that fails on a database connection that died while idle (a laptop that slept) runs again
 * until it reaches a fresh connection (at most once per pooled connection).
 */
export function route<Args extends unknown[]>(fn: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    await connection();
    try {
      if (!isSafeRequest(args[0])) return await fn(...args);
      return await retryOnConnectionError(() => fn(...args), {
        onRetry: (err) => console.warn("[pivot] database connection was reset; running the request again", err),
      });
    } catch (err) {
      unstable_rethrow(err);
      if (err instanceof HttpError) return json({ error: err.message }, { status: err.status });
      if (err instanceof ZodError) {
        const first = err.issues[0];
        return json({ error: `${first?.path.join(".") || "input"}: ${first?.message}` }, { status: 400 });
      }
      if (
        err instanceof UnsafeUrlError ||
        err instanceof AssetError ||
        err instanceof ComponentError ||
        err instanceof ResourceRuleError
      )
        return json({ error: err.message }, { status: 400 });
      if (err instanceof ComponentConflictError) return json({ error: err.message, conflict: true }, { status: 409 });
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
