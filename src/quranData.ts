export type QuranVerse = {
  ayah: number;
  text: string;
  sourceKey?: string;
  sourceIndex?: number;
};

export type QuranSurah = {
  number: number;
  name: string;
  englishName: string;
  verses: QuranVerse[];
};

type LegacySurahPayload = {
  index?: string | number;
  name?: string;
  verse?: Record<string, string>;
};

export const uthmaniSeed: QuranSurah[] = [
  {
    number: 1,
    name: "الفاتحة",
    englishName: "Al-Fatihah",
    verses: [
      { ayah: 1, text: "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ" },
      { ayah: 2, text: "ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ" },
      { ayah: 3, text: "ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ" },
      { ayah: 4, text: "مَـٰلِكِ يَوْمِ ٱلدِّينِ" },
      { ayah: 5, text: "إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ" },
      { ayah: 6, text: "ٱهْدِنَا ٱلصِّرَٰطَ ٱلْمُسْتَقِيمَ" },
      {
        ayah: 7,
        text: "صِرَٰطَ ٱلَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ ٱلْمَغْضُوبِ عَلَيْهِمْ وَلَا ٱلضَّآلِّينَ",
      },
    ],
  },
];

export function mergeSurahs(existing: QuranSurah[], incoming: QuranSurah[]) {
  const byNumber = new Map<number, QuranSurah>();

  existing.forEach((surah) => {
    byNumber.set(surah.number, surah);
  });

  incoming.forEach((surah) => {
    byNumber.set(surah.number, surah);
  });

  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

export function parseSurahPayload(raw: unknown): QuranSurah[] {
  const payload = Array.isArray(raw) ? raw : [raw];

  return payload.map((surah, surahIndex) => {
    if (!surah || typeof surah !== "object") {
      throw new Error(`Surah at index ${surahIndex} is not an object.`);
    }

    const candidate = surah as Partial<QuranSurah> & LegacySurahPayload;
    const number = Number(candidate.number ?? candidate.index ?? surahIndex + 1);
    const name = String(candidate.name ?? `Surah ${number}`);
    const englishName = String(candidate.englishName ?? candidate.name ?? `Surah ${number}`);

    if (candidate.verse && typeof candidate.verse === "object" && !Array.isArray(candidate.verse)) {
      const verseEntries = Object.entries(candidate.verse)
        .map(([key, text]) => ({
          sourceKey: key,
          sourceIndex: Number(key.replace(/^\D+/u, "")),
          text: String(text ?? ""),
        }))
        .sort((a, b) => a.sourceIndex - b.sourceIndex);
      const offset = verseEntries[0]?.sourceIndex === 0 ? 1 : 0;

      return {
        number,
        name,
        englishName,
        verses: verseEntries.map((verse) => ({
          ayah: verse.sourceIndex + offset,
          sourceKey: verse.sourceKey,
          sourceIndex: verse.sourceIndex,
          text: verse.text,
        })),
      };
    }

    if (!Array.isArray(candidate.verses)) {
      throw new Error(
        `Surah at index ${surahIndex} is missing verses. Expected "verses" array or "verse" object.`,
      );
    }

    return {
      number,
      name,
      englishName,
      verses: candidate.verses.map((verse, verseIndex) => {
        if (!verse || typeof verse !== "object") {
          throw new Error(`Verse ${verseIndex + 1} in surah ${surahIndex + 1} is not an object.`);
        }

        const verseCandidate = verse as Partial<QuranVerse>;
        return {
          ayah: Number(verseCandidate.ayah ?? verseIndex + 1),
          text: String(verseCandidate.text ?? ""),
        };
      }),
    };
  });
}
