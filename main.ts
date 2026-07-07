import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	requestUrl,
	normalizePath,
	TFile,
} from "obsidian";

/* ---------------------------------------------------------------------------
 * Settings
 * ------------------------------------------------------------------------- */

type Destination =
	| "active"
	| "currentFolder"
	| "vaultRoot"
	| "setFolder"
	| "newFolder";
type NamingMode = "automatic" | "manual";

interface WikiImporterSettings {
	destination: Destination;
	targetFolder: string;
	newFolderParent: string; // where "Place in New Folder" nests the new folder
	namingMode: NamingMode;
	wikiLang: string; // e.g. "en"
	includeHeading: boolean;
	overwrite: boolean;
	referencesStyle: "callout" | "plain"; // how the References section appears
}

const DEFAULT_SETTINGS: WikiImporterSettings = {
	destination: "active", // default per your workflow: fill the note you're in
	targetFolder: "Wikipedia",
	newFolderParent: "",
	namingMode: "automatic",
	wikiLang: "en",
	includeHeading: true,
	overwrite: false,
	referencesStyle: "callout",
};

/* ---------------------------------------------------------------------------
 * Plugin
 * ------------------------------------------------------------------------- */

export default class WikiImporterPlugin extends Plugin {
	settings: WikiImporterSettings;

	async onload() {
		await this.loadSettings();

		// Command: prompt for a title, then import.
		this.addCommand({
			id: "import-wikipedia-page",
			name: "Import Wikipedia page by title",
			callback: () => {
				new TitlePromptModal(this.app, async (title) => {
					await this.importByTitle(title);
				}).open();
			},
		});

		// Convenience: if the active note's title looks like a page name,
		// import straight into it without typing anything.
		this.addCommand({
			id: "import-wikipedia-from-note-title",
			name: "Import Wikipedia page matching current note title",
			editorCallback: async (_editor: Editor, view: MarkdownView) => {
				const name = view.file?.basename;
				if (!name) {
					new Notice("No active note.");
					return;
				}
				await this.importByTitle(name);
			},
		});

		this.addSettingTab(new WikiImporterSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/* -- core flow -------------------------------------------------------- */

	async importByTitle(rawTitle: string) {
		const title = rawTitle.trim();
		if (!title) {
			new Notice("No title given.");
			return;
		}

		new Notice(`Fetching "${title}"…`);
		let html: string;
		let resolvedTitle: string;
		try {
			const res = await fetchWikipediaHtml(title, this.settings.wikiLang);
			html = res.html;
			resolvedTitle = res.title;
		} catch (e) {
			console.error(e);
			new Notice(`Couldn't fetch "${title}". Check the name/spelling.`);
			return;
		}

		const leadImage = extractLeadImage(html);
		const body = htmlToObsidianMarkdown(html, leadImage);
		const refs = extractReferences(html);
		const refsSection = formatReferences(
			refs,
			this.settings.referencesStyle
		);
		const sourceUrl =
			`https://${this.settings.wikiLang}.wikipedia.org/wiki/` +
			encodeURIComponent(resolvedTitle.replace(/ /g, "_"));

		const bodyWithRefs = refsSection ? `${body}\n\n${refsSection}` : body;

		let md: string;
		if (this.settings.includeHeading) {
			const parts: string[] = [];
			// Title links back to the source Wikipedia page.
			parts.push(`# [${resolvedTitle}](${sourceUrl})`);
			if (leadImage) parts.push(`![${resolvedTitle}](${leadImage})`);
			parts.push(`*Imported from [Wikipedia](${sourceUrl})*`);
			parts.push(bodyWithRefs);
			md = parts.join("\n\n");
		} else {
			md = leadImage
				? `![${resolvedTitle}](${leadImage})\n\n${bodyWithRefs}`
				: bodyWithRefs;
		}

		if (this.settings.namingMode === "manual") {
			new NamePromptModal(this.app, resolvedTitle, async (chosen) => {
				await this.routeOutput(md, chosen || resolvedTitle);
			}).open();
			return;
		}

		await this.routeOutput(md, resolvedTitle);
	}

	async routeOutput(md: string, title: string) {
		const dest = this.settings.destination;

		if (dest === "active") {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view) {
				const editor = view.editor;
				if (this.settings.overwrite) {
					// Replace the entire note body.
					const lastLine = editor.lastLine();
					const lastCh = editor.getLine(lastLine).length;
					editor.replaceRange(
						md,
						{ line: 0, ch: 0 },
						{ line: lastLine, ch: lastCh }
					);
					new Notice(`Overwrote "${title}" into active note.`);
				} else {
					editor.replaceSelection(md);
					new Notice(`Inserted "${title}" into active note.`);
				}
				return;
			}
			// Fall through to file creation if no active editor.
			new Notice("No active note — creating a file instead.");
		}

		// Resolve the note name (Automatic inherits the page/note title;
		// Manual would have been prompted earlier and passed in as `title`).
		const noteName = title;

		// Determine folder for file-creation modes.
		let folder = "";
		if (dest === "setFolder") {
			folder = this.settings.targetFolder;
		} else if (dest === "currentFolder") {
			const active = this.app.workspace.getActiveFile();
			if (!active) {
				new Notice(
					"No active note to read the current folder from — " +
						"open a note first, or pick a different destination."
				);
				return;
			}
			const parentPath = active.parent?.path ?? "";
			// Obsidian reports the vault root as "/" — normalize to "" so the
			// note lands at root instead of in a folder literally named "/".
			folder = parentPath === "/" ? "" : parentPath;
		} else if (dest === "vaultRoot") {
			folder = ""; // top level of the vault
		} else if (dest === "newFolder") {
			// Create a folder named after the note, optionally nested under a
			// parent, and put a same-named note inside it.
			const parent = this.settings.newFolderParent.trim();
			const folderName = sanitizeFilename(noteName);
			folder = parent
				? normalizePath(`${parent}/${folderName}`)
				: normalizePath(folderName);
		}

		await this.createNote(folder, noteName, md);
	}

	async createNote(folder: string, title: string, md: string) {
		const safeTitle = sanitizeFilename(title);
		const dir = folder ? normalizePath(folder) : "";
		if (dir && !this.app.vault.getAbstractFileByPath(dir)) {
			try {
				await this.app.vault.createFolder(dir);
			} catch {
				/* folder may already exist; ignore */
			}
		}
		const path = normalizePath(
			dir ? `${dir}/${safeTitle}.md` : `${safeTitle}.md`
		);
		// Case-insensitive lookup: getAbstractFileByPath is exact-match and
		// case-sensitive, so "Physics.md" vs "physics.md" (or a folder-case
		// mismatch) would miss and wrongly create a duplicate. Find any file
		// whose path matches case-insensitively.
		const existing = this.findFileByPathCI(path);

		try {
			if (existing instanceof TFile) {
				if (this.settings.overwrite) {
					await this.app.vault.modify(existing, md);
					new Notice(`Overwrote "${existing.path}".`);
					await this.app.workspace.getLeaf(true).openFile(existing);
					return;
				}
				// Not overwriting: write a "(imported)" copy to avoid clobbering.
				const altPath = normalizePath(
					dir
						? `${dir}/${safeTitle} (imported).md`
						: `${safeTitle} (imported).md`
				);
				const file = (await this.app.vault.create(altPath, md)) as TFile;
				new Notice(`Created "${file.path}".`);
				await this.app.workspace.getLeaf(true).openFile(file);
				return;
			}

			const file = (await this.app.vault.create(path, md)) as TFile;
			new Notice(`Created "${file.path}".`);
			await this.app.workspace.getLeaf(true).openFile(file);
		} catch (e) {
			console.error(e);
			new Notice("Couldn't write the note (see console).");
		}
	}

	/** Find a file by path, case-insensitively (Obsidian's own lookup is
	 * case-sensitive, which breaks overwrite when title/folder case differs). */
	findFileByPathCI(path: string): TFile | null {
		const exact = this.app.vault.getAbstractFileByPath(path);
		if (exact instanceof TFile) return exact;
		const target = path.toLowerCase();
		for (const f of this.app.vault.getMarkdownFiles()) {
			if (f.path.toLowerCase() === target) return f;
		}
		return null;
	}
}

/* ---------------------------------------------------------------------------
 * Wikipedia fetch
 * ------------------------------------------------------------------------- */

async function fetchWikipediaHtml(
	title: string,
	lang: string
): Promise<{ html: string; title: string }> {
	// action=parse with prop=text returns rendered HTML (templates resolved).
	const endpoint =
		`https://${lang}.wikipedia.org/w/api.php?` +
		new URLSearchParams({
			action: "parse",
			page: title,
			prop: "text",
			format: "json",
			formatversion: "2",
			redirects: "1",
		}).toString();

	// requestUrl avoids CORS issues that plain fetch() hits inside Obsidian.
	const resp = await requestUrl({ url: endpoint });
	const data = resp.json;
	if (data.error) {
		throw new Error(data.error.info || "Wikipedia API error");
	}
	return { html: data.parse.text as string, title: data.parse.title as string };
}

/* ---------------------------------------------------------------------------
 * HTML -> Obsidian Markdown
 *
 * We walk the rendered DOM rather than regexing HTML. Wikipedia's HTML is
 * consistent enough that a targeted walker gives clean output and lets us
 * turn <a href="/wiki/X"> into [[X]] precisely.
 * ------------------------------------------------------------------------- */

// URL of the lead image already placed in the header, so the body renderer
// can skip it and avoid a duplicate embed. Reset on each conversion.
let skipImageUrl: string | null = null;

function htmlToObsidianMarkdown(html: string, leadImage?: string | null): string {
	skipImageUrl = leadImage ?? null;
	const doc = new DOMParser().parseFromString(html, "text/html");
	const root = doc.querySelector(".mw-parser-output") ?? doc.body;

	stripFluff(root);

	const lines: string[] = [];
	for (const node of Array.from(root.childNodes)) {
		renderBlock(node, lines);
	}

	let md = lines.join("\n\n");
	md = md.replace(/\n{3,}/g, "\n\n").trim();
	skipImageUrl = null;
	return md + "\n";
}

/**
 * Find the page's lead image URL BEFORE fluff-stripping removes the infobox.
 * Returns an absolute https URL, or null if none found.
 */
function extractLeadImage(html: string): string | null {
	const doc = new DOMParser().parseFromString(html, "text/html");
	const root = doc.querySelector(".mw-parser-output") ?? doc.body;

	// Prefer the infobox image; fall back to the first sizeable thumbnail.
	const candidates = [
		".infobox img",
		"table.infobox img",
		".thumbimage",
		".thumb img",
		"figure img",
		"img",
	];
	for (const sel of candidates) {
		const imgs = Array.from(
			root.querySelectorAll(sel)
		) as HTMLImageElement[];
		for (const img of imgs) {
			let src = img.getAttribute("src") || "";
			if (!src) continue;
			// Wikipedia often serves protocol-relative //upload.wikimedia.org/...
			if (src.startsWith("//")) src = "https:" + src;
			// Skip tiny icons/sprites (edit pencils, sound icons, etc.)
			const w = parseInt(img.getAttribute("width") || "0", 10);
			if (w && w < 40) continue;
			if (/\/\d+px-/.test(src) || /upload\.wikimedia\.org/.test(src)) {
				return src;
			}
			if (/^https?:\/\//.test(src)) return src;
		}
	}
	return null;
}

/** Remove reference apparatus, edit links, infoboxes, nav, images, etc. */
function stripFluff(root: Element) {
	const junkSelectors = [
		"sup.reference", // [1] footnote markers
		".reference",
		".mw-editsection", // [edit] links
		".mw-references-wrap",
		".reflist",
		"ol.references",
		"table.infobox",
		"table.navbox", // bottom navigation boxes — cut
		"table.vertical-navbox", // top "Part of a series" sidebar — cut
		".sidebar", // same family (TopicTOC etc.)
		"table.metadata",
		".hatnote", // "Main article:" etc.
		".navigation-not-searchable",
		// NOTE: .thumb / figure / img intentionally NOT stripped — images are
		// now rendered as remote embeds. Tiny icons are filtered at render time.
		".gallery",
		// Multi-image montages ({{multiple image}}) — the grid of little images
		// with a run-on caption at the very top of pages like Physics. These are
		// lead-galleries, not content, and their captions flatten to junk lines.
		".tmulti", // {{multiple image}} wrapper
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
		".shortdescription",
	];
	for (const sel of junkSelectors) {
		root.querySelectorAll(sel).forEach((el) => el.remove());
	}
	// Drop the "References", "External links", "Notes" sections wholesale by
	// scanning headings and removing everything until the next heading.
	dropSectionsByHeading(root, [
		"references",
		"external links",
		"notes",
		"further reading",
		"sources",
		"citations",
		"bibliography",
	]);
}

function dropSectionsByHeading(root: Element, headingsLower: string[]) {
	const headings = Array.from(root.querySelectorAll("h2, h3"));
	for (const h of headings) {
		const text = (h.textContent || "").trim().toLowerCase();
		if (headingsLower.includes(text)) {
			// Remove this heading and all following siblings up to the next h2.
			let el: Element | null = h;
			const stopAtH2 = h.tagName.toLowerCase() === "h2";
			const toRemove: Element[] = [];
			while (el) {
				const next: Element | null = el.nextElementSibling;
				toRemove.push(el);
				if (
					next &&
					(next.tagName === "H2" ||
						(!stopAtH2 && next.tagName === "H2"))
				) {
					break;
				}
				el = next;
			}
			toRemove.forEach((n) => n.remove());
		}
	}
}

/** Render a top-level block node into markdown lines. */
function renderBlock(node: Node, out: string[]) {
	if (node.nodeType === Node.TEXT_NODE) {
		const t = (node.textContent || "").trim();
		if (t) out.push(t);
		return;
	}
	if (node.nodeType !== Node.ELEMENT_NODE) return;

	const el = node as Element;
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
			if (text) out.push(text);
			break;
		}
		case "ul":
		case "ol": {
			const ordered = tag === "ol";
			const items: string[] = [];
			let i = 1;
			el.querySelectorAll(":scope > li").forEach((li) => {
				const text = inline(li).trim();
				if (text) items.push(`${ordered ? `${i}.` : "-"} ${text}`);
				i++;
			});
			if (items.length) out.push(items.join("\n"));
			break;
		}
		case "blockquote":
			out.push(
				inline(el)
					.trim()
					.split("\n")
					.map((l) => `> ${l}`)
					.join("\n")
			);
			break;
		case "dl": {
			// definition lists show up occasionally; flatten to lines
			const text = inline(el).trim();
			if (text) out.push(text);
			break;
		}
		case "table": {
			// Navboxes are already removed in stripFluff, so tables reaching
			// here are content. Render them (data → pipe table, layout → lists).
			renderTable(el, out);
			break;
		}
		case "img": {
			const embed = imageEmbed(el);
			if (embed) out.push(embed);
			break;
		}
		case "figure": {
			// A figure wraps an <img> plus a <figcaption>.
			const img = el.querySelector("img");
			const embed = img ? imageEmbed(img) : null;
			if (embed) {
				const cap = el.querySelector("figcaption");
				const capText = cap ? inline(cap).trim() : "";
				out.push(capText ? `${embed}\n*${capText}*` : embed);
			}
			break;
		}
		default: {
			// div / section wrappers: recurse into children
			for (const child of Array.from(el.childNodes)) {
				renderBlock(child, out);
			}
		}
	}
}

/**
 * Render a <table>. Wikipedia has two very different kinds:
 *   - DATA tables: consistent column count, real <th> headers → Markdown pipe table
 *   - LAYOUT tables (navboxes, infoboxes, the "Subfields" grid): irregular cells
 *     stuffed with vertical link lists → render as grouped link lists, NOT a grid,
 *     because forcing them into pipes produces the mush you saw.
 */
function renderTable(table: Element, out: string[]) {
	const rows = Array.from(table.querySelectorAll(":scope > tbody > tr, :scope > tr"));
	if (rows.length === 0) return;

	// Gather cells per row.
	const grid = rows.map((tr) =>
		Array.from(tr.querySelectorAll(":scope > th, :scope > td"))
	);

	// Heuristics: is this a genuine data table?
	const colCounts = grid.map((r) => r.length);
	const maxCols = Math.max(...colCounts);
	const minCols = Math.min(...colCounts);
	const headerCells = (grid[0] || []).filter(
		(c) => c.tagName.toLowerCase() === "th"
	).length;

	// Distinguish a genuine DATA/content table from a LAYOUT navbox by looking
	// at what the cells actually hold: content tables have prose in their cells;
	// navboxes have piles of links and little sentence text. A <th> header row
	// is a strong data signal, but many content tables (e.g. the "Laws of
	// motion" table) use plain <td> labels with no <th> at all.
	const allCells = grid.flat();
	let prosey = 0;
	for (const cell of allCells) {
		const txt = (cell.textContent || "").trim();
		const linkCount = cell.querySelectorAll("a").length;
		// "Prose" = has real text and isn't just a stack of links.
		const words = txt.split(/\s+/).filter(Boolean).length;
		if (words >= 3 && words > linkCount) prosey++;
	}
	const proseRatio = allCells.length ? prosey / allCells.length : 0;

	const rectangular =
		maxCols >= 2 && maxCols <= 6 && maxCols - minCols <= 1 && rows.length >= 2;
	const looksLikeData =
		rectangular && (headerCells >= 2 || proseRatio >= 0.4);

	if (looksLikeData) {
		const md: string[] = [];
		grid.forEach((cells, idx) => {
			const vals = cells.map((c) => cellInline(c));
			// pad short rows
			while (vals.length < maxCols) vals.push("");
			md.push(`| ${vals.join(" | ")} |`);
			if (idx === 0) {
				md.push(`| ${Array(maxCols).fill("---").join(" | ")} |`);
			}
		});
		out.push(md.join("\n"));
		return;
	}

	// Layout table → flatten each cell into a grouped link list.
	// Header-ish cells (th) become bold group labels; their content becomes bullets.
	const blocks: string[] = [];
	for (const cells of grid) {
		for (const cell of cells) {
			const isHeader = cell.tagName.toLowerCase() === "th";
			// Collect links/lines inside the cell.
			const links = Array.from(cell.querySelectorAll("a"))
				.map((a) => renderAnchor(a).trim())
				.filter((s) => s && s.startsWith("[["));
			if (isHeader) {
				const label = inline(cell).trim();
				// Skip the v·t·e navigation controls.
				if (/^(v|t|e|v ?· ?t ?· ?e)$/i.test(label)) continue;
				if (label) blocks.push(`**${label}**`);
			}
			if (links.length) {
				// de-dup while preserving order
				const seen = new Set<string>();
				const uniq = links.filter((l) =>
					seen.has(l) ? false : (seen.add(l), true)
				);
				blocks.push(uniq.map((l) => `- ${l}`).join("\n"));
			}
		}
	}
	if (blocks.length) out.push(blocks.join("\n\n"));
}

/** Inline content for a table cell, with pipes escaped so they don't break the row. */
function cellInline(cell: Element): string {
	return inline(cell).replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

/**
 * Build a Markdown image embed from an <img>, or null if it's a tiny icon,
 * a sprite, or otherwise not a real content image.
 */
function imageEmbed(img: Element): string | null {
	let src = img.getAttribute("src") || "";
	if (!src) return null;
	if (src.startsWith("//")) src = "https:" + src;
	// Skip the lead image already placed in the header (avoids a duplicate).
	// Compare the underlying file (ignoring the NNNpx- size prefix) so a
	// 250px infobox lead and a 220px body thumb of the same file both match.
	if (skipImageUrl && sameImageFile(src, skipImageUrl)) return null;
	// Filter tiny images (edit pencils, audio icons, math sprites, flags).
	const w = parseInt(img.getAttribute("width") || "0", 10);
	const h = parseInt(img.getAttribute("height") || "0", 10);
	if (w && w < 50) return null;
	if (h && h < 50 && w && w < 100) return null;
	// Only trust real Wikimedia upload URLs or absolute https images.
	const okHost = /upload\.wikimedia\.org/.test(src) || /\/\d+px-/.test(src);
	if (!okHost && !/^https?:\/\//.test(src)) return null;
	const alt = (img.getAttribute("alt") || "image").replace(/[\[\]]/g, "");
	return `![${alt}](${src})`;
}

/** True if two Wikimedia image URLs point at the same underlying file,
 * ignoring the "/NNNpx-" thumbnail size prefix. */
function sameImageFile(a: string, b: string): boolean {
	const base = (u: string) => {
		// Take the final path segment and strip a leading "NNNpx-".
		const seg = u.split("?")[0].split("/").pop() || u;
		return seg.replace(/^\d+px-/, "").toLowerCase();
	};
	if (a === b) return true;
	return base(a) === base(b);
}

/** Convert inline content (links, bold, italic, text) to markdown. */
function inline(el: Node): string {
	let result = "";
	for (const child of Array.from(el.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) {
			result += child.textContent || "";
		} else if (child.nodeType === Node.ELEMENT_NODE) {
			const c = child as Element;
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
					// Extract LaTeX and wrap for Obsidian; do NOT recurse into
					// the MathML children (that produces one-symbol-per-line junk).
					const tex = mathLatex(c);
					if (tex) {
						const block =
							c.getAttribute("display") === "block" ||
							(c.getAttribute("class") || "").includes("display");
						result += block ? `\n$$${tex}$$\n` : `$${tex}$`;
					}
					break;
				}
				default: {
					// If this element wraps a <math> (e.g. span.mwe-math-element),
					// extract the LaTeX rather than recursing into the raw MathML,
					// which would flatten to one-symbol-per-line junk.
					const innerMath = c.querySelector
						? c.querySelector("math")
						: null;
					if (innerMath) {
						const tex = mathLatex(innerMath);
						if (tex) {
							const block =
								innerMath.getAttribute("display") === "block" ||
								(c.getAttribute("class") || "").includes("display") ||
								(innerMath.getAttribute("class") || "").includes(
									"display"
								);
							result += block ? `\n$$${tex}$$\n` : `$${tex}$`;
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

/**
 * Capture references as PLAINTEXT before stripFluff removes them.
 * Returns an array of clean citation strings (no links, no markdown).
 */
function extractReferences(html: string): string[] {
	const doc = new DOMParser().parseFromString(html, "text/html");
	const root = doc.querySelector(".mw-parser-output") ?? doc.body;

	// Wikipedia embeds a <style> block inside the reference list to style the
	// citations. Remove style/script so their contents don't get flattened into
	// citation text as CSS gibberish.
	root
		.querySelectorAll("ol.references style, ol.references script")
		.forEach((el) => el.remove());

	// The numbered citation list(s). There can be more than one on a page.
	const lists = root.querySelectorAll("ol.references");
	const out: string[] = [];
	lists.forEach((list) => {
		list.querySelectorAll(":scope > li").forEach((li) => {
			// Also drop any style/script nested in this specific item, just in case.
			li.querySelectorAll("style, script").forEach((el) => el.remove());
			// textContent flattens everything to plaintext — no links/markup.
			let text = (li.textContent || "").replace(/\s+/g, " ").trim();
			// Drop the leading "↑" / back-reference arrows Wikipedia adds.
			text = text.replace(/^[↑^]+\s*/, "");
			// Drop leading back-link letters like "a b c" that jump to citations.
			text = text.replace(/^(?:[a-z] )+/i, "").trim();
			if (!text) return;
			// Guard: skip anything that still looks like leaked CSS rather than a
			// citation (e.g. a stray inline style that wasn't in a <style> tag).
			if (looksLikeCss(text)) return;
			out.push(text);
		});
	});
	return out;
}

/** Heuristic: does this string look like CSS rather than a citation? */
function looksLikeCss(s: string): boolean {
	if (s.includes(".mw-parser-output")) return true;
	// CSS rule signature: several "selector{prop:value}" chunks.
	const ruleHits = (s.match(/\{[^{}]*:[^{}]*\}/g) || []).length;
	return ruleHits >= 2;
}

/** Format captured references into a Markdown section per the chosen style. */
function formatReferences(refs: string[], style: "callout" | "plain"): string {
	if (!refs.length) return "";
	const items = refs.map((r) => `${escapeForList(r)}`);
	if (style === "callout") {
		// Foldable callout (collapsed). Each line prefixed with "> ".
		const lines = [
			"> [!cite]- References",
			...items.map((r, i) => `> ${i + 1}. ${r}`),
		];
		return lines.join("\n");
	}
	// Plain heading + numbered list.
	const lines = [
		"## References",
		"",
		...items.map((r, i) => `${i + 1}. ${r}`),
	];
	return lines.join("\n");
}

/** Neutralize characters that would break out of a list item. */
function escapeForList(s: string): string {
	return s.replace(/\n+/g, " ").trim();
}

/** Extract clean LaTeX from a <math> element (or its wrappers). */
function mathLatex(el: Element): string {
	// LaTeX can live in several places depending on how the API rendered it:
	//  1) the <math> alttext attribute
	//  2) an <annotation encoding="application/x-tex"> child
	//  3) a fallback image's alt text
	let tex =
		el.getAttribute("alttext") ||
		el.querySelector('annotation[encoding="application/x-tex"]')
			?.textContent ||
		"";
	if (!tex) {
		const img = el.querySelector(
			"img.mwe-math-fallback-image-inline, img.mwe-math-fallback-image-display, img"
		);
		tex = img?.getAttribute("alt") || "";
	}
	return cleanLatex(tex);
}

/** Strip Wikipedia's display wrapper and normalize whitespace in LaTeX. */
function cleanLatex(raw: string): string {
	let tex = (raw || "").trim();
	if (!tex) return "";
	// Peel off {\displaystyle ...} / {\textstyle ...} (possibly nested once).
	for (let i = 0; i < 2; i++) {
		const m = tex.match(/^\{\\(?:displaystyle|textstyle)\s+([\s\S]*)\}$/);
		if (m) tex = m[1].trim();
		else break;
	}
	// Some exports prefix a bare "\displaystyle " with no braces.
	tex = tex.replace(/^\\(?:displaystyle|textstyle)\s+/, "");
	// Collapse the newlines/extra spaces MathML export sometimes injects.
	tex = tex.replace(/\s+/g, " ").trim();
	return tex;
}

/** Turn an <a> into an Obsidian wikilink when it points at another article. */
function renderAnchor(a: Element): string {
	const href = a.getAttribute("href") || "";
	const text = inline(a).trim();

	// Internal article links look like /wiki/Page_Name
	const m = href.match(/^\/wiki\/([^#?]+)/);
	if (m) {
		let target = decodeURIComponent(m[1]).replace(/_/g, " ");
		// Skip non-article namespaces (File:, Help:, Category:, etc.)
		if (/^(File|Image|Help|Category|Template|Wikipedia|Portal|Special):/i.test(target)) {
			return text;
		}
		if (!text) return `[[${target}]]`;
		if (text.toLowerCase() === target.toLowerCase()) return `[[${target}]]`;
		return `[[${target}|${text}]]`;
	}

	// External link: keep as normal markdown link if it has http(s).
	if (/^https?:\/\//.test(href)) {
		return text ? `[${text}](${href})` : href;
	}

	// Anything else (anchors, javascript): just the text.
	return text;
}

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

function sanitizeFilename(name: string): string {
	return name.replace(/[\\/:*?"<>|]/g, "-").trim();
}

/* ---------------------------------------------------------------------------
 * Title prompt modal
 * ------------------------------------------------------------------------- */

class TitlePromptModal extends Modal {
	private onSubmit: (title: string) => void;
	private value = "";

	constructor(app: App, onSubmit: (title: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Import Wikipedia page" });
		contentEl.createEl("p", {
			text: "Enter the exact name of the Wikipedia page to import.",
			cls: "setting-item-description",
		});

		const input = contentEl.createEl("input", {
			type: "text",
			placeholder: "e.g. Physics",
		});
		input.style.width = "100%";
		input.style.marginBottom = "0.75em";
		input.addEventListener("input", (e) => {
			this.value = (e.target as HTMLInputElement).value;
		});
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.submit();
			}
		});

		const btn = contentEl.createEl("button", { text: "Import" });
		btn.addEventListener("click", () => this.submit());

		// Prefill with the active note's title as a convenience.
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
}

/** Prompt for a note name (Manual naming mode), prefilled with the page title. */
class NamePromptModal extends Modal {
	private onSubmit: (name: string) => void;
	private value: string;

	constructor(app: App, prefill: string, onSubmit: (name: string) => void) {
		super(app);
		this.value = prefill;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Name this note" });
		contentEl.createEl("p", {
			text: "This is the name of the imported note (it can differ from the Wikipedia page title).",
			cls: "setting-item-description",
		});
		const input = contentEl.createEl("input", { type: "text" });
		input.style.width = "100%";
		input.style.marginBottom = "0.75em";
		input.value = this.value;
		input.addEventListener("input", (e) => {
			this.value = (e.target as HTMLInputElement).value;
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
}

/* ---------------------------------------------------------------------------
 * Settings tab
 * ------------------------------------------------------------------------- */

class WikiImporterSettingTab extends PluginSettingTab {
	plugin: WikiImporterPlugin;

	constructor(app: App, plugin: WikiImporterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Overwrite existing content")
			.setDesc(
				"Replace the whole note instead of inserting or creating a copy. " +
					"For the active note this replaces its entire body; for file " +
					"modes it overwrites a same-named note. Off by default so it " +
					"can't wipe notes unexpectedly — turn on for a re-import workflow."
			)
			.addToggle((tg) =>
				tg
					.setValue(this.plugin.settings.overwrite)
					.onChange(async (v) => {
						this.plugin.settings.overwrite = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Destination")
			.setDesc("Where imported content goes.")
			.addDropdown((d) =>
				d
					.addOption("active", "Insert into active note")
					.addOption("currentFolder", "New note in current folder")
					.addOption("vaultRoot", "New note at vault root")
					.addOption("setFolder", "New note in a set folder")
					.addOption("newFolder", "Place in new folder (folder + note)")
					.setValue(this.plugin.settings.destination)
					.onChange(async (v) => {
						this.plugin.settings.destination = v as Destination;
						await this.plugin.saveSettings();
						this.display(); // refresh to show/hide dependent fields
					})
			);

		if (this.plugin.settings.destination === "setFolder") {
			new Setting(containerEl)
				.setName("Target folder")
				.setDesc(
					"Folder for imported notes. Type a path like " +
						'"Wikipedia" or "Refs/Physics" (created if missing).'
				)
				.addText((t) =>
					t
						.setPlaceholder("Wikipedia")
						.setValue(this.plugin.settings.targetFolder)
						.onChange(async (v) => {
							this.plugin.settings.targetFolder = v;
							await this.plugin.saveSettings();
						})
				);
		}

		if (this.plugin.settings.destination === "newFolder") {
			new Setting(containerEl)
				.setName("New-folder parent")
				.setDesc(
					"Optional. A new folder named after the note is created " +
						"here (leave blank for vault root). The note goes inside " +
						'it with the same name — e.g. "Physics/Physics.md".'
				)
				.addText((t) =>
					t
						.setPlaceholder("(vault root)")
						.setValue(this.plugin.settings.newFolderParent)
						.onChange(async (v) => {
							this.plugin.settings.newFolderParent = v.trim();
							await this.plugin.saveSettings();
						})
				);
		}

		new Setting(containerEl)
			.setName("Note naming")
			.setDesc(
				"Automatic: the note takes the exact Wikipedia page title. " +
					"Manual: you're prompted for the note's name each import " +
					"(after entering the page title), so the note name and the " +
					"page title can differ."
			)
			.addDropdown((d) =>
				d
					.addOption("automatic", "Automatic (inherit from page)")
					.addOption("manual", "Manual (prompt each time)")
					.setValue(this.plugin.settings.namingMode)
					.onChange(async (v) => {
						this.plugin.settings.namingMode = v as NamingMode;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Wikipedia language")
			.setDesc('Language subdomain, e.g. "en", "de", "fr".')
			.addText((t) =>
				t
					.setValue(this.plugin.settings.wikiLang)
					.onChange(async (v) => {
						this.plugin.settings.wikiLang = v.trim() || "en";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Add title heading")
			.setDesc("Prepend a # Title and an import note.")
			.addToggle((tg) =>
				tg
					.setValue(this.plugin.settings.includeHeading)
					.onChange(async (v) => {
						this.plugin.settings.includeHeading = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("References appearance")
			.setDesc(
				"References are always captured as plaintext and added at the " +
					"bottom. Choose how they appear: a collapsed callout (tidy) " +
					"or a plain heading with a numbered list."
			)
			.addDropdown((d) =>
				d
					.addOption("callout", "Collapsed callout")
					.addOption("plain", "Plain heading + list")
					.setValue(this.plugin.settings.referencesStyle)
					.onChange(async (v) => {
						this.plugin.settings.referencesStyle =
							v as "callout" | "plain";
						await this.plugin.saveSettings();
					})
			);
	}
}
