export function countRuleLines(text: string): number {
  const lines = text.split(/\r?\n/);
  const yamlItems = lines.filter((line) =>
    line.trimStart().startsWith("- "),
  ).length;
  if (yamlItems > 0) {
    return yamlItems;
  }

  return lines.filter((line) => line.length > 0).length;
}

export function normalizeEtag(value: string | null): string {
  if (!value) {
    return "-";
  }

  const compact = value.replace(/^W\//, "").replaceAll('"', "");
  return compact.slice(0, 7) || "-";
}
