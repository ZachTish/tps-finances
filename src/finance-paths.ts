import { normalizePath } from "obsidian";

/** Empty (or /) is an explicit vault-root destination, not a missing setting. */
export function normalizeFinanceFolder(value: unknown, fallback = "Finances"): string {
  if (typeof value !== "string") return fallback;
  const path = value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!path || path === ".") return "";
  if (path.split("/").some(part => part === "." || part === "..")) throw new Error("Choose a folder inside the vault.");
  return normalizePath(path);
}

export function financeDirectory(root: string, section = ""): string {
  return root ? normalizePath([root, section].filter(Boolean).join("/")) : "";
}

export function financePath(root: string, section: string, filename: string): string {
  return normalizePath([financeDirectory(root, section), filename].filter(Boolean).join("/"));
}

// Root mode discovers identified finance records throughout the vault, including older folders.
export function financePrefix(root: string, section = ""): string {
  const folder = financeDirectory(root, section);
  return folder ? `${folder}/` : "";
}
