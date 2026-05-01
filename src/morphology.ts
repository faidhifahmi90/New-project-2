import type { QuranSurah } from "./quranData";
import type { WordUnit } from "./ingestion";

export type MorphSegment = {
  id: string;
  location: string;
  surahNumber: number;
  sourceAyah: number;
  wordNumber: number;
  segmentNumber: number;
  segmentText: string;
  pos: string;
  features: string[];
  root?: string;
  lemma?: string;
  verbForm?: string;
};

export type MorphWord = {
  id: string;
  surahNumber: number;
  ayah: number;
  sourceAyah: number;
  wordIndexInAyah: number;
  sourceWordNumber: number;
  wordText: string;
  roots: string[];
  lemmas: string[];
  pos: string[];
  segments: MorphSegment[];
};

export type RootNode = {
  id: string;
  root: string;
  frequency: number;
  wordCount: number;
  surahCount: number;
  ayahCount: number;
  lemmas: string[];
  words: string[];
  surahs: number[];
};

export type RootSurahEdge = {
  id: string;
  root: string;
  surahNumber: number;
  weight: number;
};

export type RootCooccurrence = {
  id: string;
  rootA: string;
  rootB: string;
  weight: number;
  ayahCount: number;
  surahs: number[];
  samples: Array<{
    surahNumber: number;
    ayah: number;
    roots: string[];
    words: string[];
  }>;
};

export type RootSimilarity = {
  id: string;
  rootA: string;
  rootB: string;
  score: number;
  sharedRoots: string[];
  samples: RootCooccurrence["samples"];
};

export type AyahRootVector = {
  id: string;
  surahNumber: number;
  ayah: number;
  roots: string[];
  rootCounts: Record<string, number>;
  words: string[];
};

export type MorphologyGraph = {
  words: MorphWord[];
  roots: RootNode[];
  rootSurahEdges: RootSurahEdge[];
  rootCooccurrences: RootCooccurrence[];
  rootSimilarities: RootSimilarity[];
  ayahVectors: AyahRootVector[];
  matchedWords: number;
  unmatchedWords: WordUnit[];
};

function parseFeatureValue(features: string[], key: string) {
  const match = features.find((feature) => feature.startsWith(`${key}:`));
  return match?.slice(key.length + 1);
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

export function parseMorphologyText(text: string): MorphSegment[] {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [location, segmentText, pos, featureBlob = ""] = line.split("\t");
      const [surahNumber, sourceAyah, wordNumber, segmentNumber] = location.split(":").map(Number);
      const features = featureBlob.split("|").filter(Boolean);

      return {
        id: location,
        location,
        surahNumber,
        sourceAyah,
        wordNumber,
        segmentNumber,
        segmentText,
        pos,
        features,
        root: parseFeatureValue(features, "ROOT"),
        lemma: parseFeatureValue(features, "LEM"),
        verbForm: parseFeatureValue(features, "VF"),
      };
    });
}

export function sourceAyahForVerse(surahs: QuranSurah[], surahNumber: number, ayah: number) {
  const verse = surahs.find((surah) => surah.number === surahNumber)?.verses.find((candidate) => candidate.ayah === ayah);
  return verse?.sourceIndex ?? ayah;
}

export function buildMorphologyGraph(words: WordUnit[], surahs: QuranSurah[], segments: MorphSegment[]): MorphologyGraph {
  const segmentMap = new Map<string, MorphSegment[]>();
  segments.forEach((segment) => {
    const key = `${segment.surahNumber}:${segment.sourceAyah}:${segment.wordNumber}`;
    const existing = segmentMap.get(key) ?? [];
    existing.push(segment);
    segmentMap.set(key, existing);
  });

  const morphWords: MorphWord[] = [];
  const unmatchedWords: WordUnit[] = [];

  words.forEach((word) => {
    const sourceAyah = sourceAyahForVerse(surahs, word.surahNumber, word.ayah);
    const sourceWordNumber = word.wordIndexInAyah + 1;
    const key = `${word.surahNumber}:${sourceAyah}:${sourceWordNumber}`;
    const wordSegments = [...(segmentMap.get(key) ?? [])].sort((a, b) => a.segmentNumber - b.segmentNumber);

    if (wordSegments.length === 0) {
      unmatchedWords.push(word);
      return;
    }

    morphWords.push({
      id: word.id,
      surahNumber: word.surahNumber,
      ayah: word.ayah,
      sourceAyah,
      wordIndexInAyah: word.wordIndexInAyah,
      sourceWordNumber,
      wordText: word.text,
      roots: [...new Set(wordSegments.map((segment) => segment.root).filter((root): root is string => Boolean(root)))],
      lemmas: [...new Set(wordSegments.map((segment) => segment.lemma).filter((lemma): lemma is string => Boolean(lemma)))],
      pos: [...new Set(wordSegments.map((segment) => segment.pos).filter(Boolean))],
      segments: wordSegments,
    });
  });

  const rootMap = new Map<string, RootNode>();
  const edgeMap = new Map<string, RootSurahEdge>();
  const ayahRootMap = new Map<string, MorphWord[]>();

  morphWords.forEach((word) => {
    const ayahKey = `${word.surahNumber}:${word.ayah}`;
    const ayahWords = ayahRootMap.get(ayahKey) ?? [];
    ayahWords.push(word);
    ayahRootMap.set(ayahKey, ayahWords);

    word.roots.forEach((root) => {
      const existing = rootMap.get(root) ?? {
        id: root,
        root,
        frequency: 0,
        wordCount: 0,
        surahCount: 0,
        ayahCount: 0,
        lemmas: [],
        words: [],
        surahs: [],
      };

      existing.frequency += word.segments.filter((segment) => segment.root === root).length;
      existing.wordCount += 1;
      if (!existing.words.includes(word.wordText)) existing.words.push(word.wordText);
      word.lemmas.forEach((lemma) => {
        if (!existing.lemmas.includes(lemma)) existing.lemmas.push(lemma);
      });
      if (!existing.surahs.includes(word.surahNumber)) existing.surahs.push(word.surahNumber);
      rootMap.set(root, existing);

      const edgeId = `${root}->${word.surahNumber}`;
      const edge = edgeMap.get(edgeId) ?? {
        id: edgeId,
        root,
        surahNumber: word.surahNumber,
        weight: 0,
      };
      edge.weight += 1;
      edgeMap.set(edgeId, edge);
    });
  });

  const cooccurrenceMap = new Map<string, RootCooccurrence>();
  const ayahVectors: AyahRootVector[] = [];
  ayahRootMap.forEach((ayahWords, ayahKey) => {
    const roots = [...new Set(ayahWords.flatMap((word) => word.roots))].sort((a, b) => a.localeCompare(b));
    const [surahNumber, ayah] = ayahKey.split(":").map(Number);
    const rootCounts: Record<string, number> = {};

    ayahWords.forEach((word) => {
      word.roots.forEach((root) => {
        rootCounts[root] = (rootCounts[root] ?? 0) + 1;
      });
    });

    ayahVectors.push({
      id: ayahKey,
      surahNumber,
      ayah,
      roots,
      rootCounts,
      words: ayahWords.map((word) => word.wordText),
    });

    if (roots.length < 2) return;

    for (let first = 0; first < roots.length; first += 1) {
      for (let second = first + 1; second < roots.length; second += 1) {
        const rootA = roots[first];
        const rootB = roots[second];
        const id = `${rootA}::${rootB}`;
        const existing = cooccurrenceMap.get(id) ?? {
          id,
          rootA,
          rootB,
          weight: 0,
          ayahCount: 0,
          surahs: [],
          samples: [],
        };

        existing.weight += 1;
        existing.ayahCount += 1;
        if (!existing.surahs.includes(surahNumber)) existing.surahs.push(surahNumber);
        if (existing.samples.length < 8) {
          existing.samples.push({
            surahNumber,
            ayah,
            roots,
            words: ayahWords
              .filter((word) => word.roots.includes(rootA) || word.roots.includes(rootB))
              .map((word) => word.wordText),
          });
        }
        cooccurrenceMap.set(id, existing);
      }
    }
  });

  const rootContextVectors = new Map<string, Record<string, number>>();
  cooccurrenceMap.forEach((pair) => {
    const aVector = rootContextVectors.get(pair.rootA) ?? {};
    const bVector = rootContextVectors.get(pair.rootB) ?? {};
    aVector[pair.rootB] = (aVector[pair.rootB] ?? 0) + pair.weight;
    bVector[pair.rootA] = (bVector[pair.rootA] ?? 0) + pair.weight;
    pair.surahs.forEach((surahNumber) => {
      aVector[`S:${surahNumber}`] = (aVector[`S:${surahNumber}`] ?? 0) + 0.2;
      bVector[`S:${surahNumber}`] = (bVector[`S:${surahNumber}`] ?? 0) + 0.2;
    });
    rootContextVectors.set(pair.rootA, aVector);
    rootContextVectors.set(pair.rootB, bVector);
  });

  const rankedRoots = [...rootMap.values()].sort((a, b) => b.wordCount - a.wordCount).slice(0, 420);
  const rootSimilarities: RootSimilarity[] = [];
  for (let first = 0; first < rankedRoots.length; first += 1) {
    for (let second = first + 1; second < rankedRoots.length; second += 1) {
      const rootA = rankedRoots[first].root;
      const rootB = rankedRoots[second].root;
      const vectorA = rootContextVectors.get(rootA) ?? {};
      const vectorB = rootContextVectors.get(rootB) ?? {};
      const score = cosine(vectorA, vectorB);
      if (score < 0.08) continue;

      const sharedRoots = Object.keys(vectorA)
        .filter((key) => !key.startsWith("S:") && vectorB[key])
        .sort((a, b) => (vectorB[b] ?? 0) + (vectorA[b] ?? 0) - ((vectorB[a] ?? 0) + (vectorA[a] ?? 0)))
        .slice(0, 8);
      const directPair =
        cooccurrenceMap.get(`${rootA}::${rootB}`) ??
        cooccurrenceMap.get(`${rootB}::${rootA}`);

      rootSimilarities.push({
        id: `${rootA}~~${rootB}`,
        rootA,
        rootB,
        score,
        sharedRoots,
        samples: directPair?.samples ?? [],
      });
    }
  }

  rootMap.forEach((root) => {
    const ayahRefs = new Set(
      morphWords
        .filter((word) => word.roots.includes(root.root))
        .map((word) => `${word.surahNumber}:${word.ayah}`),
    );
    root.ayahCount = ayahRefs.size;
    root.surahCount = root.surahs.length;
    root.lemmas.sort((a, b) => a.localeCompare(b));
    root.words = root.words.slice(0, 30);
    root.surahs.sort((a, b) => a - b);
  });

  return {
    words: morphWords,
    roots: [...rootMap.values()].sort((a, b) => b.wordCount - a.wordCount || a.root.localeCompare(b.root)),
    rootSurahEdges: [...edgeMap.values()].sort((a, b) => b.weight - a.weight || a.root.localeCompare(b.root)),
    rootCooccurrences: [...cooccurrenceMap.values()].sort(
      (a, b) => b.weight - a.weight || a.rootA.localeCompare(b.rootA) || a.rootB.localeCompare(b.rootB),
    ),
    rootSimilarities: rootSimilarities.sort((a, b) => b.score - a.score).slice(0, 800),
    ayahVectors: ayahVectors.sort((a, b) => a.surahNumber - b.surahNumber || a.ayah - b.ayah),
    matchedWords: morphWords.length,
    unmatchedWords,
  };
}
