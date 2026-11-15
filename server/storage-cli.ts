import {
  migrateDatabase,
  createBackup,
  restoreBackup,
  storageReport,
  fingerprint,
} from "./storage-maintenance.js";
import { access } from "node:fs/promises";
import { Store } from "./store.js";
import { repackRecords } from "./storage-repack.js";
const [command, source, destination] = process.argv.slice(2);
if (!source)
  throw new Error(
    "Usage: storage-cli.ts report|verify SOURCE, repack SOURCE [row-limit], or migrate|v3-copy|backup|restore SOURCE NEW_DESTINATION",
  );
if (command === "repack") {
  await access(source);
  const store = new Store(source);
  try {
    console.log(
      JSON.stringify(
        await repackRecords(store.db, Number(destination ?? 10000)),
        null,
        2,
      ),
    );
  } finally {
    store.close();
  }
} else if (command === "report")
  console.log(JSON.stringify(await storageReport(source), null, 2));
else if (command === "verify")
  console.log(JSON.stringify(fingerprint(source), null, 2));
else if (!destination) throw new Error("A new destination path is required");
else if (command === "migrate" || command === "v3-copy")
  console.log(
    JSON.stringify(
      await migrateDatabase(source, destination, command === "v3-copy" ? 3 : 4),
      null,
      2,
    ),
  );
else if (command === "backup")
  console.log(JSON.stringify(await createBackup(source, destination), null, 2));
else if (command === "restore") {
  await restoreBackup(source, destination);
  console.log(
    "Restored and verified. Start the application only after choosing this database explicitly.",
  );
} else throw new Error("Unknown storage command");
