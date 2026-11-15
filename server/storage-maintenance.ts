import { DatabaseSync, backup } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  mkdir,
  link,
  rm,
  stat,
  writeFile,
  readFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip, gzipSync } from "node:zlib";
import { Store } from "./store.js";
import { digest, isGzip, RecordCodec, recordTables } from "./storage-codec.js";
import { repackRecords } from "./storage-repack.js";
import { migrateSchema, version, STORAGE_VERSION } from "./storage-schema.js";

export function verifyDatabase(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
      throw new Error("SQLite integrity check failed");
    if (db.prepare("PRAGMA foreign_key_check").get())
      throw new Error("SQLite reference check failed");
    for (const table of ["snapshots", "forecasts", "decisions", "runs"])
      db.prepare(`SELECT count(*) FROM ${table}`).get();
  } finally {
    db.close();
  }
}
export async function fileDigest(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
async function requireNew(path: string) {
  try {
    await access(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(
    `Destination already exists: ${path}. Refusing to overwrite a database or backup.`,
  );
}
// Only called after closing every handle to a private, uniquely named work file.
async function removePrivateDatabase(path: string) {
  for (const suffix of ["", "-wal", "-shm"])
    await rm(path + suffix, { force: true });
}

export async function consistentCopy(source: string, destination: string) {
  if (resolve(source) === resolve(destination))
    throw new Error("Source and destination must differ");
  await requireNew(destination);
  await mkdir(dirname(destination), { recursive: true });
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(db, destination);
  } finally {
    db.close();
  }
  verifyDatabase(destination);
}

// Hash every logical record, with stable order, rather than comparing physical SQLite pages.
export function fingerprint(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  const v = version(db);
  const store = [3, STORAGE_VERSION].includes(v)
    ? new Store(path, { readOnly: true })
    : null;
  try {
    const result: Record<string, { count: number; sha256: string }> = {};
    for (const mode of ["live", "demo"] as const) {
      for (const kind of ["snapshots", "forecasts"] as const) {
        const rows = store
          ? kind === "snapshots"
            ? store.observations(mode)
            : store.frozenForecasts(mode)
          : (function* () {
              for (const r of db
                .prepare(
                  `SELECT body FROM ${kind} WHERE mode=? ORDER BY ${kind === "snapshots" ? "at,pool_id" : "id"}`,
                )
                .iterate(mode))
                yield JSON.parse(String(r.body));
            })();
        const hash = createHash("sha256");
        let count = 0;
        for (const row of rows) {
          hash.update(digest(row) + "\n");
          count++;
        }
        result[`${mode}.${kind}`] = { count, sha256: hash.digest("hex") };
      }
    }
    for (const table of ["runs", "decisions"]) {
      const hash = createHash("sha256");
      let count = 0;
      for (const r of db
        .prepare(
          `SELECT * FROM ${table} ORDER BY ${table === "runs" ? "id" : "mode,bucket"}`,
        )
        .iterate()) {
        hash.update(digest(r) + "\n");
        count++;
      }
      result[table] = { count, sha256: hash.digest("hex") };
    }
    return result;
  } finally {
    store?.close();
    db.close();
  }
}

// Convert only the private destination copy. A rollback can include observations
// and forecasts written since deployment, even if the previous build only reads v3.
function restoreV3Format(db: DatabaseSync) {
  if (version(db) === 3) return;
  if (version(db) !== STORAGE_VERSION)
    throw new Error("Expected a v3 or v4 source");
  const codec = new RecordCodec(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const table of recordTables) {
      const select = db.prepare(
        `SELECT rowid,body FROM ${table} WHERE rowid>? ORDER BY rowid LIMIT 128`,
      );
      const write = db.prepare(`UPDATE ${table} SET body=? WHERE rowid=?`);
      let last = 0;
      for (;;) {
        const rows = select.all(last);
        if (!rows.length) break;
        for (const row of rows) {
          const packed = row.body as Uint8Array;
          if (!isGzip(packed))
            write.run(gzipSync(codec.expand(table, packed)), row.rowid);
        }
        last = Number(rows.at(-1)!.rowid);
      }
    }
    db.exec(
      "DROP TABLE storage_repack; DROP TABLE storage_dictionaries; PRAGMA user_version=3; COMMIT;",
    );
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export async function migrateDatabase(
  source: string,
  destination: string,
  targetVersion: 3 | 4 = STORAGE_VERSION,
) {
  await requireNew(destination);
  const temp = `${destination}.${randomUUID()}.migrating`;
  try {
    await consistentCopy(source, temp);
    const before = fingerprint(temp);
    const beforeBytes = (await stat(temp)).size;
    const db = new DatabaseSync(temp);
    try {
      db.exec("PRAGMA foreign_keys=ON");
      if (targetVersion === 3) restoreV3Format(db);
      else {
        migrateSchema(db);
        await repackRecords(db, Number.MAX_SAFE_INTEGER, false);
      }
      db.exec("VACUUM");
    } finally {
      db.close();
    }
    verifyDatabase(temp);
    const after = fingerprint(temp);
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error(
        "Migration changed historical records; destination was not installed",
      );
    await link(temp, destination);
    const afterBytes = (await stat(destination)).size;
    return {
      beforeBytes,
      afterBytes,
      reductionPercent: 100 * (1 - afterBytes / beforeBytes),
      records: after,
    };
  } finally {
    await removePrivateDatabase(temp);
  }
}

export interface BackupManifest {
  version: 1;
  createdAt: string;
  sha256: string;
  compressedBytes: number;
  databaseBytes: number;
}
export async function createBackup(
  source: string,
  destination: string,
): Promise<BackupManifest> {
  await requireNew(destination);
  await requireNew(`${destination}.json`);
  const temp = `${destination}.${randomUUID()}`;
  try {
    await consistentCopy(source, `${temp}.sqlite`);
    await pipeline(
      createReadStream(`${temp}.sqlite`),
      createGzip({ level: 6 }),
      createWriteStream(temp, { flags: "wx", mode: 0o600 }),
    );
    const manifest: BackupManifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      sha256: await fileDigest(temp),
      compressedBytes: (await stat(temp)).size,
      databaseBytes: (await stat(`${temp}.sqlite`)).size,
    };
    await writeFile(`${temp}.json`, JSON.stringify(manifest, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    await link(temp, destination);
    try {
      await link(`${temp}.json`, `${destination}.json`);
    } catch (error) {
      await rm(destination);
      throw error;
    }
    return manifest;
  } finally {
    await rm(temp, { force: true });
    await rm(`${temp}.json`, { force: true });
    await removePrivateDatabase(`${temp}.sqlite`);
  }
}
export async function restoreBackup(source: string, destination: string) {
  await requireNew(destination);
  const manifest = JSON.parse(
    await readFile(`${source}.json`, "utf8"),
  ) as BackupManifest;
  if (
    manifest.version !== 1 ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
    !Number.isSafeInteger(manifest.databaseBytes) ||
    manifest.databaseBytes <= 0
  )
    throw new Error("Invalid backup manifest");
  if (
    (await stat(source)).size !== manifest.compressedBytes ||
    (await fileDigest(source)) !== manifest.sha256
  )
    throw new Error("Backup checksum or size mismatch");
  await mkdir(dirname(destination), { recursive: true });
  const temp = `${destination}.${randomUUID()}.restore`;
  try {
    await pipeline(
      createReadStream(source),
      createGunzip(),
      createWriteStream(temp, { flags: "wx", mode: 0o600 }),
    );
    if ((await stat(temp)).size !== manifest.databaseBytes)
      throw new Error("Restored size mismatch");
    verifyDatabase(temp);
    await link(temp, destination);
  } finally {
    await removePrivateDatabase(temp);
  }
}

export async function storageReport(path: string, pools = 474) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const snapshots = db
      .prepare(
        "SELECT mode,count(*) count,avg(length(body)) averageBodyBytes,min(at) earliest,max(at) latest FROM snapshots GROUP BY mode",
      )
      .all();
    const forecasts = db
      .prepare(
        "SELECT mode,count(*) count,avg(length(body)) averageBodyBytes FROM forecasts GROUP BY mode",
      )
      .all();
    const bytes =
      Number(db.prepare("PRAGMA page_count").get()!.page_count) *
      Number(db.prepare("PRAGMA page_size").get()!.page_size);
    const count = snapshots.reduce((n, r) => n + Number(r.count), 0);
    const bytesPerObservation = count ? bytes / count : null;
    const daily =
      bytesPerObservation === null ? null : bytesPerObservation * pools * 48;
    return {
      version: version(db),
      databaseBytes: bytes,
      reusablePageBytes:
        Number(db.prepare("PRAGMA freelist_count").get()!.freelist_count) *
        Number(db.prepare("PRAGMA page_size").get()!.page_size),
      snapshots,
      forecasts,
      bytesPerObservationIncludingIndexesAndForecasts: bytesPerObservation,
      projection: {
        assumptions: `${pools} pools, 48 observations/pool/day; current mixed live/fixture physical bytes per observation, including forecasts and indexes; linear planning estimate, not measured future growth. Excludes WAL, backups and temporary files.`,
        dailyBytes: daily,
        days30Bytes: daily === null ? null : daily * 30,
        days90Bytes: daily === null ? null : daily * 90,
        days365Bytes: daily === null ? null : daily * 365,
      },
    };
  } finally {
    db.close();
  }
}
