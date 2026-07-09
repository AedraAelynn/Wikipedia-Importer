# Changelog

All notable changes to Wikipedia Importer are documented here.

This project follows [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`, where new features bump the minor version and bug fixes bump the patch version.

---

## [1.2.0]

### Added
- **High-fidelity images.** Wikipedia serves pre-rendered thumbnails; imports now point at the original file instead. SVG diagrams stay as scalable vectors (no longer rasterized to PNG), and animated gifs actually animate. Images still display at their original size, so page layout is unchanged.
- **Always use original photos** setting. Large photographs load as a high-resolution (1200px) render by default rather than the full original, which can be tens of megabytes with no visible benefit. Enable this to always fetch the original file. Vectors and gifs always use the original regardless.

### Changed
- Image embeds now carry an explicit display width (`![alt|250](…)`) so the higher-fidelity source renders at the size Wikipedia intended.

---

## [1.1.1]

### Fixed
- Resolved Obsidian's automated plugin review findings.

---

## [1.1.0]

### Added
- **In-text citations.** Reference markers now appear in the body as Obsidian footnotes (`[^1]`) that link directly to the source in the References section. Where a citation has a URL, the footnote also carries an external `[source]` link.
- **Link style setting.** Choose how internal links are written: `Wikilinks` (`[[Page]]`, builds your vault graph), `Markdown links` (point to Wikipedia online, create no notes), or `No links` (plain text).
- **Images setting.** Choose whether images and gifs are imported, and how: `Embed` (inline), `Link only` (text link, no display), or `Off`.
- **Tag system.** Notes are automatically tagged from Wikipedia's own categories. Configure the tag location (YAML frontmatter, inline `#tags`, or both), the auto-tag source (categories, `+ title`, or `+ frequent words`), and a cap on auto-tags.
- **Fixed tags.** Enter your own comma-separated tags in settings, applied to every import. Optionally enable a per-import prompt to type tags at import time. User tags always appear *before* automatic ones and are never truncated by the auto-tag cap.
- **Automatic tagging toggle.** Auto-tagging can be disabled entirely, leaving only your own tags.
- **Title link toggle.** The `# Title` heading can optionally be plain text rather than a link, since the frontmatter already records the source URL. When the title is unlinked, the attribution line carries the page link instead.
- **Source property toggle.** The `source:` frontmatter property (the page URL) can now be turned off. It remains on by default.
- **"Further reading" sections** are now preserved, appearing before References.
- **Case-insensitive titles.** A mis-cased page name (e.g. `systems Design`) now resolves via search instead of failing.
- **Explanatory notes** in the reference list are separated into their own `Notes` section rather than being numbered as citations.

### Changed
- The "Imported from Wikipedia" attribution now links to Wikipedia's homepage when the title is linked, and to the specific page otherwise.
- References are emitted as footnote definitions under a `## References` heading so in-text markers can link to them.
- The **Fixed tags** setting is blank by default (previously a single `fixedTag` defaulting to `wikipedia`). It now accepts a comma-separated list; the separate "Your tags" field has been merged into it, since the two did the same thing.

### Removed
- **Sister-project boxes and links** (Wiktionary, Wikiquote, Wikibooks, Wikisource, Commons, Wikidata, etc.) are stripped from imports.

### Fixed
- Plugin now passes Obsidian's automated review checks: modal styles moved to `styles.css` instead of inline assignments, settings headings use `Setting.setHeading()`, API responses are properly typed, redundant `TFile` assertions removed, and the `builtin-modules` dependency replaced with Node's native `module.builtinModules`.
- Added an MIT `LICENSE` file.
- Frontmatter is omitted entirely when there are no tags and the source property is disabled, instead of emitting an empty `---` block that renders as a stray horizontal rule.
- Maintenance-banner icons (e.g. the "needs additional citations" question-book) and license badges (e.g. Creative Commons) are no longer picked as a note's lead image.
- Rendered math equations (served as SVG by Wikipedia's math renderer) are no longer picked as a note's lead image. Equations render as LaTeX in the body instead.
- Maintenance and cleanup banners ("This article needs additional citations for verification") are stripped.
- Fundraising and donation banners are stripped.
- `v · t · e` navigation controls no longer leak into notes as `[[Template talk:…]]` links.
- Navigation boxes are stripped more reliably (any element, not just `<table>`).
- CSS from Wikipedia's embedded stylesheets no longer leaks into citation text.

---

## [1.0.2] — Stable release

Initial stable release following 1.0.0.

---

## [1.0.0] — Initial release

- Import any Wikipedia page as clean Markdown.
- Internal links converted to `[[wikilinks]]`, resolving to true page names.
- Equations converted to Obsidian LaTeX (`$...$` / `$$...$$`).
- Images imported as remote embeds.
- References captured as plaintext.
- Configurable destination (active note, current folder, vault root, set folder, new folder), note naming (automatic/manual), and overwrite behavior.
- Commands: import by title, and import matching the current note's title.
