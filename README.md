# Research-based Learning Community

An Obsidian plugin for **research-based learning**: turn literature into a traceable reading chain —
domain → AI literature review → verified sources → skimming → deep-read cards → optional publishing.

中文简介：面向研究性学习的 Obsidian 插件。把「领域 → 文献综述 → 核验文献 → 略读 → 精读卡片」
做成一条可追溯的链路，并支持把学习成果改写成面向特定读者的科普图文。

## Features

- **Domain-level literature review** — AI drafts a structured review; candidates carry DOIs and are
  verified with Crossref before they can be added.
- **Literature workspace** — each paper gets its own folder: metadata, skim report, deep-read cards,
  optional PDF, all named consistently.
- **Deep-read card** — guided five-part card (quote, experience, Aha, inspiration, meaning) plus
  concept value and an executable action.
- **PDF full-text organizer** — OCR (DeepSeek OCR) turns a PDF into Markdown, repairs layout, and adds
  paragraph-level Chinese translation for English papers.
- **Poster generator** — writes a short post for a reader profile you define, draws an illustration with
  seedream, and composes a 1080×1440 poster locally.
- **Practice cards** — plan, daily-note progress log, step checkboxes and a summary, with a calendar and a today list in the sidebar.
- **Optional publishing** — push approved cards and posters to a self-hosted community server.

## Install

### Community plugins

Search for **Research-based Learning Community** in *Settings → Community plugins*.

### Manual

1. Download `main.js`, `manifest.json`, `styles.css` from the latest release.
2. Put them in `<vault>/.obsidian/plugins/research-learning-community/`.
3. Enable the plugin in *Settings → Community plugins*.

## Setup

| Setting | Purpose |
|---|---|
| AI endpoint / key / model | Any OpenAI-compatible chat endpoint. Used for reviews, cards, translation, posters. |
| Reader profiles | Name + free-form description; the poster/post generator adapts length and tone to it. |
| Image endpoint / key / model | Volcengine Ark seedream for poster illustrations (optional). |
| Sync server + device token | Optional; only needed if you publish cards to a community server. |

## Privacy

- AI calls go **directly from your machine** to the endpoint you configure; there is no middle server.
- The plugin only uploads:
  - the cards you explicitly publish,
  - the PDF you explicitly choose to OCR (to your own AI provider),
  - the poster you explicitly generate.
- Notes, drafts and unpublished cards never leave your vault.
- API keys are stored in the plugin's local `data.json` (plain text, local only).

## Data layout

```
领域/
└─ <domain>/
   ├─ 文献综述.md
   └─ 文献/<paper>/
      ├─ <paper>.md            metadata
      ├─ <paper>-略读.md        skim report
      ├─ <paper>-dr-xxxxxxx.md  deep-read card
      ├─ <paper>-全文.md        organized full text
      └─ assets/                figures and posters
```

## Status

Early but usable. The optional server component is not required for local use.

## License

MIT

## Build from source

```bash
pnpm install
pnpm build      # typecheck + bundle to main.js
```

Layout:

```
src/                 plugin source
packages/contract/   card & API schemas
packages/vault-core/ vault layout and rendering
```

`main.js` in the repository root is the built bundle, so the plugin can also be installed without building.
