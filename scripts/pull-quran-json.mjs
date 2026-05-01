import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const owner = "sarfraznawaz2005";
const repo = "quran-json";
const branch = "master";
const directory = "surah";
const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${directory}?ref=${branch}`;
const outputDir = path.resolve("public", "corpus");

function surahNumber(name) {
  return Number(name.match(/^surah_(\d+)\.json$/u)?.[1] ?? Number.POSITIVE_INFINITY);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "quran-letter-graph-local-puller",
    },
  });

  if (!response.ok) {
    throw new Error(`Unable to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

const entries = await fetchJson(apiUrl);
const surahFiles = entries
  .filter((entry) => /^surah_\d+\.json$/u.test(entry.name))
  .sort((a, b) => surahNumber(a.name) - surahNumber(b.name));

await mkdir(outputDir, { recursive: true });

const manifest = {
  schema: "quran-letter-graph.github-corpus.v1",
  source: `https://github.com/${owner}/${repo}/tree/${branch}/${directory}`,
  apiUrl,
  branch,
  pulledAt: new Date().toISOString(),
  count: surahFiles.length,
  files: [],
};

for (const file of surahFiles) {
  const response = await fetch(file.download_url);
  if (!response.ok) {
    throw new Error(`Unable to download ${file.name}: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  JSON.parse(text);
  await writeFile(path.join(outputDir, file.name), text);
  manifest.files.push({
    name: file.name,
    number: surahNumber(file.name),
    sha: file.sha,
    size: file.size,
    path: `/corpus/${file.name}`,
    sourceUrl: file.html_url,
    downloadUrl: file.download_url,
  });
  process.stdout.write(`Pulled ${file.name}\n`);
}

await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`Done. Pulled ${manifest.count} surah files into ${outputDir}\n`);
