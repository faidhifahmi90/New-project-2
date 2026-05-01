# Quran Letter Graph

A local web interface for atomic, letter-level ingestion of Rasm Uthmani Quran text.

## Run

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm test
npm run build
```

## Pull Full Quran JSON Corpus

This project can pull the surah JSON files from:

https://github.com/sarfraznawaz2005/quran-json/tree/master/surah

Run:

```bash
npm run pull:quran
```

This downloads all `surah_*.json` files into `public/corpus/` and writes `public/corpus/manifest.json`. In the app, click the cloud download button to merge the full pulled corpus into the current browser corpus.

## Pull Morphology Dataset

The morphology layer uses:

https://github.com/mustafa0x/quran-morphology

Run:

```bash
npm run pull:morphology
```

This downloads `quran-morphology.txt` and `morphology-terms-ar.json` into `public/morphology/`. In the app, click the sparkle button to load morphology. The parser reads rows keyed by `surah:ayah:word:segment`, extracts segment POS, `ROOT`, `LEM`, and verb-form features, then joins them to preserved word records.

When the bundled corpus or morphology files exist locally, the app also attempts to auto-load them on startup. The cloud and sparkle buttons remain available for manual reloads.

## Ingestion JSON

The app accepts an array of surahs:

```json
[
  {
    "number": 1,
    "name": "الفاتحة",
    "englishName": "Al-Fatihah",
    "verses": [
      { "ayah": 1, "text": "بِسْمِ ٱللَّهِ ..." }
    ]
  }
]
```

The ingestion process preserves every Unicode codepoint, including Arabic combining marks and spaces, then derives nodes, weighted directed transitions, and local context vectors from that atomic stream.

## Preservation Contract

The graph is derived from a lossless source layer. Each atomic unit stores:

- exact character
- Unicode code point
- UTF-16 unit value
- absolute corpus position
- surah-local position
- ayah-local position
- word id and word-local position when the atom belongs to a word

Each word is also stored as a first-class unit with its exact text, codepoint list, absolute word index, ayah word index, and atom ranges. The Audit view reconstructs every ayah from the atom stream and reports whether it is an exact match.

## Interface

- Network: weighted character transition graph
- Atomic: every preserved atom and its exact positions
- Words: every preserved word and its atom range
- Roots: root frequency, linked lemmas, word forms, ayah count, and surah count
- Cooccur: root pairs that occur in the same ayah, with sample references
- Similarity: root similarity by co-occurrence context and ayah similarity by root vectors
- Morphology: preserved word records joined to segment-level root and lemma annotations
- Nodes: unique character/node metrics
- Edges: directed transition counts
- Vectors: local context similarity between characters
- Audit: source-vs-reconstruction verification

The browser keeps the imported corpus in local storage. Use the reset button to return to the seeded Al-Fatihah data. The source export preserves the imported surah payload; the analysis export includes the full preservation layer, graph structures, transition matrix, vector similarity output, and morphology relationships when loaded.

The Roots view includes a root network: root nodes connect to word-form nodes, and word forms connect to surah nodes. Clicking a root narrows the morphology tables to that root; clicking a word form opens the Word Inspector, which shows its segments and preserved atom stream.

The Cooccur view builds root-pair edges when two roots appear in the same ayah. Edge thickness represents repeated co-occurrence. Selecting a root focuses the graph and table on that root's neighborhood.

The Similarity view builds root context vectors from co-occurring roots and surah presence, then ranks root pairs by cosine similarity. It also builds ayah vectors from roots inside each ayah; selecting an ayah in the Evidence panel or Similarity table updates the similar-ayah ranking.

## Evidence Panel

Selecting a root or co-occurrence pair opens an evidence panel in the sidebar. It shows the actual ayahs behind the relationship, the matched roots, involved word forms, and links each word back to the Word Inspector. The evidence export button downloads the current root/pair evidence as JSON.

## Query And Network Controls

The sidebar query controls narrow the analysis layer while preserving the loaded source corpus:

- Ayah from/to: limits the active analysis to an ayah range.
- Network mode: `Global hubs` shows the most central characters; `Selected neighborhood` shows transitions around the selected character.
- Top nodes: controls how many nodes can enter the network.
- Min edge: hides low-frequency transitions.
- Atom kinds: toggles letters, marks, spaces, punctuation, and symbols in the visible analysis.

In the network, node size represents total transition centrality, edge width represents transition frequency, arrows show direction, and large edge labels show the strongest transition counts.
