import { createHash } from "node:crypto";
import { gzipSync, gunzipSync, deflateSync, inflateSync } from "node:zlib";
import type { DatabaseSync } from "node:sqlite";

// Compression is bounded to one record, never a complete database or export.
export function json(value: unknown) {
  return JSON.stringify(value, (_key, v) => {
    if (typeof v === "number" && !Number.isFinite(v))
      throw new Error("Non-finite metric");
    return v;
  });
}
export const recordTables = ["forecasts", "snapshots", "raw_evidence"] as const;
export type RecordTable = (typeof recordTables)[number];
export const isGzip = (body: Uint8Array) =>
  body[0] === 0x1f && body[1] === 0x8b;

// Each database stores its own immutable DEFLATE dictionary per record type.
// Standard zlib streams carry both a dictionary identifier and a data checksum.
// An individual record never depends on another observation remaining available.
export class RecordCodec {
  private dictionaries = new Map<RecordTable, Buffer>();
  constructor(private db: DatabaseSync) {}

  // A failed writer transaction may have rolled back its first dictionary.
  clear() {
    this.dictionaries.clear();
  }
  private dictionary(table: RecordTable, seed?: Buffer): Buffer {
    const cached = this.dictionaries.get(table);
    if (cached) return cached;
    const select = this.db.prepare(
      "SELECT body FROM storage_dictionaries WHERE kind=?",
    );
    let row = select.get(table);
    if (!row && seed) {
      this.db
        .prepare(
          "INSERT OR IGNORE INTO storage_dictionaries(kind,body) VALUES(?,?)",
        )
        .run(table, seed.subarray(-32768));
      row = select.get(table);
    }
    if (!(row?.body instanceof Uint8Array))
      throw new Error("Missing storage dictionary");
    const result = Buffer.from(row.body);
    this.dictionaries.set(table, result);
    return result;
  }
  compress(table: RecordTable, bytes: Buffer) {
    // A tiny fixture is a poor seed and needs no dictionary.
    if (bytes.length < 128) return gzipSync(bytes);
    return deflateSync(bytes, {
      level: 4,
      dictionary: this.dictionary(table, bytes),
    });
  }
  expand(table: RecordTable, bytes: Uint8Array) {
    return isGzip(bytes)
      ? gunzipSync(bytes)
      : inflateSync(bytes, { dictionary: this.dictionary(table) });
  }
  encode(table: RecordTable, value: unknown) {
    return this.compress(table, Buffer.from(json(value)));
  }
  decode<T>(table: RecordTable, value: unknown): T {
    if (typeof value === "string") return JSON.parse(value) as T;
    if (!(value instanceof Uint8Array))
      throw new Error("Invalid stored record");
    return JSON.parse(this.expand(table, value).toString("utf8")) as T;
  }
}

// Object property order is irrelevant; every value (including raw evidence) is retained.
export function digest(value: unknown): string {
  const canonical = (v: any): any =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canonical(v[k])]),
          )
        : v;
  return createHash("sha256")
    .update(json(canonical(value)))
    .digest("hex");
}
