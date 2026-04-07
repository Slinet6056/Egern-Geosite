import type { SurgeRegexMode } from "./types.js";

/**
 * 将 V2Ray 域名正则表达式转换为 Surge URL-REGEX 格式。
 * 返回转换后的 URL 正则，如果无法转换则返回 null。
 */
export function convertDomainRegexToUrlRegex(
  pattern: string,
  mode: SurgeRegexMode,
): string | null {
  if (mode === "skip") {
    return null;
  }

  if (mode === "aggressive") {
    return convertAggressive(pattern);
  }

  return convertStandard(pattern);
}

function convertAggressive(pattern: string): string {
  let inner = pattern;

  // 去除首尾锚点
  const hasStart = inner.startsWith("^");
  const hasEnd = inner.endsWith("$");
  if (hasStart) inner = inner.slice(1);
  if (hasEnd) inner = inner.slice(0, -1);

  // 处理 (^|\.) 前缀 -> 可选子域
  if (inner.startsWith("(^|\\.)")) {
    inner = inner.slice("(^|\\.)".length);
    return `^https?://([^/]+\\.)?${inner}/`;
  }

  if (hasStart && hasEnd) {
    // 精确域名
    return `^https?://${inner}/`;
  }

  if (hasEnd && !hasStart) {
    // 后缀匹配
    return `^https?://[^/]*${inner}/`;
  }

  // 通用包装
  return `^https?://[^/]*${inner}[^/]*/`;
}

function convertStandard(pattern: string): string | null {
  // 检查是否包含不安全的正则特性
  if (hasUnsafeFeatures(pattern)) {
    return null;
  }

  let inner = pattern;
  const hasStart = inner.startsWith("^");
  const hasEnd = inner.endsWith("$");
  if (hasStart) inner = inner.slice(1);
  if (hasEnd) inner = inner.slice(0, -1);

  // 模式1: (^|\.)domain$ → 后缀匹配（可选子域）
  if (inner.startsWith("(^|\\.)")) {
    const domain = inner.slice("(^|\\.)".length);
    if (!isDomainSafe(domain)) return null;
    return `^https?://([^/]+\\.)?${domain}/`;
  }

  // 模式2: ^domain$ → 精确域名匹配
  if (hasStart && hasEnd) {
    if (!isDomainSafe(inner)) return null;
    return `^https?://${inner}/`;
  }

  // 模式3: \.domain$ → 后缀匹配（必须有子域）
  if (!hasStart && hasEnd && inner.startsWith("\\.")) {
    if (!isDomainSafe(inner.slice(2))) return null;
    return `^https?://[^/]*${inner}/`;
  }

  // 模式4: ^domain (无结尾锚点) → 前缀匹配
  if (hasStart && !hasEnd) {
    if (!isDomainSafe(inner)) return null;
    return `^https?://${inner}[^/]*/`;
  }

  // 无法安全转换
  return null;
}

/**
 * 检查域名正则部分是否只包含安全的字符和模式。
 * 安全的元素包括：字面字符、转义点 \.、\d、[0-9]、简单交替 (a|b)、量词 +*?
 */
function isDomainSafe(domainPattern: string): boolean {
  // 不允许的特性
  if (
    domainPattern.includes("/") ||
    domainPattern.includes("(?") ||
    domainPattern.includes("\\b")
  ) {
    return false;
  }

  // 逐字符检查（简化版）
  // 允许: 字面字符, \., \d, \w, \-, [字符类], (交替), +, *, ?, {n,m}
  let i = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  while (i < domainPattern.length) {
    const ch = domainPattern[i]!;

    if (ch === "\\") {
      // 转义字符
      const next = domainPattern[i + 1];
      if (next === undefined) return false;
      // 允许的转义: \. \d \w \- \s 以及字面转义
      i += 2;
      continue;
    }

    if (ch === "[") {
      bracketDepth++;
      i++;
      continue;
    }

    if (ch === "]") {
      bracketDepth--;
      if (bracketDepth < 0) return false;
      i++;
      continue;
    }

    if (bracketDepth > 0) {
      // 字符类内部，允许大多数字符
      i++;
      continue;
    }

    if (ch === "(") {
      parenDepth++;
      i++;
      continue;
    }

    if (ch === ")") {
      parenDepth--;
      if (parenDepth < 0) return false;
      i++;
      continue;
    }

    if (ch === "|" && parenDepth > 0) {
      // 括号内交替，允许
      i++;
      continue;
    }

    if (ch === "|" && parenDepth === 0) {
      // 顶层交替，不安全
      return false;
    }

    if ("+*?".includes(ch)) {
      i++;
      continue;
    }

    if (ch === "{") {
      // 量词 {n,m}
      const close = domainPattern.indexOf("}", i);
      if (close === -1) return false;
      i = close + 1;
      continue;
    }

    if (ch === "." && bracketDepth === 0) {
      // 未转义的 . 在域名正则中不够安全，但很常见
      // standard 模式下仍然允许（匹配单字符）
      i++;
      continue;
    }

    if (ch === "^" || ch === "$") {
      // 内嵌锚点，不安全
      return false;
    }

    // 普通字符
    i++;
  }

  return parenDepth === 0 && bracketDepth === 0;
}

/**
 * 检查正则表达式中是否含有无法安全转换的特性
 */
function hasUnsafeFeatures(pattern: string): boolean {
  // 前瞻/后瞻
  if (/\(\?[=!<]/.test(pattern)) return true;
  // 反向引用
  if (/\\[1-9]/.test(pattern)) return true;
  // 路径字符（域名正则不应包含）
  if (pattern.includes("/")) return true;

  return false;
}
