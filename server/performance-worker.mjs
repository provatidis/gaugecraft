import { parentPort, workerData } from "node:worker_threads";
import { register } from "tsx/esm/api";

// The production entry point runs TypeScript directly, including .js imports
// resolved to their .ts sources. Register that resolver in this worker too.
register();
const { Store } = await import("./store.ts");
const { performance } = await import("./performance.ts");
const { database, mode, now } = workerData;
const store = new Store(database, { readOnly: true });
try {
  store.db.exec("BEGIN");
  const json = JSON.stringify(performance(store, mode, now));
  store.db.exec("COMMIT");
  parentPort.postMessage(json);
} finally {
  store.close();
}
