# 📚 Wikipedia Importer `1.1.0` is out!

**Turn any Wikipedia page into a clean, fully-linked Obsidian note — in one command.**

This is a big one. Three headline features, plus a pile of fixes.

---

**🔗 In-text citations that actually link**
Reference markers now appear in the body as real footnotes (`[^1]`) that jump straight to the source at the bottom — exactly like Wikipedia. Where a citation has a URL, the footnote carries an external `[source]` link too.

**🏷️ Automatic tagging**
Notes are now tagged from Wikipedia's own categories the moment they land, so your imports organize themselves. Put them in YAML frontmatter, inline `#tags`, or both. Add your own fixed tags, get prompted for tags per-import, or switch auto-tagging off entirely.

**⚙️ Link & image control**
Choose how internal links are written — `[[wikilinks]]` (build your graph), Markdown links (point to Wikipedia online, create no notes), or no links at all. Same for images: embed inline, link only, or skip them.

---

**Also new:** "Further reading" sections are preserved · mis-cased page titles now resolve via search · the `# Title` link and `source:` property are both toggleable · explanatory notes are separated from citations.

**Fixed:** maintenance banners ("This article needs additional citations") and fundraising notices are stripped · banner icons, license badges, and rendered equations no longer get grabbed as a note's lead image · `v · t · e` navigation controls no longer leak in as `[[Template talk:…]]` links · Wikipedia's stylesheet CSS no longer bleeds into citation text · sister-project links (Wiktionary, Commons, etc.) removed.

---

⚠️ **Upgrading?** The **Fixed tag** and **Your tags** settings have been merged into a single **Fixed tags** field. If you had a tag set there, re-enter it after updating.

📖 Full changelog: `<link to your CHANGELOG.md>`
🔧 Repo: `<link to your GitHub>`

Feedback and bug reports very welcome — thanks to everyone who filed issues on `1.0.2`, most of this release came straight from them. 🙏
