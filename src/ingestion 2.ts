import type { QuranSurah } from "./quranData";

export type AtomicKind = "letter" | "mark" | "space" | "punctuation" | "symbol";
export type TransitionKind = "intra_word" | "word_boundary" | "ayah_boundary" | "surah_boundary";

export type AtomicUnit = {
  id: string;
  char: string;
  codePoint: string;
  kind: AtomicKind;
  absoluteIndex: number;
  surahNumber: number;
  surahName: string;
  ayah: number;
  wordIndex: number;
  charIndexInWord: number;
  word: string;
};

export type GraphNode = {
  id: string;
  char: string;
  codePoint: string;
  kind: AtomicKind;
  frequency: number;
  inWeight: number;
  outWeight: number;
  firstSeen: number;
  verses: string[];
  examples: string[];
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  sourceChar: string;
  targetChar: string;
  weight: number;
  kinds: Record<TransitionKind, number>;
  occurrences: Array<{
    fromUnitId: string;
    toUnitId: string;
    surahNumber: number;
    ayah: number;
    fromIndex: number;
    toIndex: number;
    kind: TransitionKind;
    word: string;
  }>;
};

export type SimilarityPair = {
  from: string;
  to: string;
  fromChar: string;
  toChar: string;
  score: number;
};

export type IngestionResult = {
  units: AtomicUnit[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  similarityPairs: SimilarityPair[];
  matrix: Record<string, Record<string, number>>;
  stats: {
    surahs: number;
    ayat: number;
    atomicUnits: number;
    letters: number;
    marks: number;
    spaces: number;
    uniqueNodes: number;
    uniqueEdges: number;
    strongestEdge: GraphEdge | null;
  };
};

const ARABIC_MARK_RANGES = [
  [0x0610, 0x061a],
  [0x064b, 0x065f],
  [0x0670, 0x0670],
  [0x06d6, 0x06ed],
];

function toCodePoint(char: string) {
  return `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
}

function inRange(value: number, ranges: number[][]) {
  return ranges.some(([start, end]) => value >= start && value <= end);
}

function classify(char: string): AtomicKind {
  const point = char.codePointAt(0)!;
  if (/\s/u.test(char)) return "space";
  if (inRange(point, ARABIC_MARK_RANGES)) return "mark";
  if (/[\p{P}]/u.test(char)) return "punctuation";
  if (/[\p{L}]/u.test(char)) return "letter";
  return "symbol";
}

function transitionKind(from: AtomicUnit, to: AtomicUnit): TransitionKind {
  if (from.surahNumber !== to.surahNumber) return "surah_boundary";
  if (from.ayah !== to.ayah) return "ayah_boundary";
  if (from.wordIndex !== to.wordIndex) return "word_boundary";
  return "intra_word";
}

function cosine(a: Record<string, number>, b: Record<string, number>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;

  keys.forEach((key) => {
    const av = a[key] ?? 0;
    const bv = b[key] ?? 0;
    dot += av * bv;
    aNorm += av * av;
    bNorm += bv * bv;
  });

  if (aNorm === 0 || bNorm === 0) return 0;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

export function ingestSurahs(surahs: QuranSurah[], windowSize = 2): IngestionResult {
  const units: AtomicUnit[] = [];
  let absoluteIndex = 0;

  surahs.forEach((surah) => {
    surah.verses.forEach((verse) => {
      let wordIndex = 0;
      let charIndexInWord = 0;
      const chars = Array.from(verse.text);
      const wordsByCharIndex = new Map<number, string>();
      let cursor = 0;

      verse.text.split(/(\s+)/u).forEach((segment) => {
        const segmentChars = Array.from(segment);
        if (!/^\s+$/u.test(segment)) {
          segmentChars.forEach((_, localIndex) => {
            wordsByCharIndex.set(cursor + localIndex, segment);
          });
        }
        cursor += segmentChars.length;
      });

      chars.forEach((char, charIndexInVerse) => {
        const kind = classify(char);
        if (kind === "space") {
          wordIndex += 1;
          charIndexInWord = 0;
        }

        units.push({
          id: `${surah.number}:${verse.ayah}:${absoluteIndex}`,
          char,
          codePoint: toCodePoint(char),
          kind,
          absoluteIndex,
          surahNumber: surah.number,
          surahName: surah.name,
          ayah: verse.ayah,
          wordIndex,
          charIndexInWord,
          word: kind === "space" ? " " : wordsByCharIndex.get(charIndexInVerse) ?? char,
        });

        absoluteIndex += 1;
        if (kind !== "space") charIndexInWord += 1;
      });
    });
  });

  const nodeMap = new Map<string, GraphNode>();
  units.forEach((unit) => {
    const existing = nodeMap.get(unit.char);
    const verseRef = `${unit.surahNumber}:${unit.ayah}`;
    if (existing) {
      existing.frequency += 1;
      if (!existing.verses.includes(verseRef)) existing.verses.push(verseRef);
      if (unit.word.trim() && existing.examples.length < 5 && !existing.examples.includes(unit.word)) {
        existing.examples.push(unit.word);
      }
      return;
    }

    nodeMap.set(unit.char, {
      id: unit.char,
      char: unit.char,
      codePoint: unit.codePoint,
      kind: unit.kind,
      frequency: 1,
      inWeight: 0,
      outWeight: 0,
      firstSeen: unit.absoluteIndex,
      verses: [verseRef],
      examples: unit.word.trim() ? [unit.word] : [],
    });
  });

  const edgeMap = new Map<string, GraphEdge>();
  for (let index = 0; index < units.length - 1; index += 1) {
    const from = units[index];
    const to = units[index + 1];
    const kind = transitionKind(from, to);
    const edgeId = `${from.char}->${to.char}`;
    const existing = edgeMap.get(edgeId);

    const occurrence = {
      fromUnitId: from.id,
      toUnitId: to.id,
      surahNumber: from.surahNumber,
      ayah: from.ayah,
      fromIndex: from.absoluteIndex,
      toIndex: to.absoluteIndex,
      kind,
      word: from.word,
    };

    if (existing) {
      existing.weight += 1;
      existing.kinds[kind] += 1;
      if (existing.occurrences.length < 40) existing.occurrences.push(occurrence);
    } else {
      edgeMap.set(edgeId, {
        id: edgeId,
        from: from.char,
        to: to.char,
        sourceChar: from.char,
        targetChar: to.char,
        weight: 1,
        kinds: {
          intra_word: kind === "intra_word" ? 1 : 0,
          word_boundary: kind === "word_boundary" ? 1 : 0,
          ayah_boundary: kind === "ayah_boundary" ? 1 : 0,
          surah_boundary: kind === "surah_boundary" ? 1 : 0,
        },
        occurrences: [occurrence],
      });
    }
  }

  edgeMap.forEach((edge) => {
    nodeMap.get(edge.from)!.outWeight += edge.weight;
    nodeMap.get(edge.to)!.inWeight += edge.weight;
  });

  const vectors: Record<string, Record<string, number>> = {};
  units.forEach((unit, index) => {
    vectors[unit.char] ??= {};
    for (let offset = -windowSize; offset <= windowSize; offset += 1) {
      if (offset === 0) continue;
      const neighbor = units[index + offset];
      if (!neighbor) continue;
      const key = `${offset < 0 ? "L" : "R"}${Math.abs(offset)}:${neighbor.char}`;
      vectors[unit.char][key] = (vectors[unit.char][key] ?? 0) + 1 / Math.abs(offset);
    }
  });

  const matrix: Record<string, Record<string, number>> = {};
  edgeMap.forEach((edge) => {
    matrix[edge.from] ??= {};
    matrix[edge.from][edge.to] = edge.weight;
  });

  const nodes = [...nodeMap.values()].sort((a, b) => b.frequency - a.frequency || a.firstSeen - b.firstSeen);
  const edges = [...edgeMap.values()].sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  const similarityPairs: SimilarityPair[] = [];

  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const score = cosine(vectors[nodes[i].char] ?? {}, vectors[nodes[j].char] ?? {});
      if (score > 0) {
        similarityPairs.push({
          from: nodes[i].id,
          to: nodes[j].id,
          fromChar: nodes[i].char,
          toChar: nodes[j].char,
          score,
        });
      }
    }
  }

  similarityPairs.sort((a, b) => b.score - a.score);

  const ayat = surahs.reduce((total, surah) => total + surah.verses.length, 0);
  return {
    units,
    nodes,
    edges,
    similarityPairs,
    matrix,
    stats: {
      surahs: surahs.length,
      ayat,
      atomicUnits: units.length,
      letters: units.filter((unit) => unit.kind === "letter").length,
      marks: units.filter((unit) => unit.kind === "mark").length,
      spaces: units.filter((unit) => unit.kind === "space").length,
      uniqueNodes: nodes.length,
      uniqueEdges: edges.length,
      strongestEdge: edges[0] ?? null,
    },
  };
}
