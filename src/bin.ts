import { writeFile } from "node:fs/promises";
import { main } from "./main.ts";

// A reader that closes early (`| head -1`) is not an error of ours; without this listener the
// EPIPE would surface as an uncaught exception and replace the exit code main returns.
process.stdout.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code !== "EPIPE") throw e;
});

// exitCode and not process.exit, so that pending stdout writes are flushed first.
process.exitCode = await main(process.argv.slice(2), process.stdin, process.stdout, writeFile);
