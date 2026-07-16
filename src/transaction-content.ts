export function appendTransactionIfMissing(content: string, financeId: string, line: string): string {
  return content.includes(transactionMarker(financeId)) ? content : appendLine(content, line);
}

export function upsertTransactionContent(content: string, financeId: string, line: string): string {
  const marker = transactionMarker(financeId);
  let replaced = false;
  const next = content.split("\n").filter((current) => {
    if (!current.includes(marker)) return true;
    if (replaced) return false;
    replaced = true;
    return true;
  }).map((current) => current.includes(marker) ? line : current).join("\n");
  return replaced ? next : appendLine(content, line);
}

export function removeTransactionContent(content: string, financeId: string): string {
  const marker = transactionMarker(financeId);
  return content.split("\n").filter((line) => !line.includes(marker)).join("\n");
}

function transactionMarker(financeId: string): string {
  return `[financeId:: ${financeId}]`;
}

function appendLine(content: string, line: string): string {
  const trimmed = content.replace(/\s+$/, "");
  return `${trimmed}\n${line}\n`;
}
