import { describe, expect, it } from "vitest";
import { ingestSurahs } from "./ingestion";
import { uthmaniSeed } from "./quranData";

describe("ingestSurahs", () => {
  it("reconstructs every ayah exactly from the atomic stream", () => {
    const graph = ingestSurahs(uthmaniSeed);

    expect(graph.preservation.exactMatch).toBe(true);
    expect(graph.stats.exactReconstruction).toBe(true);
    graph.preservation.perAyah.forEach((ayah) => {
      expect(ayah.reconstructed).toBe(ayah.original);
    });
  });

  it("preserves word ranges and atom positions", () => {
    const graph = ingestSurahs(uthmaniSeed);
    const firstWord = graph.words[0];
    const firstWordAtoms = graph.units.filter((unit) => unit.wordId === firstWord.id);

    expect(firstWord.text).toBe("بِسْمِ");
    expect(firstWordAtoms.map((unit) => unit.char).join("")).toBe(firstWord.text);
    expect(firstWord.startAbsoluteIndex).toBe(firstWordAtoms[0].absoluteIndex);
    expect(firstWord.endAbsoluteIndex).toBe(firstWordAtoms[firstWordAtoms.length - 1].absoluteIndex);
    expect(firstWordAtoms.every((unit, index) => unit.charIndexInWord === index)).toBe(true);
  });

  it("keeps spaces as atomic boundary units", () => {
    const graph = ingestSurahs(uthmaniSeed);
    const spaces = graph.units.filter((unit) => unit.kind === "space");

    expect(spaces.length).toBeGreaterThan(0);
    expect(spaces.every((unit) => unit.wordId === null)).toBe(true);
    expect(spaces.every((unit) => unit.char === " ")).toBe(true);
  });
});
