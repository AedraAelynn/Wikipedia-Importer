# Changelog

All notable changes to Wikipedia Importer are documented here.

---

## [1.1.0]

### Added
- **`tag` system:** Any new import now supports a list of tags that can be entered manually, and/or they can be automatically generated from Wikipedia's own categories. (Suggestion by: Discord user @blueyuzu)
- **Fixed tags:** Enter your own comma-separated `tag` list in the plugin settings, which will be applied to every new import. Optionally enable a per-import prompt to type the `tag` list at import time. User tags always appear *before* automatic ones and are never truncated by the auto-tag cap.
- **Automatic `tag` toggle:** Auto-tagging can be disabled entirely, leaving only your own tags.
- **In-text citations:** Reference markers now appear in the body as Obsidian footnotes (`[^1]`) that link directly to the source in the References section. Where a citation has a URL, the footnote also carries an external `[source]` link.
- **Link style setting:** Choose how internal links are written: `wikilinks` (`[[Page]]`, helps to build your `Vault` graph), `Markdown links` (point to Wikipedia online, does not create a `Note`), or `No links` (plain text).
- **Images setting:** Choose whether images and gifs are imported, and how: `Embed` (inline), `Link only` (text link, no display), or `Off`.
- **Title link toggle:** The `# Title` heading can optionally be plain text rather than a link, since the frontmatter already records the source URL. When the title is unlinked, the attribution line carries the page link instead.
- **Source property toggle:** The `source` frontmatter property (the page URL) can now be turned off. It is `On` by default.
- **"Further reading" sections** are now preserved instead of removed, appearing before References.
- **Explanatory notes** in the reference list are separated into their own `Notes` section rather than being numbered as citations.

### Changed
- The "Imported from Wikipedia" attribution now links to Wikipedia's homepage when the title is linked, and to the specific page otherwise.
- References are emitted as footnote definitions under a `## References` heading so in-text markers can link to them.
- Relative-project boxes and links (Wiktionary, Wikiquote, Wikibooks, Wikisource, Commons, Wikidata, etc.) are stripped from imports.

### Fixed
- Maintenance-banner icons (e.g. the "needs additional citations" question-book) and license badges (e.g. Creative Commons) are no longer picked as a note's lead image. (Reported by: Discord user @blueyuzu)
- Maintenance and cleanup banners ("This article needs additional citations for verification," as well as fund-raising banners, etc.) are stripped.
- Fixed mis-cased `Note` names (e.g. `systems Design` (incorrect) vs. `Systems design` (correct)) failing to resolve. Please continue to report any failed imports.
- Rendered math equations (served as `.SVG` by Wikipedia's math renderer) are no longer picked as a note's lead image. Equations render as $\LaTeX$ in the body instead.
- `v · t · e` navigation controls no longer leak into notes as `[[Template talk:…]]` links.
- Navigation boxes are stripped more reliably (any element, not just `<table>`).
- CSS from Wikipedia's embedded stylesheets no longer leaks into citation text.

---

## [1.0.2] — Stable release

- Fixed `manifest.json` metadata and versioning.
- Added additional details in `README.md` for manual installation.

---

## [1.0.0] — Initial release

- Import any Wikipedia page as clean Markdown.
- Internal links converted to `[[wikilinks]]`, resolving to true page names.
- Equations converted to Obsidian $\LaTeX$ (`$...$` / `$$...$$`).
- Images imported as remote embeds.
- References captured as plaintext.
- Configurable destination (active note, current folder, vault root, set folder, new folder), note naming (automatic/manual), and overwrite behavior.
- Commands: import by title, and import matching the current note's title.

---

This project follows [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`, where new features bump the minor version and bug fixes bump the patch version.