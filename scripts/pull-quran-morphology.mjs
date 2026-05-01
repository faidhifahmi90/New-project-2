import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const files = [
  {
    name: "quran-morphology.txt",
    url: "https://raw.githubusercontent.com/mustafa0x/quran-morphology/master/quran-morphology.txt",
  },
  {
    name: "morphology-terms-ar.json",
    url: "https://raw.githubusercontent.com/mustafa0x/quran-morphology/master/morphology-terms-ar.json",
  },
];
const outputDir = path.resolve("public", "morphology");

await mkdir(outputDir, { recursive: true });

for (const file of files) {
  const response = await fetch(file.url);
  if (!response.ok) {
    throw new Error(`Unable to download ${file.name}: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  if (file.name.endsWith(".json")) JSON.parse(text);
  await writeFile(path.join(outputDir, file.name), text);
  process.stdout.write(`Pulled ${file.name}\n`);
}

const manifest = {
  schema: "quran-letter-graph.morphology.v1",
  source: "https://github.com/mustafa0x/quran-morphology",
  pulledAt: new Date().toISOString(),
  files: files.map((file) => ({
    name: file.name,
    path: `/morphology/${file.name}`,
    downloadUrl: file.url,
  })),
};

await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`Done. Pulled morphology files into ${outputDir}\n`);
