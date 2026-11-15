import type { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { isGzip, RecordCodec, recordTables } from "./storage-codec.js";

const batchSize = 128;

// Only the three fixed table names below enter SQL. A cursor commits with its
// rewrites, so interruption or competing repackers can safely resume at any point.
export async function repackRecords(
  db: DatabaseSync,
  maxRows: number,
  online = true,
  shouldStop: () => boolean = () => false,
) {
  if (!Number.isSafeInteger(maxRows) || maxRows < 1)
    throw new Error("The repack row limit must be a positive integer");
  const codec = new RecordCodec(db);
  const pageSize = Number(db.prepare("PRAGMA page_size").get()!.page_size);
  const report = {
    scanned: 0,
    rewritten: 0,
    savedPayloadBytes: 0,
    complete: false,
    pausedForReader: false,
  };
  const cursor = db.prepare(
    "SELECT last_rowid,through_rowid FROM storage_repack WHERE kind=? AND last_rowid<through_rowid",
  );
  const save = db.prepare(
    "UPDATE storage_repack SET last_rowid=? WHERE kind=?",
  );
  for (const table of recordTables) {
    if (!cursor.get(table)) continue;
    const select = db.prepare(
      `SELECT rowid,body FROM ${table} WHERE rowid>? AND rowid<=? ORDER BY rowid LIMIT ?`,
    );
    const first = db.prepare(`SELECT min(rowid) AS id FROM ${table}`);
    const move = db.prepare(`UPDATE ${table} SET rowid=?,body=? WHERE rowid=?`);
    const putBack = db.prepare(`UPDATE ${table} SET rowid=? WHERE rowid=?`);
    while (report.scanned < maxRows) {
      if (shouldStop()) return report;
      const limit = Math.min(batchSize, maxRows - report.scanned);
      db.exec("BEGIN IMMEDIATE");
      let count: number;
      try {
        const pending = cursor.get(table);
        if (!pending) {
          db.exec("COMMIT");
          break;
        }
        const rows = select.all(
          pending.last_rowid,
          pending.through_rowid,
          limit,
        );
        // UPDATE body alone leaves slack scattered across old B-tree leaves.
        // Move the batch below the lowest rowid to evacuate whole pages, then
        // reinsert in order. Every public key and original rowid survives.
        const firstTemporary = Math.min(0, Number(first.get()!.id)) - limit;
        if (!Number.isSafeInteger(firstTemporary))
          throw new Error("No temporary rowid range available");
        const moved: { original: number; temporary: number }[] = [];
        count = rows.length;
        for (const row of rows) {
          if (!(row.body instanceof Uint8Array))
            throw new Error("Invalid stored record");
          if (!isGzip(row.body)) continue;
          const original = codec.expand(table, row.body);
          if (original.length < 128) continue;
          const packed = codec.compress(table, original);
          if (packed.length >= row.body.length) continue;
          if (!codec.expand(table, packed).equals(original))
            throw new Error("Repacked bytes differ from the original record");
          const temporary = firstTemporary + moved.length;
          const originalId = Number(row.rowid);
          move.run(temporary, packed, originalId);
          moved.push({ original: originalId, temporary });
          report.rewritten++;
          report.savedPayloadBytes += row.body.length - packed.length;
        }
        for (const row of moved) putBack.run(row.original, row.temporary);
        save.run(
          count < limit ? pending.through_rowid : rows[count - 1].rowid,
          table,
        );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      report.scanned += count;
      if (online && count) {
        // A long-lived export can pin WAL pages. Yield between writes and stop
        // if it prevents checkpointing instead of consuming the volume.
        const checkpoint = db.prepare("PRAGMA wal_checkpoint(PASSIVE)").get()!;
        if (
          (Number(checkpoint.log) - Number(checkpoint.checkpointed)) *
            pageSize >
          8 * 1024 ** 2
        ) {
          report.pausedForReader = true;
          return report;
        }
        await delay(20);
      }
      if (count < limit) break;
    }
    if (report.scanned >= maxRows) return report;
  }
  report.complete = true;
  return report;
}
