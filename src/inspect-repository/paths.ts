import { lstatSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function rejectLinkedPath(path: string): void {
  let current = resolve(path);
  for (;;) {
    if (lstatSync(current).isSymbolicLink())
      throw new Error("Linked input paths are not permitted");
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
