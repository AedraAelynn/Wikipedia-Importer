# Wikipedia Importer by Concomitant

**Turn any Wikipedia page into a clean, fully-linked Obsidian note — in one command.**

Wikipedia Importer fetches a Wikipedia article and drops it into a new or existing `Note` in your `Vault` as tidy Markdown: every Wikipedia link becomes an internal `[[wikilink]]`, equations become Obsidian-rendered $\LaTeX$ (WIP), images and animated gifs come through, sources are preserved as clickable footnotes, and most of the clutter is stripped away. What you're left with is a readable, navigable note that plugs straight into your knowledge graph and `Vault`.

---

## Why use it?

Obsidian is at its best when your notes are *linked*, yet building a web of knowledge by hand is slow, and simply copy-pasting from Wikipedia leaves you with broken formatting, dead links, and a wall of citation clutter.

Wikipedia Importer attempts to solve that:

- **Every Wikipedia link becomes a `[[wikilink]]`** — so an imported page instantly connects to everything else in your `Vault`, and every link becomes a doorway to the next import. (Configurable — see `Link style`.)
- **Clean by default** — navboxes, maintenance banners ("This article needs additional citations"), fundraising notices, sister-project boxes, edit-section markers, and the sidebar formatting are all removed. You get the article, not the scaffolding.
- **Real math** — equations are converted to Obsidian LaTeX (`$...$` and `$$...$$`), so they render properly instead of arriving as garbled glyphs. (work in progress)
- **Images included** — content images come through as embeds; tiny icons, logos, license badges, and sprites are filtered out. Images are not stored locally. (Configurable — see `Images`.)
- **True page names** — a link like `[[Elementary particle|fundamental constituents]]` resolves to the page (`Elementary particle`), not the display text, so your links always point where they should.
- **Sources preserved in Plaintext** — the article's references are captured as plain text and tucked into a `## References` section at the bottom of the import. You keep the citations for when you need them without `[[ISBN]]`/`[[doi]]` junk links polluting your graph.
- **In-text citations that actually link** — reference markers appear in the body as footnotes (`[^1]`) that jump straight to the source below, exactly like Wikipedia. Where a citation has a URL, the footnote carries an external `[source]` link too.
- **Automatic tags** — `Notes` are tagged from Wikipedia's own categories the moment they land, so your imports organize themselves. Add your own tags as well, or turn auto-tagging off entirely.

---

## Recommended workflow (can be done from a blank Vault)

**Link-Walking**:

1. Run the `Wikipedia Importer: Import Wikipedia page by title` command to create a new `Note` with the imported content.
2. In the `Note`, find any `[[wikilink]]` that doesn't have a `Note` yet.
3. **Left-click** on the link, so that Obsidian creates the (empty) `Note` and opens it.
4. Run the command **`Wikipedia Importer: Import Wikipedia page matching current note title`**.
5. The empty `Note` will be filled with that Wikipedia page's content — complete with *its* links.
6. Click any `[[wikilink]]`, and continue creating new notes with the aforementioned commands.

Each import opens dozens (or perhaps hundreds) of new connections. You can follow a thread: e.g., — Physics → Quantum mechanics → Wave–particle duality → … — building a rich, interconnected weave of your `Vault` as you read, without ever leaving Obsidian or typing a page name.

> **Tip:** Bind that command to a hotkey (Settings → Hotkeys → search "Wikipedia Importer") and the whole loop becomes: Left-click a link, tap your hotkey, import, repeat.

---

## Commands

Open the command palette (`Ctrl/Cmd + P`) and search "Wikipedia Importer":

| Command | What it does |
|---|---|
| **Import Wikipedia page by title** | Prompts you for a page name and imports it as a `Note` into a destination determined by `Settings`. |
| **Import Wikipedia page matching current `Note` title** | Imports the Wikipedia page whose title matches the name of the current `Note` — no typing required. This is the one for the Link-Walking workflow above. |

---

## Settings

### General

| Setting | Options | Notes |
|---|---|---|
| **Overwrite existing content (Recommended ON)** | On / Off | **Off** by default so it can't wipe a `Note` unexpectedly. Turn **On** for the re-import / refresh workflow, where it replaces the whole body of the `Note`. |
| **Destination** | Active note · Current folder · Vault root · Set folder · New folder | Where the imported `Note` goes. "New folder" creates a `Folder` named after the Wikipedia page with the `Note` placed inside it (nestable). |
| **Note naming** | Automatic / Manual | *Automatic* names the `Note` after the Wikipedia page. *Manual* prompts you to declare both the Wikipedia page and the name of the `Note` each time, so the `Note` name and page title can differ. |
| **Wikipedia language** | `en`, `de`, `fr`, … | The language subdomain to pull from. **`en` is the only language that has been tested. If you experience issues in another language, please report the issues.** |
| **Add title heading** | On / Off | Prepends a `# Title` and an "Imported from Wikipedia" line. |
| **Link the title to Wikipedia** | On / Off | Whether the `# Title` is itself a link. Turn **Off** to avoid a redundant link — the `source` property already records where the `Note` came from. |
| **Add source property** | On / Off | Records the Wikipedia page URL as a `source:` property in the `Note`'s frontmatter. This is the durable record of where the `Note` came from. |
| **References appearance** | Collapsed callout / Plain heading + list | Controls how the *Notes* section (explanatory notes that aren't citations) is displayed. Citations are always emitted as linked footnotes under `## References`. You should NEVER remove sources from any sourced document!|

### Links & images

| Setting | Options | Notes |
|---|---|---|
| **Link style** | Wikilinks / Markdown links / No links | *Wikilinks* (`[[Page]]`) build your `Vault` graph. *Markdown links* point to Wikipedia online and create no `Notes` — ideal for a standalone reading copy. *No links* strips linking entirely. |
| **Images** | Embed / Link only / Off | *Embed* displays images inline. *Link only* inserts a text link without displaying. *Off* skips images entirely. |

### Tags

| Setting | Options | Notes |
|---|---|---|
| **Tag location** | Frontmatter / Inline / Both | *Frontmatter* keeps tags as clean YAML metadata at the top (recommended). *Inline* places `#tags` in the body of the `Note`. |
| **Fixed tags** | text | Comma-separated tags applied to every import. These appear *before* any automatic tags and are never truncated. Blank by default. |
| **Ask for tags on each import** | On / Off | Prompts you for tags at import time. Entered tags come first, before your fixed tags and any automatic ones. |
| **Automatic tagging** | On / Off | Derives tags from the article itself. Turn **Off** to use only your own tags. |
| **Auto-tag source** | Categories / Categories + title / Categories + frequent words | Where automatic tags come from. Wikipedia's own categories are the cleanest, as they're written by editors; optionally add the page title or the most frequent content words. |
| **Max auto tags** | number | A cap on automatically-derived tags. Your own tags are never truncated. |

---

## Installation

### Automatic (Simplest)
1. Open Obsidian settings.
2. Click `Browse` in `Community Plugins`. *Note: You must have enabled `Community Plugins`.*
3. Search for `Wikipedia Importer`.
4. `Install` the plugin and configure `Settings` to your preferences.
   
### Manual
1. Download `main.js`, `manifest.json`, and `styles.css` from this repository's latest release.
2. In your vault, create the folder: `.obsidian/plugins/wikipedia-importer/`
3. Put all three files inside it.
4. In Obsidian: **Settings → Community plugins**, enable community plugins if needed, then toggle on **Wikipedia Importer**, and adjust settings accordingly.

*Troubleshoot Step: New plugin folders aren't auto-detected — restart Obsidian or toggle Community plugins off/on so it appears.*

### Build it yourself
Requires [Node.js](https://nodejs.org) (LTS).
1. Clone or download this repository into `.obsidian/plugins/wikipedia-importer/`.
2. Open a terminal in that folder.
3. Run `npm install` (once), then `npm run build` (might take a few moments).
4. Enable the plugin in Obsidian.

Use `npm run dev` to rebuild automatically as you edit the source.

---

## Good to know

- **Content, not a mirror.** The goal is a clean reading *and* clean linking `Note`, not a perfect copy of the Wikipedia page. Some formatting and navigation tools are intentionally dropped.
- **Images and animated gifs are remote embeds.** They load from Wikimedia's servers, so they need an internet connection to display and aren't stored offline in your `Vault`.
- **Math renders in Reading/Live Preview.** In raw Source mode you'll see the `$$...$$` markup as plain text — try switching views if it's garbled, and submit a ticket if it's broken math.
- **Footnotes render in Reading/Live Preview too.** The `[^1]` markers become clickable superscripts that jump to the citation at the bottom of the `Note`.
- **Titles are forgiving.** A mis-cased page name (e.g. `systems Design`) resolves via search rather than failing outright.
- **A note on large graphs.** Importing densely-linked pages (and their neighbors) creates a *LOT* of links, which Obsidian's graph view and backlinks panel have to render. If things feel sluggish during heavy importing, closing the graph view and turning off "backlinks in document" helps immensely — the slowdown is Obsidian indexing the links, not the import itself.

---

## How it works (under the hood)

The plugin calls Wikipedia's public API for the rendered HTML of a page (no API key needed), walks the resulting document, and converts it element by element: anchors pointing at `/wiki/...` become wikilinks, `<math>` elements are unwrapped to their underlying LaTeX, content tables become Markdown tables, reference markers become linked footnotes, and a set of known-clutter containers (navboxes, infoboxes, maintenance banners, sister-project boxes, montages) are removed. The article's categories are pulled in the same call to power automatic tagging. The result is written into your vault according to your destination, naming, link, image, and tag settings.

---

*Built with a lot of iteration, for anyone who wants Wikipedia's knowledge web living inside their own.*

---

*Built with Claude (Opus 4.8)*
