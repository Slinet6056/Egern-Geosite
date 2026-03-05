import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const LEGACY_LIST_FILE_NAME = /^[a-z0-9!-]+$/;
const TXT_LIST_FILE_NAME = /^[a-z0-9!-]+\.txt$/;

export async function loadListsFromDirectory(
  dataDir: string,
): Promise<Record<string, string>> {
  const entries = await readdir(dataDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      if (LEGACY_LIST_FILE_NAME.test(entry.name)) {
        return {
          fileName: entry.name,
          listName: entry.name,
        };
      }

      if (TXT_LIST_FILE_NAME.test(entry.name)) {
        return {
          fileName: entry.name,
          listName: entry.name.slice(0, -4),
        };
      }

      return null;
    })
    .filter(
      (entry): entry is { fileName: string; listName: string } =>
        entry !== null,
    )
    .sort(
      (a, b) =>
        a.listName.localeCompare(b.listName) ||
        a.fileName.localeCompare(b.fileName),
    );

  const output: Record<string, string> = {};
  const sourceByList: Record<string, string> = {};

  for (const file of files) {
    const existingSource = sourceByList[file.listName];
    if (existingSource) {
      throw new Error(
        `duplicate list name ${JSON.stringify(file.listName)} from ${JSON.stringify(existingSource)} and ${JSON.stringify(file.fileName)}`,
      );
    }

    const fullPath = path.join(dataDir, file.fileName);
    output[file.listName] = await readFile(fullPath, "utf8");
    sourceByList[file.listName] = file.fileName;
  }

  return output;
}
