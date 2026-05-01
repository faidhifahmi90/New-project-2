import { describe, expect, it } from "vitest";
import { mergeSurahs, parseSurahPayload } from "./quranData";

describe("parseSurahPayload", () => {
  it("accepts the app-native surah array schema", () => {
    const parsed = parseSurahPayload([
      {
        number: 1,
        name: "الفاتحة",
        englishName: "Al-Fatihah",
        verses: [{ ayah: 1, text: "بِسْمِ اللَّهِ" }],
      },
    ]);

    expect(parsed[0].number).toBe(1);
    expect(parsed[0].verses[0]).toEqual({ ayah: 1, text: "بِسْمِ اللَّهِ" });
  });

  it("accepts single-surah files with index/name/verse fields", () => {
    const parsed = parseSurahPayload({
      index: "002",
      name: "al-Baqarah",
      verse: {
        verse_2: "ذَٰلِكَ الْكِتَابُ",
        verse_0: "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ",
        verse_1: "الم",
      },
    });

    expect(parsed).toHaveLength(1);
    expect(parsed[0].number).toBe(2);
    expect(parsed[0].englishName).toBe("al-Baqarah");
    expect(parsed[0].verses.map((verse) => verse.ayah)).toEqual([1, 2, 3]);
    expect(parsed[0].verses.map((verse) => verse.sourceKey)).toEqual(["verse_0", "verse_1", "verse_2"]);
    expect(parsed[0].verses.map((verse) => verse.sourceIndex)).toEqual([0, 1, 2]);
    expect(parsed[0].verses[0].text).toBe("بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ");
  });

  it("merges uploaded surahs without dropping existing surahs", () => {
    const merged = mergeSurahs(
      [
        {
          number: 1,
          name: "الفاتحة",
          englishName: "Al-Fatihah",
          verses: [{ ayah: 1, text: "بِسْمِ اللَّهِ" }],
        },
      ],
      [
        {
          number: 2,
          name: "البقرة",
          englishName: "Al-Baqarah",
          verses: [{ ayah: 1, text: "الم" }],
        },
      ],
    );

    expect(merged.map((surah) => surah.number)).toEqual([1, 2]);
  });

  it("parses the pulled full corpus numbering from 1 through 114", async () => {
    const { readFile } = await import("node:fs/promises");
    const { existsSync } = await import("node:fs");
    const manifestPath = "public/corpus/manifest.json";

    if (!existsSync(manifestPath)) return;

    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      files: Array<{ path: string; number: number }>;
    };
    const parsed = [];

    for (const file of manifest.files) {
      const raw = JSON.parse(await readFile(`public${file.path}`, "utf8"));
      parsed.push(...parseSurahPayload(raw));
    }

    expect(parsed).toHaveLength(114);
    expect(parsed[0].number).toBe(1);
    expect(parsed[parsed.length - 1]?.number).toBe(114);
    expect(parsed[0].verses[0].ayah).toBe(1);
    expect(parsed[1].verses[0].ayah).toBe(1);
  });
});
