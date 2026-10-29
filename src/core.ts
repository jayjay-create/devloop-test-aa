export function parseLinks(input: string): string[] {
  return input
    .split("\n")
    .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
    .filter((line) => line !== "");
}

export function distinct(links: string[]): string[] {
  return [...new Set(links)];
}

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderPage(links: string[]): string {
  const items = links.map((l) => `<li><a href="${escapeHtml(l)}">${escapeHtml(l)}</a></li>`).join("\n");
  const list = links.length === 0 ? "<ul></ul>" : `<ul>\n${items}\n</ul>`;
  return `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>Links</title>\n</head>\n<body>\n${list}\n</body>\n</html>\n`;
}

export function consoleText(links: string[]): string {
  return links.join("\n");
}

// A glob over the whole text, case-sensitive. Only `*` is special (any text, none included, newlines too);
// every other character, `?` and `[` among them, stands for itself.
export function matchesGlob(pattern: string, href: string): boolean {
  const source = pattern
    .split("*")
    .map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s\\S]*");
  return new RegExp(`^${source}$`, "u").test(href);
}

export function applyExclude(links: string[], patterns: string[]): string[] {
  return links.filter((link) => !patterns.some((p) => matchesGlob(p, link)));
}
