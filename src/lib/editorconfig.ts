/** Sections of an `.editorconfig` in file order: which paths each applies to and its properties, with lowercase names. */
export type EditorConfig = { matches: (path: string) => boolean; props: Record<string, string> }[];

/** Parses an `.editorconfig` at the repository root. Lines it can't read are skipped, as editors do. */
export function parseEditorConfig(text: string): EditorConfig {
  const sections: EditorConfig = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === "#" || line[0] === ";") continue;
    if (line[0] === "[" && line.endsWith("]")) {
      sections.push({ matches: globMatcher(line.slice(1, -1)), props: {} });
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0 || !sections.length) continue;
    sections[sections.length - 1].props[line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim().toLowerCase();
  }
  return sections;
}

/** The tab width `config` sets for the repo-relative `path`, if any. */
export function tabWidth(config: EditorConfig, path: string): number | undefined {
  const props: Record<string, string> = {};
  for (const s of config) {
    if (!s.matches(path)) continue;
    for (const [k, v] of Object.entries(s.props)) {
      if (v === "unset") delete props[k];
      else props[k] = v;
    }
  }
  const width = Number(props.tab_width ?? props.indent_size);
  return Number.isInteger(width) && width > 0 ? width : undefined;
}

/** Tests repo-relative paths against an EditorConfig glob. */
function globMatcher(glob: string): (path: string) => boolean {
  const ranges: [number, number][] = [];
  const anchored = /\//.test(glob.replace(/\[[^\]]*\]/g, ""));
  const re = new RegExp(`^${anchored ? "" : "(?:.*/)?"}${translate(glob.replace(/^\//, ""), ranges)}$`);
  return (path) => {
    const m = re.exec(path);
    return !!m && ranges.every(([lo, hi], i) => m[i + 1] === undefined || (Number(m[i + 1]) >= lo && Number(m[i + 1]) <= hi));
  };
}

/** Regex source for `glob`. Each `{lo..hi}` becomes a capture group, with its bounds pushed to `ranges`. */
function translate(glob: string, ranges: [number, number][]): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "\\" && i + 1 < glob.length) {
      out += escape(glob[++i]);
    } else if (c === "*") {
      if (glob.startsWith("**/", i)) {
        out += "(?:.*/)?";
        i += 2;
      } else if (glob[i + 1] === "*") {
        out += ".*";
        i++;
      } else out += "[^/]*";
    } else if (c === "?") {
      out += "[^/]";
    } else if (c === "[" && glob.indexOf("]", i + 2) > 0) {
      const end = glob.indexOf("]", i + 2);
      const set = glob.slice(i + 1, end);
      const negated = set[0] === "!";
      out += `[${negated ? "^" : ""}${(negated ? set.slice(1) : set).replace(/[\\^[\]]/g, "\\$&")}]`;
      i = end;
    } else if (c === "{" && closingBrace(glob, i) > 0) {
      const end = closingBrace(glob, i);
      const inner = glob.slice(i + 1, end);
      const range = /^([+-]?\d+)\.\.([+-]?\d+)$/.exec(inner);
      const alts = splitTop(inner);
      if (range) {
        ranges.push([Math.min(+range[1], +range[2]), Math.max(+range[1], +range[2])]);
        out += "([+-]?\\d+)";
      } else if (alts.length > 1) {
        out += `(?:${alts.map((a) => translate(a, ranges)).join("|")})`;
      } else {
        out += `\\{${translate(inner, ranges)}\\}`;
      }
      i = end;
    } else {
      out += escape(c);
    }
  }
  return out;
}

const escape = (c: string) => c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Index of the `}` closing the `{` at `start`, or -1. */
function closingBrace(glob: string, start: number): number {
  let depth = 0;
  for (let i = start; i < glob.length; i++) {
    if (glob[i] === "\\") i++;
    else if (glob[i] === "{") depth++;
    else if (glob[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

/** Splits brace contents at commas outside nested braces. */
function splitTop(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "\\") i++;
    else if (inner[i] === "{") depth++;
    else if (inner[i] === "}") depth--;
    else if (inner[i] === "," && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts;
}
