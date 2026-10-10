import { parentPort, workerData } from "node:worker_threads";
import { decodeSpreadsheet, uploadSchema } from "./spreadsheet.js";
void decodeSpreadsheet(uploadSchema.parse(workerData))
  .then((result) => parentPort?.postMessage({ result }))
  .catch((error: unknown) =>
    parentPort?.postMessage({
      error: error instanceof Error ? error.message : "名單格式不正確",
    }),
  );
