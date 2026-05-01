import type { QuranSurah } from "./quranData";

export type AtomicKind = "letter" | "mark" | "space" | "punctuation" | "symbol";
export type TransitionKind = "intra_word" | "word_boundary" | "ayah_boundary" | "surah_boundary";

export type WordUnit = {
  id: string;
  text: string;
  codePoints: string[];
  absoluteWordIndex: number;
  surahNumber: number;
  surahName: string;
  wordIndexInSurah: number;
  ayah: number;
  wordIndexInAyah: number;
  startAbsoluteIndex: number;
  endAbsoluteIndex: number;
  startSurahIndex: number;
  endSurahIndex: number;
  startAyahIndex: number;
  endAyahIndex: number;
  utf16StartInAyah: number;
  utf16EndInAyah: number;
};

export type AtomicUnit = {
  id: string;
  char: string;
  codePoint: string;
  utf16: string;
  kind: AtomicKind;
  absoluteIndex: number;
  surahCharIndex: number;
  ayahCharIndex: number;
  utf16IndexInAyah: number;
  surahNumber: number;
  surahName: string;
  ayah: number;
  wordId: string | null;
  absoluteWordIndex: number | null;
  wordIndexInSurah: number | null;
  wordIndexInAyah: number | null;
  charIndexInWord: number | null;
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

export type PreservationAudit = {
  originalText: string;
  reconstructedText: string;
  exactMatch: boolean;
  perAyah: Array<{
    surahNumber: number;
    ayah: number;
    original: string;
    reconstructed: string;
    exactMatch: boolean;
  }>;
};

export type IngestionResult = {
  units: AtomicUnit[];
  words: WordUnit[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  similarityPairs: SimilarityPair[];
  matrix: Record<string, Record<string, number>>;
  preservation: PreservationAudit;
  stats: {
    surahs: number;
    ayat: number;
    words: number;
    atomicUnits: number;
    letters: number;
    marks: number;
    spaces: number;
    uniqueNodes: number;
    uniqueEdges: number;
    strongestEdge: GraphEdge | null;
    exactReconstruction: boolean;
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

function toUtf16Hex(char: string) {
  return Array.from({ length: char.length }, (_, index) =>
    char.charCodeAt(index).toString(16).toUpperCase().padStart(4, "0"),
  ).join(" ");
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
  if (from.wordId !== null && from.wordId === to.wordId) return "intra_word";
  return "word_boundary";
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

function reconstructAyah(units: AtomicUnit[], surahNumber: number, ayah: number) {
  return units
    .filter((unit) => unit.surahNumber === surahNumber && unit.ayah === ayah)
    .sort((a, b) => a.ayahCharIndex - b.ayahCharIndex)
    .map((unit) => unit.char)
    .join("");
}

export function ingestSurahs(surahs: QuranSurah[], windowSize = 2): IngestionResult {
  const units: AtomicUnit[] = [];
  const words: WordUnit[] = [];
  let absoluteIndex = 0;
  let absoluteWordIndex = 0;

  surahs.forEach((surah) => {
    let surahCharIndex = 0;
    let wordIndexInSurah = 0;

    surah.verses.forEach((verse) => {
      let ayahCharIndex = 0;
      let wordIndexInAyah = 0;
      const segments = verse.text.match(/\S+|\s+/gu) ?? [];
      let utf16Cursor = 0;

      segments.forEach((segment) => {
        const segmentChars = Array.from(segment);
        const isWhitespace = /^\s+$/u.test(segment);
        const wordId = isWhitespace ? null : `${surah.number}:${verse.ayah}:w${wordIndexInAyah}`;
        const wordStartAbsoluteIndex = absoluteIndex;
        const wordStartSurahIndex = surahCharIndex;
        const wordStartAyahIndex = ayahCharIndex;
        const utf16StartInAyah = utf16Cursor;

        if (!isWhitespace) {
          words.push({
            id: wordId!,
            text: segment,
            codePoints: segmentChars.map(toCodePoint),
            absoluteWordIndex,
            surahNumber: surah.number,
            surahName: surah.name,
            wordIndexInSurah,
            ayah: verse.ayah,
            wordIndexInAyah,
            startAbsoluteIndex: wordStartAbsoluteIndex,
            endAbsoluteIndex: wordStartAbsoluteIndex + segmentChars.length - 1,
            startSurahIndex: wordStartSurahIndex,
            endSurahIndex: wordStartSurahIndex + segmentChars.length - 1,
            startAyahIndex: wordStartAyahIndex,
            endAyahIndex: wordStartAyahIndex + segmentChars.length - 1,
            utf16StartInAyah,
            utf16EndInAyah: utf16StartInAyah + segment.length,
          });
        }

        segmentChars.forEach((char, charIndexInSegment) => {
          const kind = classify(char);
          units.push({
            id: `${surah.number}:${verse.ayah}:a${ayahCharIndex}:c${absoluteIndex}`,
            char,
            codePoint: toCodePoint(char),
            utf16: toUtf16Hex(char),
            kind,
            absoluteIndex,
            surahCharIndex,
            ayahCharIndex,
            utf16IndexInAyah: utf16Cursor,
            surahNumber: surah.number,
            surahName: surah.name,
            ayah: verse.ayah,
            wordId,
            absoluteWordIndex: isWhitespace ? null : absoluteWordIndex,
            wordIndexInSurah: isWhitespace ? null : wordIndexInSurah,
            wordIndexInAyah: isWhitespace ? null : wordIndexInAyah,
            charIndexInWord: isWhitespace ? null : charIndexInSegment,
            word: isWhitespace ? " " : segment,
          });

          absoluteIndex += 1;
          surahCharIndex += 1;
          ayahCharIndex += 1;
          utf16Cursor += char.length;
        });

        if (!isWhitespace) {
          absoluteWordIndex += 1;
          wordIndexInSurah += 1;
          wordIndexInAyah += 1;
        }
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

  const perAyah = surahs.flatMap((surah) =>
    surah.verses.map((verse) => {
      const reconstructed = reconstructAyah(units, surah.number, verse.ayah);
      return {
        surahNumber: surah.number,
        ayah: verse.ayah,
        original: verse.text,
        reconstructed,
        exactMatch: reconstructed === verse.text,
      };
    }),
  );
  const originalText = surahs.flatMap((surah) => surah.verses.map((verse) => verse.text)).join("");
  const reconstructedText = perAyah.map((ayah) => ayah.reconstructed).join("");
  const exactMatch = originalText === reconstructedText && perAyah.every((ayah) => ayah.exactMatch);
  const ayat = surahs.reduce((total, surah) => total + surah.verses.length, 0);

  return {
    units,
    words,
    nodes,
    edges,
    similarityPairs,
    matrix,
    preservation: {
      originalText,
      reconstructedText,
      exactMatch,
      perAyah,
    },
    stats: {
      surahs: surahs.length,
      ayat,
      words: words.length,
      atomicUnits: units.length,
      letters: units.filter((unit) => unit.kind === "letter").length,
      marks: units.filter((unit) => unit.kind === "mark").length,
      spaces: units.filter((unit) => unit.kind === "space").length,
      uniqueNodes: nodes.length,
      uniqueEdges: edges.length,
      strongestEdge: edges[0] ?? null,
      exactReconstruction: exactMatch,
    },
  };
}
