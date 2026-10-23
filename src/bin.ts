import { writeFile } from "node:fs/promises";
import { main } from "./main.ts";

process.exit(await main(process.argv.slice(2), process.stdin, process.stdout, writeFile));
