import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { dataDir } from "./config";

export type StorageKind = "local" | "r2";

export interface ObjectStream {
  body: ReadableStream;
  /** Bytes in this response (the whole object, or the requested range). */
  length: number;
}

/** Where asset bytes live. Keys are relative paths like `assets/2026-10/<id>.webp`. */
export interface BlobStore {
  kind: StorageKind;
  describe(): string;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  /** Total size in bytes, or null when the object does not exist. */
  size(key: string): Promise<number | null>;
  /** Streams the object, or the inclusive byte range [start, end]. */
  stream(key: string, range?: { start: number; end: number }): Promise<ObjectStream | null>;
  delete(key: string): Promise<void>;
}

export class StorageError extends Error {}

function assertKey(key: string) {
  if (!key || key.startsWith("/") || key.split(/[\\/]/).includes(".."))
    throw new StorageError(`Invalid storage key: ${key}`);
}

// ---- Local disk ------------------------------------------------------------

export class LocalStore implements BlobStore {
  kind = "local" as const;

  constructor(private root = dataDir()) {}

  describe() {
    return this.root;
  }

  /** Absolute path of a key, guaranteed to stay inside the data folder. */
  pathOf(key: string) {
    assertKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new StorageError(`Invalid storage key: ${key}`);
    return full;
  }

  async put(key: string, data: Buffer) {
    const file = this.pathOf(key);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, data);
  }

  async get(key: string) {
    return fsp.readFile(this.pathOf(key)).catch(() => null);
  }

  async size(key: string) {
    return fsp
      .stat(this.pathOf(key))
      .then((s) => s.size)
      .catch(() => null);
  }

  async stream(key: string, range?: { start: number; end: number }) {
    const file = this.pathOf(key);
    const total = await this.size(key);
    if (total === null) return null;
    const body = Readable.toWeb(fs.createReadStream(file, range)) as ReadableStream;
    return { body, length: range ? range.end - range.start + 1 : total };
  }

  async delete(key: string) {
    await fsp.rm(this.pathOf(key), { force: true });
  }
}

// ---- Cloudflare R2 (S3 API) ------------------------------------------------

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Override for EU jurisdiction buckets or local S3-compatible test servers. */
  endpoint?: string;
}

export function r2ConfigFromEnv(): R2Config | null {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_ENDPOINT } = process.env;
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || !(R2_ACCOUNT_ID || R2_ENDPOINT)) return null;
  return {
    accountId: R2_ACCOUNT_ID ?? "",
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucket: R2_BUCKET,
    endpoint: R2_ENDPOINT || undefined,
  };
}

type S3Module = typeof import("@aws-sdk/client-s3");

function isNotFound(err: unknown) {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404;
}

export class R2Store implements BlobStore {
  kind = "r2" as const;
  private client?: Promise<{ s3: S3Module; client: InstanceType<S3Module["S3Client"]> }>;

  constructor(private config: R2Config) {}

  describe() {
    return `r2://${this.config.bucket}`;
  }

  private sdk() {
    this.client ??= import("@aws-sdk/client-s3").then((s3) => ({
      s3,
      client: new s3.S3Client({
        region: "auto",
        endpoint: this.config.endpoint ?? `https://${this.config.accountId}.r2.cloudflarestorage.com`,
        forcePathStyle: !!this.config.endpoint,
        credentials: { accessKeyId: this.config.accessKeyId, secretAccessKey: this.config.secretAccessKey },
        // R2 doesn't need the SDK's newer default checksums; only send them when an operation requires it.
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      }),
    }));
    return this.client;
  }

  async put(key: string, data: Buffer, contentType: string) {
    assertKey(key);
    const { s3, client } = await this.sdk();
    await client.send(
      new s3.PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: data, ContentType: contentType }),
    );
  }

  async get(key: string) {
    assertKey(key);
    const { s3, client } = await this.sdk();
    try {
      const res = await client.send(new s3.GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return Buffer.from(await res.Body!.transformToByteArray());
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async size(key: string) {
    assertKey(key);
    const { s3, client } = await this.sdk();
    try {
      const res = await client.send(new s3.HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return res.ContentLength ?? 0;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async stream(key: string, range?: { start: number; end: number }) {
    assertKey(key);
    const { s3, client } = await this.sdk();
    try {
      const res = await client.send(
        new s3.GetObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Range: range ? `bytes=${range.start}-${range.end}` : undefined,
        }),
      );
      return { body: res.Body!.transformToWebStream() as ReadableStream, length: res.ContentLength ?? 0 };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async delete(key: string) {
    assertKey(key);
    const { s3, client } = await this.sdk();
    await client.send(new s3.DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }
}

// ---- Selection -------------------------------------------------------------

const g = globalThis as unknown as { __pivotStores?: Partial<Record<StorageKind, BlobStore>> };
const stores = (g.__pivotStores ??= {});

export function storageMode(): StorageKind {
  return r2ConfigFromEnv() ? "r2" : "local";
}

/** The store for a given kind; R2 throws a clear error if its keys are missing from .env. */
export function storeFor(kind: StorageKind): BlobStore {
  if (kind === "local") return (stores.local ??= new LocalStore());
  if (!stores.r2) {
    const config = r2ConfigFromEnv();
    if (!config) throw new StorageError("This file is stored in Cloudflare R2, but the R2 keys are missing from .env.");
    stores.r2 = new R2Store(config);
  }
  return stores.r2;
}

/** Where new files are written. */
export function writeStore(): BlobStore {
  return storeFor(storageMode());
}

/** Round-trips a small object to prove the credentials and bucket work. */
export async function checkStore(store: BlobStore = writeStore()) {
  const key = `healthcheck/${Date.now()}.txt`;
  const body = Buffer.from("pivot");
  const started = Date.now();
  await store.put(key, body, "text/plain");
  const back = await store.get(key);
  await store.delete(key);
  if (!back || !back.equals(body)) throw new StorageError("Wrote a test file but could not read it back.");
  return { ms: Date.now() - started, target: store.describe() };
}
