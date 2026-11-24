import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function applicationIdentity(
  root = fileURLToPath(new URL("../../", import.meta.url)),
) {
  const files: { path: string; sha256: string }[] = [];
  let total = 0;
  const visit = (path: string) => {
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error("Linked application source");
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) visit(path + "/" + name);
      return;
    }
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024 || files.length >= 256)
      throw new Error("Application source limit exceeded");
    total += stat.size;
    if (total > 16 * 1024 * 1024)
      throw new Error("Application source limit exceeded");
    files.push({
      path,
      sha256: createHash("sha256").update(readFileSync(absolute)).digest("hex"),
    });
  };
  visit("src");
  visit("package.json");
  return {
    algorithm: "sha256",
    files,
    sha256: createHash("sha256").update(JSON.stringify(files)).digest("hex"),
  };
}
