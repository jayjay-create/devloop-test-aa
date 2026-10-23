import { writeFile } from "node:fs/promises";
import { main } from "./main.ts";

// exitCode and not process.exit, so that pending stdout writes are flushed first.
process.exitCode = await main(process.argv.slice(2), process.stdin, process.stdout, writeFile);
