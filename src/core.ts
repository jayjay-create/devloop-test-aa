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
// every other character, `?` and `[` among them, stands for itself. Matched by a loop over the parts, never
// by a regular expression built from the pattern, so a crafted pattern cannot make it take exponential
// time: at worst the work is the length of the pattern times the length of the text.
export function matchesGlob(pattern: string, href: string): boolean {
  let p = 0;
  let h = 0;
  let star = -1; // position of the last `*` seen in the pattern
  let mark = 0; // where in href the text taken by that `*` ends for now
  while (h < href.length) {
    if (p < pattern.length && pattern[p] === "*") {
      star = p++;
      mark = h;
    } else if (p < pattern.length && pattern[p] === href[h]) {
      p++;
      h++;
    } else if (star !== -1) {
      p = star + 1;
      h = ++mark;
    } else return false;
  }
  while (p < pattern.length && pattern[p] === "*") p++;
  return p === pattern.length;
}

export function applyExclude(links: string[], patterns: string[]): string[] {
  return links.filter((link) => !patterns.some((p) => matchesGlob(p, link)));
}
