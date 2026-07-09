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
type LinkMode = "wikilinks" | "markdown" | "none";
type ImageMode = "embed" | "link" | "off";
type TagLocation = "frontmatter" | "inline" | "both";
type TagSource = "categories" | "categoriesTitle" | "categoriesFrequent";

interface WikiImporterSettings {
	destination: Destination;
	targetFolder: string;
	newFolderParent: string; // where "Place in New Folder" nests the new folder
	namingMode: NamingMode;
	wikiLang: string; // e.g. "en"
	includeHeading: boolean;
	linkTitleToSource: boolean; // whether the # Title is a link
	overwrite: boolean;
	referencesStyle: "callout" | "plain"; // how the References section appears
	linkMode: LinkMode; // how internal links are rendered
	imageMode: ImageMode; // whether/how images are imported
	tagLocation: TagLocation; // where tags go
	fixedTags: string; // comma-separated tags applied to every import
	autoTagsEnabled: boolean; // whether auto-tags are derived at all
	tagSource: TagSource; // what auto-tags are derived from
	promptForTags: boolean; // ask for tags on each import
	maxAutoTags: number; // cap on auto-derived tags
	includeSourceProperty: boolean; // add `source:` to frontmatter
}

const DEFAULT_SETTINGS: WikiImporterSettings = {
	destination: "active", // default per your workflow: fill the note you're in
	targetFolder: "Wikipedia",
	newFolderParent: "",
	namingMode: "automatic",
	wikiLang: "en",
	includeHeading: true,
	linkTitleToSource: true,
	overwrite: false,
	referencesStyle: "callout",
	linkMode: "wikilinks",
	imageMode: "embed",
	tagLocation: "frontmatter",
	fixedTags: "", // blank by default; placeholder suggests "wikipedia"
	autoTagsEnabled: true,
	tagSource: "categories",
	promptForTags: false,
	maxAutoTags: 8,
	includeSourceProperty: true,
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
		let categories: string[] = [];
		try {
			const res = await fetchWikipediaHtml(title, this.settings.wikiLang);
			html = res.html;
			resolvedTitle = res.title;
			categories = res.categories;
		} catch (e) {
			console.error(e);
			new Notice(`Couldn't fetch "${title}". Check the name/spelling.`);
			return;
		}

		const leadImage =
			this.settings.imageMode === "off" ? null : extractLeadImage(html);
		// Extract references FIRST so the footnote map exists before we convert
		// the body (the in-text [^1] markers need it).
		const refs = extractReferences(html);
		const body = htmlToObsidianMarkdown(html, {
			leadImage,
			linkMode: this.settings.linkMode,
			imageMode: this.settings.imageMode,
			lang: this.settings.wikiLang,
			footnotes: refs.idToFootnote,
		});
		const refsSection = formatReferences(
			refs,
			this.settings.referencesStyle
		);
		const sourceUrl =
			`https://${this.settings.wikiLang}.wikipedia.org/wiki/` +
			encodeURIComponent(resolvedTitle.replace(/ /g, "_"));

		const bodyWithRefs = refsSection ? `${body}\n\n${refsSection}` : body;

		const assemble = (promptedTags: string[]) => {
			const tags = buildTags(
				resolvedTitle,
				categories,
				body,
				this.settings,
				promptedTags
			);
			// Frontmatter is needed if tags live there, or if the source
			// property is on (even when tags are inline-only).
			const tagsInFrontmatter = this.settings.tagLocation !== "inline";
			const frontmatter = buildFrontmatter(
				tagsInFrontmatter ? tags : [],
				sourceUrl,
				this.settings.includeSourceProperty
			);
			const inlineTags =
				this.settings.tagLocation !== "frontmatter" && tags.length
					? tags.map((t) => `#${t}`).join(" ")
					: "";

			const homeUrl = `https://${this.settings.wikiLang}.wikipedia.org/`;

			let out: string;
			if (this.settings.includeHeading) {
				const parts: string[] = [];
				// The title may be plain or linked. When frontmatter carries the
				// source URL, a linked title is redundant — hence the toggle.
				parts.push(
					this.settings.linkTitleToSource
						? `# [${resolvedTitle}](${sourceUrl})`
						: `# ${resolvedTitle}`
				);
				if (leadImage) parts.push(`![${resolvedTitle}](${leadImage})`);
				// If the title already links to the page, point the attribution at
				// Wikipedia's homepage; otherwise carry the page link here.
				parts.push(
					this.settings.linkTitleToSource
						? `*Imported from [Wikipedia](${homeUrl})*`
						: `*Imported from [Wikipedia](${sourceUrl})*`
				);
				if (inlineTags) parts.push(inlineTags);
				parts.push(bodyWithRefs);
				out = parts.join("\n\n");
			} else {
				const pieces: string[] = [];
				if (leadImage) pieces.push(`![${resolvedTitle}](${leadImage})`);
				// No title heading, so the attribution line carries the page link.
				pieces.push(`*Imported from [Wikipedia](${sourceUrl})*`);
				if (inlineTags) pieces.push(inlineTags);
				pieces.push(bodyWithRefs);
				out = pieces.join("\n\n");
			}
			// Frontmatter goes at the very top, before everything.
			if (frontmatter) out = `${frontmatter}\n${out}`;
			return out;
		};

		// If the user wants to type tags per-import, ask now.
		if (this.settings.promptForTags) {
			new TagPromptModal(this.app, async (entered) => {
				const md = assemble(entered);
				await this.finishImport(md, resolvedTitle);
			}).open();
			return;
		}

		const md = assemble([]);
		await this.finishImport(md, resolvedTitle);
	}

	/** Route the assembled note, honoring manual naming if enabled. */
	async finishImport(md: string, resolvedTitle: string) {
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
): Promise<{ html: string; title: string; categories: string[] }> {
	// action=parse with prop=text returns rendered HTML (templates resolved).
	// Adding "categories" returns the article's human-curated categories in the
	// same call — the cleanest source for auto-tags.
	const endpoint =
		`https://${lang}.wikipedia.org/w/api.php?` +
		new URLSearchParams({
			action: "parse",
			page: title,
			prop: "text|categories",
			format: "json",
			formatversion: "2",
			redirects: "1",
		}).toString();

	// requestUrl avoids CORS issues that plain fetch() hits inside Obsidian.
	let resp = await requestUrl({ url: endpoint });
	let data = resp.json;

	// Wikipedia auto-capitalizes the first letter and follows redirects, but is
	// case-sensitive after that ("Systems Design" ≠ "Systems design"). If the
	// exact title misses, search for the closest match and retry.
	if (data.error) {
		const found = await searchForTitle(title, lang);
		if (!found) {
			throw new Error(data.error.info || "Wikipedia API error");
		}
		const retry =
			`https://${lang}.wikipedia.org/w/api.php?` +
			new URLSearchParams({
				action: "parse",
				page: found,
				prop: "text|categories",
				format: "json",
				formatversion: "2",
				redirects: "1",
			}).toString();
		resp = await requestUrl({ url: retry });
		data = resp.json;
		if (data.error) {
			throw new Error(data.error.info || "Wikipedia API error");
		}
	}
	// Categories come back as [{ns, category, hidden?}]. Skip hidden ones
	// (maintenance categories like "Articles with unsourced statements").
	const cats: string[] = Array.isArray(data.parse.categories)
		? data.parse.categories
				.filter((c: { hidden?: boolean }) => !c.hidden)
				.map((c: { category: string }) =>
					String(c.category).replace(/_/g, " ")
				)
		: [];
	return {
		html: data.parse.text as string,
		title: data.parse.title as string,
		categories: cats,
	};
}

/**
 * Find the closest real page title for a possibly mis-cased query.
 * Wikipedia's search is case-insensitive, so this rescues "systems Design".
 */
async function searchForTitle(
	query: string,
	lang: string
): Promise<string | null> {
	try {
		const url =
			`https://${lang}.wikipedia.org/w/api.php?` +
			new URLSearchParams({
				action: "query",
				list: "search",
				srsearch: query,
				srlimit: "1",
				format: "json",
				formatversion: "2",
			}).toString();
		const resp = await requestUrl({ url });
		const hits = resp.json?.query?.search;
		if (Array.isArray(hits) && hits.length && hits[0]?.title) {
			return String(hits[0].title);
		}
	} catch {
		/* fall through */
	}
	return null;
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
// How links and images are rendered for the current conversion (set by the
// caller; default to the original behavior so standalone calls still work).
let activeLinkMode: LinkMode = "wikilinks";
let activeImageMode: ImageMode = "embed";
let activeLang = "en";
// Maps a Wikipedia reference <li> id (e.g. "cite_note-foo-3") to its 1-based
// footnote number, so in-text [1] markers become Obsidian [^1] footnotes.
let footnoteMap: Map<string, number> = new Map();

interface ConvertOpts {
	leadImage?: string | null;
	linkMode?: LinkMode;
	imageMode?: ImageMode;
	lang?: string;
	footnotes?: Map<string, number>;
}

function htmlToObsidianMarkdown(html: string, opts: ConvertOpts = {}): string {
	skipImageUrl = opts.leadImage ?? null;
	activeLinkMode = opts.linkMode ?? "wikilinks";
	activeImageMode = opts.imageMode ?? "embed";
	activeLang = opts.lang ?? "en";
	footnoteMap = opts.footnotes ?? new Map();
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

	// Remove maintenance banners / navboxes first so their icons (e.g. the
	// "needs citations" question-book) can't be picked as the lead image.
	root
		.querySelectorAll(
			".ambox, .ombox, .tmbox, .dmbox, .mbox-image, .navbox, .vertical-navbox, .metadata, .sidebar, .mw-message-box, [role='note']"
		)
		.forEach((el) => el.remove());

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
			// Skip interface chrome (icons, logos, maintenance-banner symbols)
			// — the same filter the body image renderer uses.
			if (isChromeImage(src, img)) continue;
			// Skip tiny icons/sprites (edit pencils, sound icons, etc.).
			const w = parseInt(img.getAttribute("width") || "0", 10);
			if (w && w < 50) continue;
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
		// NOTE: sup.reference / .reference intentionally NOT stripped — they
		// become Obsidian footnote markers [^1] that link to the reference list.
		".mw-editsection", // [edit] links
		".mw-references-wrap",
		".reflist",
		"ol.references",
		"table.infobox",
		".navbox", // bottom navigation boxes (any element, not just <table>)
		".navbox-styles",
		".navbox-inner",
		".navbar", // the "v · t · e" control bar itself
		".vte",
		"table.vertical-navbox", // top "Part of a series" sidebar — cut
		".vertical-navbox",
		".sidebar", // same family (TopicTOC etc.)
		"table.metadata",
		".hatnote", // "Main article:" etc.
		".navigation-not-searchable",
		// Maintenance / cleanup banners: "This article needs additional
		// citations", "may contain original research", orphan/stub notices, etc.
		// These are meta-commentary about the article, not article content.
		".ambox", // article message box (the boxed maintenance notices)
		"table.ambox",
		".ombox", // other message boxes
		".tmbox", // talk-page message boxes (rarely leak in)
		".dmbox", // disambiguation message boxes
		".mbox-small",
		".mbox-image",
		".mbox-text",
		".ambox-multiple_issues",
		".messagebox",
		// Fundraising / donation appeals (CentralNotice banners) and site notices.
		".mw-fundraising",
		".frbanner",
		".cn-fundraising",
		"#siteNotice",
		".mw-dismissable-notice",
		// Sister-project boxes ("Look up X in Wiktionary", "Media related to X
		// at Wikimedia Commons", Wikiquote/Wikibooks/Wikisource boxes). These
		// point outside the vault and outside Wikipedia proper.
		".sister-project",
		".sistersitebox",
		".side-box",
		".side-box-right",
		".side-box-text",
		".plainlinks.sistersitebox",
		"div.sister-wikipedia",
		".interProject",
		".spoken-wikipedia",
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
	// Drop the reference-apparatus sections wholesale (we rebuild References
	// ourselves as footnotes at the end). "Further reading" is KEPT — it's
	// genuine content, and it naturally lands just before our References.
	dropSectionsByHeading(root, [
		"references",
		"external links",
		"notes",
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
	// Filter interface "chrome" images (icons/logos/locks) even when they
	// declare larger dimensions. These are decoration, not article content.
	// Not all SVGs are chrome — real diagrams are SVG too — so we match known
	// chrome filename patterns rather than blanket-removing every .svg.
	if (isChromeImage(src, img)) return null;
	// Only trust real Wikimedia upload URLs or absolute https images.
	const okHost = /upload\.wikimedia\.org/.test(src) || /\/\d+px-/.test(src);
	if (!okHost && !/^https?:\/\//.test(src)) return null;
	const alt = (img.getAttribute("alt") || "image").replace(/[\[\]]/g, "");
	// Respect the image mode: off → nothing, link → a plain markdown link
	// (no inline display), embed → an inline image embed (default).
	if (activeImageMode === "off") return null;
	if (activeImageMode === "link") return `[${alt}](${src})`;
	return `![${alt}](${src})`;
}

/** Detect interface chrome (icons, logos, lock/edit symbols) vs real content. */
function isChromeImage(src: string, img: Element): boolean {
	const cls = img.getAttribute("class") || "";
	// OOjs UI / MediaWiki interface icon classes.
	if (/\b(mw-ui-icon|oo-ui-|mw-editsection|mw-logo)/.test(cls)) return true;
	// Rendered math equations (Wikipedia serves these as SVG from its math
	// renderer). We convert math to LaTeX, so these must never become images.
	if (/\/media\/math\/render\//.test(src)) return true;
	if (/\bmwe-math-fallback-image/.test(cls)) return true;
	const file = decodeURIComponent(src.split("/").pop() || "").toLowerCase();
	// Known chrome filename fragments. These are the icons that show up in
	// maintenance banners, citation locks, sister-project logos, etc.
	const chromePatterns = [
		"lock-green",
		"lock-gray",
		"lock-red",
		"lock-blue",
		"wikisource-logo",
		"commons-logo",
		"wiktionary",
		"wikiquote",
		"wikidata",
		"wikibooks",
		"wikinews",
		"wikiversity",
		"edit-icon",
		"ooui",
		"question_book", // the classic "needs citations" icon
		"ambox",
		"imbox",
		"text_document_with_page_number", // "unreferenced" icon
		"crystal_clear",
		"emblem-",
		"symbol_",
		"wiki_letter",
		"padlock",
		"red_pog",
		"disambig",
		"nuvola",
		"gnome-",
		"folder_",
		"creative_commons",
		"cc-by",
		"cc_by",
		"public_domain",
		"pd-icon",
		"license",
		"increase2",
		"decrease2",
		"steady2",
		"arbcom",
		"office-",
		"star_full",
		"star_empty",
		"star_half",
		"yes_check",
		"x_mark",
		"green_check",
		"speaker_icon",
		"loudspeaker",
		"us_army",
		"flag_of", // country flag icons in infoboxes/nav
	];
	return chromePatterns.some((p) => file.includes(p));
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
				case "sup": {
					// A citation marker: <sup class="reference"><a href="#cite_note-X">[1]</a></sup>
					// Convert to an Obsidian footnote [^N] that links to the
					// reference list at the bottom. If we can't map it, drop it.
					const cls = c.getAttribute("class") || "";
					if (cls.includes("reference")) {
						const a = c.querySelector("a[href^='#']");
						const id = (a?.getAttribute("href") || "").replace(/^#/, "");
						const n = footnoteMap.get(id);
						if (n) result += `[^${n}]`;
						// Unmapped (e.g. a note, not a citation) → emit nothing.
						break;
					}
					result += `^${inline(c)}`;
					break;
				}
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
interface ExtractedRefs {
	citations: string[];
	notes: string[];
	idToFootnote: Map<string, number>;
}

function extractReferences(html: string): ExtractedRefs {
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
	const citations: string[] = [];
	const notes: string[] = [];
	const idToFootnote = new Map<string, number>();
	lists.forEach((list) => {
		list.querySelectorAll(":scope > li").forEach((li) => {
			// Also drop any style/script nested in this specific item, just in case.
			li.querySelectorAll("style, script").forEach((el) => el.remove());

			// A real citation is wrapped in <cite class="citation"> and/or carries
			// bibliographic signatures. Note this BEFORE flattening to text.
			const hasCiteEl = !!li.querySelector("cite");
			const liId = li.getAttribute("id") || "";

			// Grab the citation's own external URL (if any) so the footnote can
			// link out to the source.
			const extLink = li.querySelector(
				"a.external[href^='http'], cite a[href^='http']"
			);
			const extHref = extLink?.getAttribute("href") || "";

			// textContent flattens everything to plaintext — no links/markup.
			let text = (li.textContent || "").replace(/\s+/g, " ").trim();
			text = text.replace(/^[↑^]+\s*/, "");
			text = text.replace(/^(?:[a-z] )+/i, "").trim();
			if (!text) return;
			if (looksLikeCss(text)) return;

			if (hasCiteEl || looksLikeCitation(text)) {
				citations.push(
					extHref ? `${text} [source](${extHref})` : text
				);
				// Map this <li>'s id to its 1-based footnote number so the
				// in-text [1] markers can point at it.
				if (liId) idToFootnote.set(liId, citations.length);
			} else {
				// Explanatory note / caption that isn't a real citation.
				notes.push(text);
			}
		});
	});
	return { citations, notes, idToFootnote };
}

/** Heuristic: does this plaintext look like a bibliographic citation? */
function looksLikeCitation(s: string): boolean {
	// Signatures common to citations but rare in explanatory prose.
	return (
		/\bISBN\b/.test(s) ||
		/\bdoi:/i.test(s) ||
		/\bPMID\b/.test(s) ||
		/\bBibcode\b/.test(s) ||
		/\barXiv\b/.test(s) ||
		/\bISSN\b/.test(s) ||
		/\bRetrieved\b/.test(s) ||
		/\bArchived\b/.test(s) ||
		/\bpp?\.\s*\d/.test(s) || // "p. 342" / "pp. 55–354"
		/\(\d{4}\)/.test(s) || // "(2010)" year in parens — very citation-like
		/\bvol\.?\s*\d/i.test(s)
	);
}

/** Heuristic: does this string look like CSS rather than a citation? */
function looksLikeCss(s: string): boolean {
	if (s.includes(".mw-parser-output")) return true;
	// CSS rule signature: several "selector{prop:value}" chunks.
	const ruleHits = (s.match(/\{[^{}]*:[^{}]*\}/g) || []).length;
	return ruleHits >= 2;
}

/** Format captured references + notes into Markdown per the chosen style. */
function formatReferences(
	refs: ExtractedRefs,
	style: "callout" | "plain"
): string {
	const sections: string[] = [];

	const citations = refs.citations.map(escapeForList);
	const notes = refs.notes.map(escapeForList);

	// Notes (non-citations) keep the callout/plain treatment.
	if (notes.length) {
		if (style === "callout") {
			sections.push(
				["> [!note]- Notes", ...notes.map((n, i) => `> ${i + 1}. ${n}`)].join(
					"\n"
				)
			);
		} else {
			sections.push(
				["## Notes", "", ...notes.map((n, i) => `${i + 1}. ${n}`)].join("\n")
			);
		}
	}

	// Citations are emitted as Obsidian FOOTNOTE DEFINITIONS so the in-text
	// [^1] markers become clickable and jump here. A callout can't contain
	// footnote definitions, so these always live under a heading.
	if (citations.length) {
		const lines = ["## References", ""];
		citations.forEach((c, i) => lines.push(`[^${i + 1}]: ${c}`));
		sections.push(lines.join("\n"));
	}

	return sections.join("\n\n");
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
		// Skip non-article namespaces (File:, Help:, Category:, the various
		// Talk namespaces, Template/Template talk, etc.). These are not article
		// content — they're the v·t·e navigation controls and meta links.
		if (
			/^(File|Image|Media|Help|Category|Template|Wikipedia|Portal|Special|Draft|Module|Book|TimedText|Gadget|MediaWiki|User):/i.test(
				target
			) ||
			/(^|\s)talk:/i.test(target)
		) {
			// Return nothing for these — including the stray "v"/"t"/"e" text —
			// so navigation controls don't leak as letters or links.
			return "";
		}
		// "none" → plain text, no link at all.
		if (activeLinkMode === "none") {
			return text || target;
		}
		// "markdown" → a standard web link to the Wikipedia page (creates no
		// vault note; good for a reading copy).
		if (activeLinkMode === "markdown") {
			const url =
				`https://${activeLang}.wikipedia.org/wiki/` +
				encodeURIComponent(target.replace(/ /g, "_"));
			return `[${text || target}](${url})`;
		}
		// "wikilinks" (default) → Obsidian [[wikilinks]].
		if (!text) return `[[${target}]]`;
		if (text.toLowerCase() === target.toLowerCase()) return `[[${target}]]`;
		return `[[${target}|${text}]]`;
	}

	// External link: keep as normal markdown link if it has http(s),
	// unless the user asked for no links at all.
	if (/^https?:\/\//.test(href)) {
		// Sister projects (Wiktionary, Commons, Wikiquote, …) — drop the link
		// but keep the surrounding text readable.
		if (
			/\b(wiktionary|wikiquote|wikibooks|wikisource|wikinews|wikiversity|wikivoyage|wikispecies|commons\.wikimedia|wikidata)\.org/i.test(
				href
			)
		) {
			return text;
		}
		if (activeLinkMode === "none") return text || href;
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

/** Turn arbitrary text into a valid Obsidian tag (no spaces/punctuation). */
function sanitizeTag(s: string): string {
	return s
		.trim()
		.toLowerCase()
		.replace(/&/g, "and")
		.replace(/[^a-z0-9]+/g, "-") // non-alphanumerics → hyphen
		.replace(/^-+|-+$/g, "") // trim leading/trailing hyphens
		.replace(/-{2,}/g, "-"); // collapse repeats
}

/** Build the final tag list: user tags first, then auto-derived ones. */
function buildTags(
	title: string,
	categories: string[],
	body: string,
	settings: WikiImporterSettings,
	promptedTags: string[] = []
): string[] {
	const tags: string[] = [];
	const push = (raw: string) => {
		const t = sanitizeTag(raw);
		if (t && !tags.includes(t)) tags.push(t);
	};

	// 1) USER TAGS FIRST — tags typed at import time, then the standing list.
	for (const t of promptedTags) push(t);
	for (const t of settings.fixedTags.split(",")) push(t);

	const userCount = tags.length;

	// 2) AUTO TAGS (optional) — appended after the user's own.
	if (settings.autoTagsEnabled) {
		for (const c of categories) push(c);
		if (settings.tagSource === "categoriesTitle") {
			push(title);
		}
		if (settings.tagSource === "categoriesFrequent") {
			for (const w of frequentWords(body, 5)) push(w);
		}
		// Cap only the auto-derived portion; user tags are never truncated.
		const cap = Math.max(1, settings.maxAutoTags);
		return tags.slice(0, userCount + cap);
	}

	return tags;
}

/** Very small stop-word list for frequency analysis. */
const STOP_WORDS = new Set(
	"the a an and or but of to in on at for with from by as is are was were be been being this that these those it its into than then also such not no can may used use using one two first second new other some more most many which who whom whose what when where how why about over under between within without".split(
		" "
	)
);

/** Return the N most frequent meaningful words in the text. */
function frequentWords(text: string, n: number): string[] {
	const counts = new Map<string, number>();
	const words = text
		.toLowerCase()
		.replace(/\[\[[^\]]*\]\]/g, " ") // drop wikilink syntax
		.replace(/[^a-z\s]/g, " ")
		.split(/\s+/);
	for (const w of words) {
		if (w.length < 4 || STOP_WORDS.has(w)) continue;
		counts.set(w, (counts.get(w) || 0) + 1);
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, n)
		.map(([w]) => w);
}

/** Build a YAML frontmatter block with tags and (optionally) the source URL. */
function buildFrontmatter(
	tags: string[],
	sourceUrl: string,
	includeSource: boolean
): string {
	// Nothing to write? Skip the block entirely rather than emitting `---\n---`.
	if (!tags.length && !includeSource) return "";
	const lines = ["---"];
	if (tags.length) {
		lines.push("tags:");
		for (const t of tags) lines.push(`  - ${t}`);
	}
	if (includeSource) lines.push(`source: ${sourceUrl}`);
	lines.push("---");
	return lines.join("\n");
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

/** Prompt for tags to add to this import (comma-separated). */
class TagPromptModal extends Modal {
	private onSubmit: (tags: string[]) => void;
	private value = "";

	constructor(app: App, onSubmit: (tags: string[]) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Add tags" });
		contentEl.createEl("p", {
			text: "Comma-separated. These are added before any automatic tags. Leave blank to skip.",
			cls: "setting-item-description",
		});
		const input = contentEl.createEl("input", {
			type: "text",
			placeholder: "physics, reference, to-read",
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
		input.focus();
	}

	submit() {
		this.close();
		this.onSubmit(
			this.value
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)
		);
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
						this.display();
					})
			);

		if (this.plugin.settings.includeHeading) {
			new Setting(containerEl)
				.setName("Link the title to Wikipedia")
				.setDesc(
					"When on, the # Title links to the source page. Turn off to " +
						"avoid a redundant link — the frontmatter already records " +
						"the source URL."
				)
				.addToggle((tg) =>
					tg
						.setValue(this.plugin.settings.linkTitleToSource)
						.onChange(async (v) => {
							this.plugin.settings.linkTitleToSource = v;
							await this.plugin.saveSettings();
						})
				);
		}

		new Setting(containerEl)
			.setName("Add source property")
			.setDesc(
				"Record the Wikipedia page URL as a `source:` property in the " +
					"note's frontmatter. This is the durable record of where the " +
					"note came from."
			)
			.addToggle((tg) =>
				tg
					.setValue(this.plugin.settings.includeSourceProperty)
					.onChange(async (v) => {
						this.plugin.settings.includeSourceProperty = v;
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

		containerEl.createEl("h3", { text: "Links & images" });

		new Setting(containerEl)
			.setName("Link style")
			.setDesc(
				"How internal Wikipedia links are written. Wikilinks build your " +
					"vault graph; Markdown links point to Wikipedia online " +
					"(no notes created); None strips linking entirely."
			)
			.addDropdown((d) =>
				d
					.addOption("wikilinks", "Wikilinks [[Page]]")
					.addOption("markdown", "Markdown links (to Wikipedia)")
					.addOption("none", "No links (plain text)")
					.setValue(this.plugin.settings.linkMode)
					.onChange(async (v) => {
						this.plugin.settings.linkMode = v as LinkMode;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Images")
			.setDesc(
				"Whether images and gifs are imported, and how. Embed shows them " +
					"inline; Link inserts a text link without displaying; Off " +
					"skips images entirely."
			)
			.addDropdown((d) =>
				d
					.addOption("embed", "Embed (inline)")
					.addOption("link", "Link only")
					.addOption("off", "Off")
					.setValue(this.plugin.settings.imageMode)
					.onChange(async (v) => {
						this.plugin.settings.imageMode = v as ImageMode;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", { text: "Tags" });

		new Setting(containerEl)
			.setName("Tag location")
			.setDesc(
				"Frontmatter keeps tags as clean metadata at the top (recommended). " +
					"Inline places #tags in the note body. Both does each."
			)
			.addDropdown((d) =>
				d
					.addOption("frontmatter", "Frontmatter (YAML)")
					.addOption("inline", "Inline #tags")
					.addOption("both", "Both")
					.setValue(this.plugin.settings.tagLocation)
					.onChange(async (v) => {
						this.plugin.settings.tagLocation = v as TagLocation;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Fixed tags")
			.setDesc(
				"Comma-separated tags applied to every import. These appear " +
					"before any automatic tags and are never truncated."
			)
			.addText((t) =>
				t
					.setPlaceholder("wikipedia, reference")
					.setValue(this.plugin.settings.fixedTags)
					.onChange(async (v) => {
						this.plugin.settings.fixedTags = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Ask for tags on each import")
			.setDesc(
				"Prompt for tags when importing. Entered tags come first, before " +
					"your standing tags and any automatic ones."
			)
			.addToggle((tg) =>
				tg
					.setValue(this.plugin.settings.promptForTags)
					.onChange(async (v) => {
						this.plugin.settings.promptForTags = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Automatic tagging")
			.setDesc(
				"Derive tags from the article itself. Turn off to use only your " +
					"own tags."
			)
			.addToggle((tg) =>
				tg
					.setValue(this.plugin.settings.autoTagsEnabled)
					.onChange(async (v) => {
						this.plugin.settings.autoTagsEnabled = v;
						await this.plugin.saveSettings();
						this.display();
					})
			);

		if (this.plugin.settings.autoTagsEnabled) {
			new Setting(containerEl)
				.setName("Auto-tag source")
				.setDesc(
					"Where automatic tags come from. Wikipedia's own categories " +
						"are the cleanest; optionally add the page title or the " +
						"most frequent content words."
				)
				.addDropdown((d) =>
					d
						.addOption("categories", "Categories only")
						.addOption("categoriesTitle", "Categories + title")
						.addOption(
							"categoriesFrequent",
							"Categories + frequent words"
						)
						.setValue(this.plugin.settings.tagSource)
						.onChange(async (v) => {
							this.plugin.settings.tagSource = v as TagSource;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("Max auto tags")
				.setDesc(
					"Cap on automatically-derived tags. Your own tags are never " +
						"truncated."
				)
				.addText((t) =>
					t
						.setValue(String(this.plugin.settings.maxAutoTags))
						.onChange(async (v) => {
							const n = parseInt(v, 10);
							this.plugin.settings.maxAutoTags =
								isNaN(n) || n < 1 ? 8 : n;
							await this.plugin.saveSettings();
						})
				);
		}
	}
}
