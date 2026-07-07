var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => WikiImporterPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  destination: "active",
  // default per your workflow: fill the note you're in
  targetFolder: "Wikipedia",
  newFolderParent: "",
  namingMode: "automatic",
  wikiLang: "en",
  includeHeading: true,
  overwrite: false,
  referencesStyle: "callout"
};
var WikiImporterPlugin = class extends import_obsidian.Plugin {
  async onload() {
    await this.loadSettings();
    this.addCommand({
      id: "import-wikipedia-page",
      name: "Import Wikipedia page by title",
      callback: () => {
        new TitlePromptModal(this.app, async (title) => {
          await this.importByTitle(title);
        }).open();
      }
    });
    this.addCommand({
      id: "import-wikipedia-from-note-title",
      name: "Import Wikipedia page matching current note title",
      editorCallback: async (_editor, view) => {
        var _a;
        const name = (_a = view.file) == null ? void 0 : _a.basename;
        if (!name) {
          new import_obsidian.Notice("No active note.");
          return;
        }
        await this.importByTitle(name);
      }
    });
    this.addSettingTab(new WikiImporterSettingTab(this.app, this));
  }
  onunload() {
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  /* -- core flow -------------------------------------------------------- */
  async importByTitle(rawTitle) {
    const title = rawTitle.trim();
    if (!title) {
      new import_obsidian.Notice("No title given.");
      return;
    }
    new import_obsidian.Notice(`Fetching "${title}"\u2026`);
    let html;
    let resolvedTitle;
    try {
      const res = await fetchWikipediaHtml(title, this.settings.wikiLang);
      html = res.html;
      resolvedTitle = res.title;
    } catch (e) {
      console.error(e);
      new import_obsidian.Notice(`Couldn't fetch "${title}". Check the name/spelling.`);
      return;
    }
    const leadImage = extractLeadImage(html);
    const body = htmlToObsidianMarkdown(html, leadImage);
    const refs = extractReferences(html);
    const refsSection = formatReferences(
      refs,
      this.settings.referencesStyle
    );
    const sourceUrl = `https://${this.settings.wikiLang}.wikipedia.org/wiki/` + encodeURIComponent(resolvedTitle.replace(/ /g, "_"));
    const bodyWithRefs = refsSection ? `${body}

${refsSection}` : body;
    let md;
    if (this.settings.includeHeading) {
      const parts = [];
      parts.push(`# [${resolvedTitle}](${sourceUrl})`);
      if (leadImage)
        parts.push(`![${resolvedTitle}](${leadImage})`);
      parts.push(`*Imported from [Wikipedia](${sourceUrl})*`);
      parts.push(bodyWithRefs);
      md = parts.join("\n\n");
    } else {
      md = leadImage ? `![${resolvedTitle}](${leadImage})

${bodyWithRefs}` : bodyWithRefs;
    }
    if (this.settings.namingMode === "manual") {
      new NamePromptModal(this.app, resolvedTitle, async (chosen) => {
        await this.routeOutput(md, chosen || resolvedTitle);
      }).open();
      return;
    }
    await this.routeOutput(md, resolvedTitle);
  }
  async routeOutput(md, title) {
    var _a, _b;
    const dest = this.settings.destination;
    if (dest === "active") {
      const view = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
      if (view) {
        const editor = view.editor;
        if (this.settings.overwrite) {
          const lastLine = editor.lastLine();
          const lastCh = editor.getLine(lastLine).length;
          editor.replaceRange(
            md,
            { line: 0, ch: 0 },
            { line: lastLine, ch: lastCh }
          );
          new import_obsidian.Notice(`Overwrote "${title}" into active note.`);
        } else {
          editor.replaceSelection(md);
          new import_obsidian.Notice(`Inserted "${title}" into active note.`);
        }
        return;
      }
      new import_obsidian.Notice("No active note \u2014 creating a file instead.");
    }
    const noteName = title;
    let folder = "";
    if (dest === "setFolder") {
      folder = this.settings.targetFolder;
    } else if (dest === "currentFolder") {
      const active = this.app.workspace.getActiveFile();
      if (!active) {
        new import_obsidian.Notice(
          "No active note to read the current folder from \u2014 open a note first, or pick a different destination."
        );
        return;
      }
      const parentPath = (_b = (_a = active.parent) == null ? void 0 : _a.path) != null ? _b : "";
      folder = parentPath === "/" ? "" : parentPath;
    } else if (dest === "vaultRoot") {
      folder = "";
    } else if (dest === "newFolder") {
      const parent = this.settings.newFolderParent.trim();
      const folderName = sanitizeFilename(noteName);
      folder = parent ? (0, import_obsidian.normalizePath)(`${parent}/${folderName}`) : (0, import_obsidian.normalizePath)(folderName);
    }
    await this.createNote(folder, noteName, md);
  }
  async createNote(folder, title, md) {
    const safeTitle = sanitizeFilename(title);
    const dir = folder ? (0, import_obsidian.normalizePath)(folder) : "";
    if (dir && !this.app.vault.getAbstractFileByPath(dir)) {
      try {
        await this.app.vault.createFolder(dir);
      } catch (e) {
      }
    }
    const path = (0, import_obsidian.normalizePath)(
      dir ? `${dir}/${safeTitle}.md` : `${safeTitle}.md`
    );
    const existing = this.findFileByPathCI(path);
    try {
      if (existing instanceof import_obsidian.TFile) {
        if (this.settings.overwrite) {
          await this.app.vault.modify(existing, md);
          new import_obsidian.Notice(`Overwrote "${existing.path}".`);
          await this.app.workspace.getLeaf(true).openFile(existing);
          return;
        }
        const altPath = (0, import_obsidian.normalizePath)(
          dir ? `${dir}/${safeTitle} (imported).md` : `${safeTitle} (imported).md`
        );
        const file2 = await this.app.vault.create(altPath, md);
        new import_obsidian.Notice(`Created "${file2.path}".`);
        await this.app.workspace.getLeaf(true).openFile(file2);
        return;
      }
      const file = await this.app.vault.create(path, md);
      new import_obsidian.Notice(`Created "${file.path}".`);
      await this.app.workspace.getLeaf(true).openFile(file);
    } catch (e) {
      console.error(e);
      new import_obsidian.Notice("Couldn't write the note (see console).");
    }
  }
  /** Find a file by path, case-insensitively (Obsidian's own lookup is
   * case-sensitive, which breaks overwrite when title/folder case differs). */
  findFileByPathCI(path) {
    const exact = this.app.vault.getAbstractFileByPath(path);
    if (exact instanceof import_obsidian.TFile)
      return exact;
    const target = path.toLowerCase();
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (f.path.toLowerCase() === target)
        return f;
    }
    return null;
  }
};
async function fetchWikipediaHtml(title, lang) {
  const endpoint = `https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams({
    action: "parse",
    page: title,
    prop: "text",
    format: "json",
    formatversion: "2",
    redirects: "1"
  }).toString();
  const resp = await (0, import_obsidian.requestUrl)({ url: endpoint });
  const data = resp.json;
  if (data.error) {
    throw new Error(data.error.info || "Wikipedia API error");
  }
  return { html: data.parse.text, title: data.parse.title };
}
var skipImageUrl = null;
function htmlToObsidianMarkdown(html, leadImage) {
  var _a;
  skipImageUrl = leadImage != null ? leadImage : null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = (_a = doc.querySelector(".mw-parser-output")) != null ? _a : doc.body;
  stripFluff(root);
  const lines = [];
  for (const node of Array.from(root.childNodes)) {
    renderBlock(node, lines);
  }
  let md = lines.join("\n\n");
  md = md.replace(/\n{3,}/g, "\n\n").trim();
  skipImageUrl = null;
  return md + "\n";
}
function extractLeadImage(html) {
  var _a;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = (_a = doc.querySelector(".mw-parser-output")) != null ? _a : doc.body;
  const candidates = [
    ".infobox img",
    "table.infobox img",
    ".thumbimage",
    ".thumb img",
    "figure img",
    "img"
  ];
  for (const sel of candidates) {
    const imgs = Array.from(
      root.querySelectorAll(sel)
    );
    for (const img of imgs) {
      let src = img.getAttribute("src") || "";
      if (!src)
        continue;
      if (src.startsWith("//"))
        src = "https:" + src;
      const w = parseInt(img.getAttribute("width") || "0", 10);
      if (w && w < 40)
        continue;
      if (/\/\d+px-/.test(src) || /upload\.wikimedia\.org/.test(src)) {
        return src;
      }
      if (/^https?:\/\//.test(src))
        return src;
    }
  }
  return null;
}
function stripFluff(root) {
  const junkSelectors = [
    "sup.reference",
    // [1] footnote markers
    ".reference",
    ".mw-editsection",
    // [edit] links
    ".mw-references-wrap",
    ".reflist",
    "ol.references",
    "table.infobox",
    "table.navbox",
    // bottom navigation boxes — cut
    "table.vertical-navbox",
    // top "Part of a series" sidebar — cut
    ".sidebar",
    // same family (TopicTOC etc.)
    "table.metadata",
    ".hatnote",
    // "Main article:" etc.
    ".navigation-not-searchable",
    // NOTE: .thumb / figure / img intentionally NOT stripped — images are
    // now rendered as remote embeds. Tiny icons are filtered at render time.
    ".gallery",
    // Multi-image montages ({{multiple image}}) — the grid of little images
    // with a run-on caption at the very top of pages like Physics. These are
    // lead-galleries, not content, and their captions flatten to junk lines.
    ".tmulti",
    // {{multiple image}} wrapper
    ".thumb.tmulti",
    ".multiimageinner",
    "ul.gallery",
    "li.gallerybox",
    ".mw-empty-elt",
    // Math fallback PNGs — we extract LaTeX from <math> instead, so these
    // raster fallbacks would otherwise double-render each equation.
    "img.mwe-math-fallback-image-inline",
    "img.mwe-math-fallback-image-display",
    "style",
    "link",
    ".noprint",
    "#toc",
    ".toc",
    "sup.noprint",
    ".mw-jump-link",
    ".shortdescription"
  ];
  for (const sel of junkSelectors) {
    root.querySelectorAll(sel).forEach((el) => el.remove());
  }
  dropSectionsByHeading(root, [
    "references",
    "external links",
    "notes",
    "further reading",
    "sources",
    "citations",
    "bibliography"
  ]);
}
function dropSectionsByHeading(root, headingsLower) {
  const headings = Array.from(root.querySelectorAll("h2, h3"));
  for (const h of headings) {
    const text = (h.textContent || "").trim().toLowerCase();
    if (headingsLower.includes(text)) {
      let el = h;
      const stopAtH2 = h.tagName.toLowerCase() === "h2";
      const toRemove = [];
      while (el) {
        const next = el.nextElementSibling;
        toRemove.push(el);
        if (next && (next.tagName === "H2" || !stopAtH2 && next.tagName === "H2")) {
          break;
        }
        el = next;
      }
      toRemove.forEach((n) => n.remove());
    }
  }
}
function renderBlock(node, out) {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = (node.textContent || "").trim();
    if (t)
      out.push(t);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE)
    return;
  const el = node;
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case "h2":
      out.push(`## ${inline(el)}`);
      break;
    case "h3":
      out.push(`### ${inline(el)}`);
      break;
    case "h4":
      out.push(`#### ${inline(el)}`);
      break;
    case "p": {
      const text = inline(el).trim();
      if (text)
        out.push(text);
      break;
    }
    case "ul":
    case "ol": {
      const ordered = tag === "ol";
      const items = [];
      let i = 1;
      el.querySelectorAll(":scope > li").forEach((li) => {
        const text = inline(li).trim();
        if (text)
          items.push(`${ordered ? `${i}.` : "-"} ${text}`);
        i++;
      });
      if (items.length)
        out.push(items.join("\n"));
      break;
    }
    case "blockquote":
      out.push(
        inline(el).trim().split("\n").map((l) => `> ${l}`).join("\n")
      );
      break;
    case "dl": {
      const text = inline(el).trim();
      if (text)
        out.push(text);
      break;
    }
    case "table": {
      renderTable(el, out);
      break;
    }
    case "img": {
      const embed = imageEmbed(el);
      if (embed)
        out.push(embed);
      break;
    }
    case "figure": {
      const img = el.querySelector("img");
      const embed = img ? imageEmbed(img) : null;
      if (embed) {
        const cap = el.querySelector("figcaption");
        const capText = cap ? inline(cap).trim() : "";
        out.push(capText ? `${embed}
*${capText}*` : embed);
      }
      break;
    }
    default: {
      for (const child of Array.from(el.childNodes)) {
        renderBlock(child, out);
      }
    }
  }
}
function renderTable(table, out) {
  const rows = Array.from(table.querySelectorAll(":scope > tbody > tr, :scope > tr"));
  if (rows.length === 0)
    return;
  const grid = rows.map(
    (tr) => Array.from(tr.querySelectorAll(":scope > th, :scope > td"))
  );
  const colCounts = grid.map((r) => r.length);
  const maxCols = Math.max(...colCounts);
  const minCols = Math.min(...colCounts);
  const headerCells = (grid[0] || []).filter(
    (c) => c.tagName.toLowerCase() === "th"
  ).length;
  const allCells = grid.flat();
  let prosey = 0;
  for (const cell of allCells) {
    const txt = (cell.textContent || "").trim();
    const linkCount = cell.querySelectorAll("a").length;
    const words = txt.split(/\s+/).filter(Boolean).length;
    if (words >= 3 && words > linkCount)
      prosey++;
  }
  const proseRatio = allCells.length ? prosey / allCells.length : 0;
  const rectangular = maxCols >= 2 && maxCols <= 6 && maxCols - minCols <= 1 && rows.length >= 2;
  const looksLikeData = rectangular && (headerCells >= 2 || proseRatio >= 0.4);
  if (looksLikeData) {
    const md = [];
    grid.forEach((cells, idx) => {
      const vals = cells.map((c) => cellInline(c));
      while (vals.length < maxCols)
        vals.push("");
      md.push(`| ${vals.join(" | ")} |`);
      if (idx === 0) {
        md.push(`| ${Array(maxCols).fill("---").join(" | ")} |`);
      }
    });
    out.push(md.join("\n"));
    return;
  }
  const blocks = [];
  for (const cells of grid) {
    for (const cell of cells) {
      const isHeader = cell.tagName.toLowerCase() === "th";
      const links = Array.from(cell.querySelectorAll("a")).map((a) => renderAnchor(a).trim()).filter((s) => s && s.startsWith("[["));
      if (isHeader) {
        const label = inline(cell).trim();
        if (/^(v|t|e|v ?· ?t ?· ?e)$/i.test(label))
          continue;
        if (label)
          blocks.push(`**${label}**`);
      }
      if (links.length) {
        const seen = /* @__PURE__ */ new Set();
        const uniq = links.filter(
          (l) => seen.has(l) ? false : (seen.add(l), true)
        );
        blocks.push(uniq.map((l) => `- ${l}`).join("\n"));
      }
    }
  }
  if (blocks.length)
    out.push(blocks.join("\n\n"));
}
function cellInline(cell) {
  return inline(cell).replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}
function imageEmbed(img) {
  let src = img.getAttribute("src") || "";
  if (!src)
    return null;
  if (src.startsWith("//"))
    src = "https:" + src;
  if (skipImageUrl && sameImageFile(src, skipImageUrl))
    return null;
  const w = parseInt(img.getAttribute("width") || "0", 10);
  const h = parseInt(img.getAttribute("height") || "0", 10);
  if (w && w < 50)
    return null;
  if (h && h < 50 && w && w < 100)
    return null;
  const okHost = /upload\.wikimedia\.org/.test(src) || /\/\d+px-/.test(src);
  if (!okHost && !/^https?:\/\//.test(src))
    return null;
  const alt = (img.getAttribute("alt") || "image").replace(/[\[\]]/g, "");
  return `![${alt}](${src})`;
}
function sameImageFile(a, b) {
  const base = (u) => {
    const seg = u.split("?")[0].split("/").pop() || u;
    return seg.replace(/^\d+px-/, "").toLowerCase();
  };
  if (a === b)
    return true;
  return base(a) === base(b);
}
function inline(el) {
  let result = "";
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      result += child.textContent || "";
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const c = child;
      const tag = c.tagName.toLowerCase();
      switch (tag) {
        case "a": {
          result += renderAnchor(c);
          break;
        }
        case "b":
        case "strong":
          result += `**${inline(c)}**`;
          break;
        case "i":
        case "em":
          result += `*${inline(c)}*`;
          break;
        case "sup":
          result += `^${inline(c)}`;
          break;
        case "sub":
          result += `~${inline(c)}`;
          break;
        case "br":
          result += "\n";
          break;
        case "code":
          result += "`" + inline(c) + "`";
          break;
        case "math": {
          const tex = mathLatex(c);
          if (tex) {
            const block = c.getAttribute("display") === "block" || (c.getAttribute("class") || "").includes("display");
            result += block ? `
$$${tex}$$
` : `$${tex}$`;
          }
          break;
        }
        default: {
          const innerMath = c.querySelector ? c.querySelector("math") : null;
          if (innerMath) {
            const tex = mathLatex(innerMath);
            if (tex) {
              const block = innerMath.getAttribute("display") === "block" || (c.getAttribute("class") || "").includes("display") || (innerMath.getAttribute("class") || "").includes(
                "display"
              );
              result += block ? `
$$${tex}$$
` : `$${tex}$`;
            }
          } else {
            result += inline(c);
          }
        }
      }
    }
  }
  return result;
}
function extractReferences(html) {
  var _a;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = (_a = doc.querySelector(".mw-parser-output")) != null ? _a : doc.body;
  root.querySelectorAll("ol.references style, ol.references script").forEach((el) => el.remove());
  const lists = root.querySelectorAll("ol.references");
  const out = [];
  lists.forEach((list) => {
    list.querySelectorAll(":scope > li").forEach((li) => {
      li.querySelectorAll("style, script").forEach((el) => el.remove());
      let text = (li.textContent || "").replace(/\s+/g, " ").trim();
      text = text.replace(/^[↑^]+\s*/, "");
      text = text.replace(/^(?:[a-z] )+/i, "").trim();
      if (!text)
        return;
      if (looksLikeCss(text))
        return;
      out.push(text);
    });
  });
  return out;
}
function looksLikeCss(s) {
  if (s.includes(".mw-parser-output"))
    return true;
  const ruleHits = (s.match(/\{[^{}]*:[^{}]*\}/g) || []).length;
  return ruleHits >= 2;
}
function formatReferences(refs, style) {
  if (!refs.length)
    return "";
  const items = refs.map((r) => `${escapeForList(r)}`);
  if (style === "callout") {
    const lines2 = [
      "> [!cite]- References",
      ...items.map((r, i) => `> ${i + 1}. ${r}`)
    ];
    return lines2.join("\n");
  }
  const lines = [
    "## References",
    "",
    ...items.map((r, i) => `${i + 1}. ${r}`)
  ];
  return lines.join("\n");
}
function escapeForList(s) {
  return s.replace(/\n+/g, " ").trim();
}
function mathLatex(el) {
  var _a;
  let tex = el.getAttribute("alttext") || ((_a = el.querySelector('annotation[encoding="application/x-tex"]')) == null ? void 0 : _a.textContent) || "";
  if (!tex) {
    const img = el.querySelector(
      "img.mwe-math-fallback-image-inline, img.mwe-math-fallback-image-display, img"
    );
    tex = (img == null ? void 0 : img.getAttribute("alt")) || "";
  }
  return cleanLatex(tex);
}
function cleanLatex(raw) {
  let tex = (raw || "").trim();
  if (!tex)
    return "";
  for (let i = 0; i < 2; i++) {
    const m = tex.match(/^\{\\(?:displaystyle|textstyle)\s+([\s\S]*)\}$/);
    if (m)
      tex = m[1].trim();
    else
      break;
  }
  tex = tex.replace(/^\\(?:displaystyle|textstyle)\s+/, "");
  tex = tex.replace(/\s+/g, " ").trim();
  return tex;
}
function renderAnchor(a) {
  const href = a.getAttribute("href") || "";
  const text = inline(a).trim();
  const m = href.match(/^\/wiki\/([^#?]+)/);
  if (m) {
    let target = decodeURIComponent(m[1]).replace(/_/g, " ");
    if (/^(File|Image|Help|Category|Template|Wikipedia|Portal|Special):/i.test(target)) {
      return text;
    }
    if (!text)
      return `[[${target}]]`;
    if (text.toLowerCase() === target.toLowerCase())
      return `[[${target}]]`;
    return `[[${target}|${text}]]`;
  }
  if (/^https?:\/\//.test(href)) {
    return text ? `[${text}](${href})` : href;
  }
  return text;
}
function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, "-").trim();
}
var TitlePromptModal = class extends import_obsidian.Modal {
  constructor(app, onSubmit) {
    super(app);
    this.value = "";
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Import Wikipedia page" });
    contentEl.createEl("p", {
      text: "Enter the exact name of the Wikipedia page to import.",
      cls: "setting-item-description"
    });
    const input = contentEl.createEl("input", {
      type: "text",
      placeholder: "e.g. Physics"
    });
    input.style.width = "100%";
    input.style.marginBottom = "0.75em";
    input.addEventListener("input", (e) => {
      this.value = e.target.value;
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.submit();
      }
    });
    const btn = contentEl.createEl("button", { text: "Import" });
    btn.addEventListener("click", () => this.submit());
    const active = this.app.workspace.getActiveFile();
    if (active) {
      input.value = active.basename;
      this.value = active.basename;
    }
    input.focus();
    input.select();
  }
  submit() {
    this.close();
    this.onSubmit(this.value);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var NamePromptModal = class extends import_obsidian.Modal {
  constructor(app, prefill, onSubmit) {
    super(app);
    this.value = prefill;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Name this note" });
    contentEl.createEl("p", {
      text: "This is the name of the imported note (it can differ from the Wikipedia page title).",
      cls: "setting-item-description"
    });
    const input = contentEl.createEl("input", { type: "text" });
    input.style.width = "100%";
    input.style.marginBottom = "0.75em";
    input.value = this.value;
    input.addEventListener("input", (e) => {
      this.value = e.target.value;
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.submit();
      }
    });
    const btn = contentEl.createEl("button", { text: "Create" });
    btn.addEventListener("click", () => this.submit());
    input.focus();
    input.select();
  }
  submit() {
    this.close();
    this.onSubmit(this.value);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var WikiImporterSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Overwrite existing content").setDesc(
      "Replace the whole note instead of inserting or creating a copy. For the active note this replaces its entire body; for file modes it overwrites a same-named note. Off by default so it can't wipe notes unexpectedly \u2014 turn on for a re-import workflow."
    ).addToggle(
      (tg) => tg.setValue(this.plugin.settings.overwrite).onChange(async (v) => {
        this.plugin.settings.overwrite = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Destination").setDesc("Where imported content goes.").addDropdown(
      (d) => d.addOption("active", "Insert into active note").addOption("currentFolder", "New note in current folder").addOption("vaultRoot", "New note at vault root").addOption("setFolder", "New note in a set folder").addOption("newFolder", "Place in new folder (folder + note)").setValue(this.plugin.settings.destination).onChange(async (v) => {
        this.plugin.settings.destination = v;
        await this.plugin.saveSettings();
        this.display();
      })
    );
    if (this.plugin.settings.destination === "setFolder") {
      new import_obsidian.Setting(containerEl).setName("Target folder").setDesc(
        'Folder for imported notes. Type a path like "Wikipedia" or "Refs/Physics" (created if missing).'
      ).addText(
        (t) => t.setPlaceholder("Wikipedia").setValue(this.plugin.settings.targetFolder).onChange(async (v) => {
          this.plugin.settings.targetFolder = v;
          await this.plugin.saveSettings();
        })
      );
    }
    if (this.plugin.settings.destination === "newFolder") {
      new import_obsidian.Setting(containerEl).setName("New-folder parent").setDesc(
        'Optional. A new folder named after the note is created here (leave blank for vault root). The note goes inside it with the same name \u2014 e.g. "Physics/Physics.md".'
      ).addText(
        (t) => t.setPlaceholder("(vault root)").setValue(this.plugin.settings.newFolderParent).onChange(async (v) => {
          this.plugin.settings.newFolderParent = v.trim();
          await this.plugin.saveSettings();
        })
      );
    }
    new import_obsidian.Setting(containerEl).setName("Note naming").setDesc(
      "Automatic: the note takes the exact Wikipedia page title. Manual: you're prompted for the note's name each import (after entering the page title), so the note name and the page title can differ."
    ).addDropdown(
      (d) => d.addOption("automatic", "Automatic (inherit from page)").addOption("manual", "Manual (prompt each time)").setValue(this.plugin.settings.namingMode).onChange(async (v) => {
        this.plugin.settings.namingMode = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Wikipedia language").setDesc('Language subdomain, e.g. "en", "de", "fr".').addText(
      (t) => t.setValue(this.plugin.settings.wikiLang).onChange(async (v) => {
        this.plugin.settings.wikiLang = v.trim() || "en";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Add title heading").setDesc("Prepend a # Title and an import note.").addToggle(
      (tg) => tg.setValue(this.plugin.settings.includeHeading).onChange(async (v) => {
        this.plugin.settings.includeHeading = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("References appearance").setDesc(
      "References are always captured as plaintext and added at the bottom. Choose how they appear: a collapsed callout (tidy) or a plain heading with a numbered list."
    ).addDropdown(
      (d) => d.addOption("callout", "Collapsed callout").addOption("plain", "Plain heading + list").setValue(this.plugin.settings.referencesStyle).onChange(async (v) => {
        this.plugin.settings.referencesStyle = v;
        await this.plugin.saveSettings();
      })
    );
  }
};
