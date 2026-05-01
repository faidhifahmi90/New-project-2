import { describe, expect, it } from "vitest";
import { ingestSurahs } from "./ingestion";
import { buildMorphologyGraph, parseMorphologyText } from "./morphology";
import { uthmaniSeed } from "./quranData";

const sample = `1:1:1:1\tبِ\tP\tP|PREF|LEM:ب
1:1:1:2\tسْمِ\tN\tROOT:سمو|LEM:اسْم|M|GEN
1:1:2:1\tٱللَّهِ\tN\tPN|ROOT:أله|LEM:اللَّه|GEN
1:1:3:1\tٱل\tP\tDET|PREF|LEM:ال
1:1:3:2\tرَّحْمَٰنِ\tN\tROOT:رحم|LEM:رَحْمٰن|MS|GEN|ADJ
1:1:4:1\tٱل\tP\tDET|PREF|LEM:ال
1:1:4:2\tرَّحِيمِ\tN\tROOT:رحم|LEM:رَحِيم|MS|GEN|ADJ`;

describe("morphology", () => {
  it("parses morphology rows with root and lemma features", () => {
    const segments = parseMorphologyText(sample);

    expect(segments).toHaveLength(7);
    expect(segments[1].root).toBe("سمو");
    expect(segments[1].lemma).toBe("اسْم");
    expect(segments[4].root).toBe("رحم");
  });

  it("builds word to root to surah relationships", () => {
    const graph = ingestSurahs(uthmaniSeed);
    const morphology = buildMorphologyGraph(graph.words, uthmaniSeed, parseMorphologyText(sample));
    const mercyRoot = morphology.roots.find((root) => root.root === "رحم");

    expect(morphology.matchedWords).toBe(4);
    expect(mercyRoot?.wordCount).toBe(2);
    expect(mercyRoot?.surahs).toEqual([1]);
    expect(morphology.words.find((word) => word.wordText.includes("رَّحْم"))?.roots).toContain("رحم");
  });

  it("builds root co-occurrence pairs by shared ayah", () => {
    const graph = ingestSurahs(uthmaniSeed);
    const morphology = buildMorphologyGraph(graph.words, uthmaniSeed, parseMorphologyText(sample));
    const pair = morphology.rootCooccurrences.find(
      (cooccurrence) =>
        [cooccurrence.rootA, cooccurrence.rootB].includes("أله") &&
        [cooccurrence.rootA, cooccurrence.rootB].includes("رحم"),
    );

    expect(pair?.weight).toBe(1);
    expect(pair?.samples[0]).toMatchObject({ surahNumber: 1, ayah: 1 });
  });

  it("builds root similarity and ayah root vectors", () => {
    const graph = ingestSurahs(uthmaniSeed);
    const morphology = buildMorphologyGraph(graph.words, uthmaniSeed, parseMorphologyText(sample));

    expect(morphology.ayahVectors[0]).toMatchObject({ id: "1:1", surahNumber: 1, ayah: 1 });
    expect(morphology.ayahVectors[0].roots).toEqual(["أله", "رحم", "سمو"]);
    expect(morphology.rootSimilarities.length).toBeGreaterThan(0);
  });

  it("joins pulled corpus and pulled morphology by source position when available", async () => {
    const { existsSync } = await import("node:fs");
    const { readFile } = await import("node:fs/promises");

    if (!existsSync("public/corpus/surah_1.json") || !existsSync("public/morphology/quran-morphology.txt")) return;

    const { parseSurahPayload } = await import("./quranData");
    const rawSurah = JSON.parse(await readFile("public/corpus/surah_1.json", "utf8"));
    const surahs = parseSurahPayload(rawSurah);
    const graph = ingestSurahs(surahs);
    const morphology = buildMorphologyGraph(
      graph.words,
      surahs,
      parseMorphologyText(await readFile("public/morphology/quran-morphology.txt", "utf8")),
    );

    expect(morphology.matchedWords).toBe(graph.words.length);
    expect(morphology.roots.length).toBeGreaterThan(0);
    expect(morphology.rootCooccurrences.length).toBeGreaterThan(0);
  });
});
