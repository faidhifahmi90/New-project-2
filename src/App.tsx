import { useEffect, useMemo, useState } from "react";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
import {
  Braces,
  CheckCircle2,
  CloudDownload,
  CircleDot,
  Database,
  Download,
  FileUp,
  Grid2X2,
  ListOrdered,
  Network,
  RotateCcw,
  Rows3,
  Search,
  Sparkles,
} from "lucide-react";
import type { QuranSurah } from "./quranData";
import { mergeSurahs, parseSurahPayload, uthmaniSeed } from "./quranData";
import { ingestSurahs, type AtomicKind, type GraphNode } from "./ingestion";
import type { GraphEdge } from "./ingestion";
import {
  buildMorphologyGraph,
  parseMorphologyText,
  type MorphSegment,
  type MorphWord,
  type RootCooccurrence,
  type RootNode,
} from "./morphology";

type View = "network" | "stream" | "words" | "roots" | "cooccur" | "similarity" | "morphology" | "nodes" | "edges" | "vectors" | "audit";
type Scope = "surah" | "corpus";
type AnalysisScope = "selected" | "loaded";
type NetworkMode = "hubs" | "neighborhood";
const STORAGE_KEY = "quran-letter-graph:surahs";
const STORAGE_ENABLED_KEY = "quran-letter-graph:persist-source";
const STORAGE_VERSION_KEY = "quran-letter-graph:storage-version";
const STORAGE_VERSION = "light-startup-v1";
const BUNDLED_MANIFEST = "/corpus/manifest.json";
const MORPHOLOGY_TEXT_PATH = "/morphology/quran-morphology.txt";
const atomKinds: AtomicKind[] = ["letter", "mark", "space", "punctuation", "symbol"];

type CorpusManifest = {
  count: number;
  source: string;
  files: Array<{
    name: string;
    number: number;
    path: string;
  }>;
};

const tabs: Array<{ id: View; label: string; icon: typeof Network }> = [
  { id: "network", label: "Network", icon: Network },
  { id: "stream", label: "Atomic", icon: Rows3 },
  { id: "words", label: "Words", icon: ListOrdered },
  { id: "roots", label: "Roots", icon: Network },
  { id: "cooccur", label: "Cooccur", icon: Grid2X2 },
  { id: "similarity", label: "Similarity", icon: Sparkles },
  { id: "morphology", label: "Morphology", icon: Database },
  { id: "nodes", label: "Nodes", icon: CircleDot },
  { id: "edges", label: "Edges", icon: Grid2X2 },
  { id: "vectors", label: "Vectors", icon: Sparkles },
  { id: "audit", label: "Audit", icon: CheckCircle2 },
];

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function KindBadge({ kind }: { kind: string }) {
  return <span className={`badge ${kind}`}>{kind}</span>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function filterByAyahRange(surahs: QuranSurah[], from: string, to: string) {
  const start = Number(from);
  const end = Number(to);
  const hasStart = Number.isFinite(start) && from.trim() !== "";
  const hasEnd = Number.isFinite(end) && to.trim() !== "";

  if (!hasStart && !hasEnd) return surahs;

  return surahs
    .map((surah) => ({
      ...surah,
      verses: surah.verses.filter((verse) => {
        if (hasStart && verse.ayah < start) return false;
        if (hasEnd && verse.ayah > end) return false;
        return true;
      }),
    }))
    .filter((surah) => surah.verses.length > 0);
}

function displayChar(char: string) {
  return char === " " ? "␠" : char;
}

function cosineRecords(a: Record<string, number>, b: Record<string, number>) {
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

function NetworkView({
  nodes,
  edges,
  selected,
  setSelected,
  mode,
  topNodeLimit,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selected: string;
  setSelected: (char: string) => void;
  mode: NetworkMode;
  topNodeLimit: number;
}) {
  type LayoutNode = GraphNode & {
    centrality: number;
    radius: number;
    x?: number;
    y?: number;
  };
  type LayoutEdge = GraphEdge & {
    source: string | LayoutNode;
    target: string | LayoutNode;
  };

  const { layoutNodes, layoutEdges, maxEdge, maxCentrality } = useMemo(() => {
    const rankedNodes = [...nodes].sort(
      (a, b) => b.inWeight + b.outWeight - (a.inWeight + a.outWeight) || b.frequency - a.frequency,
    );
    const nodeById = new Map(rankedNodes.map((node) => [node.id, node]));
    let chosenIds = new Set<string>();

    if (mode === "neighborhood" && selected) {
      const neighborIds = edges
        .filter((edge) => edge.from === selected || edge.to === selected)
        .sort((a, b) => b.weight - a.weight)
        .flatMap((edge) => [edge.from, edge.to])
        .filter((id) => nodeById.has(id));

      chosenIds = new Set([selected, ...neighborIds]);
      chosenIds = new Set([...chosenIds].slice(0, topNodeLimit));
    } else {
      chosenIds = new Set(rankedNodes.slice(0, topNodeLimit).map((node) => node.id));
    }

    const chosenNodes = rankedNodes.filter((node) => chosenIds.has(node.id));
    const chosenEdges = edges
      .filter((edge) => chosenIds.has(edge.from) && chosenIds.has(edge.to))
      .slice(0, Math.max(20, topNodeLimit * 3));

    const largestCentrality = Math.max(...chosenNodes.map((node) => node.inWeight + node.outWeight), 1);
    const largestEdge = Math.max(...chosenEdges.map((edge) => edge.weight), 1);
    const graphNodes: LayoutNode[] = chosenNodes.map((node, index) => {
      const angle = (index / Math.max(chosenNodes.length, 1)) * Math.PI * 2;
      return {
        ...node,
        centrality: node.inWeight + node.outWeight,
        radius: 12 + ((node.inWeight + node.outWeight) / largestCentrality) * 25,
        x: 500 + Math.cos(angle) * 230,
        y: 300 + Math.sin(angle) * 190,
      };
    });
    const graphEdges: LayoutEdge[] = chosenEdges.map((edge) => ({
      ...edge,
      source: edge.from,
      target: edge.to,
    }));

    forceSimulation<LayoutNode>(graphNodes)
      .force(
        "link",
        forceLink<LayoutNode, LayoutEdge>(graphEdges)
          .id((node) => node.id)
          .distance((edge) => 210 - Math.min(edge.weight / largestEdge, 1) * 115)
          .strength(0.58),
      )
      .force("charge", forceManyBody<LayoutNode>().strength(-430))
      .force("collide", forceCollide<LayoutNode>().radius((node) => node.radius + 12))
      .force("center", forceCenter<LayoutNode>(500, 300))
      .stop()
      .tick(170);

    graphNodes.forEach((node) => {
      node.x = Math.max(56, Math.min(944, node.x ?? 500));
      node.y = Math.max(52, Math.min(548, node.y ?? 300));
    });

    return {
      layoutNodes: graphNodes,
      layoutEdges: graphEdges,
      maxEdge: largestEdge,
      maxCentrality: largestCentrality,
    };
  }, [edges, mode, nodes, selected, topNodeLimit]);

  const nodeById = new Map(layoutNodes.map((node) => [node.id, node]));
  const selectedEdges = layoutEdges.filter((edge) => edge.from === selected || edge.to === selected);

  return (
    <div className="network-stage">
      <svg className="network-svg" viewBox="0 0 1000 600" role="img" aria-label="Weighted letter transition graph">
        <defs>
          <marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>
        {layoutEdges.map((edge) => {
          const from = nodeById.get(edge.from);
          const to = nodeById.get(edge.to);
          if (!from || !to) return null;
          const selectedPath = edge.from === selected || edge.to === selected;
          const width = 1.1 + (edge.weight / maxEdge) * 7;
          return (
            <g
              key={edge.id}
              className={`network-edge ${selectedPath ? "active" : ""}`}
              onClick={() => setSelected(edge.from)}
            >
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                strokeWidth={width}
                markerEnd="url(#arrowhead)"
              />
              {edge.weight >= maxEdge * 0.45 ? (
                <text x={((from.x ?? 0) + (to.x ?? 0)) / 2} y={((from.y ?? 0) + (to.y ?? 0)) / 2 - 7}>
                  {edge.weight}
                </text>
              ) : null}
            </g>
          );
        })}
        {layoutNodes.map((node) => (
          <g
            key={node.id}
            className={`network-node ${node.kind} ${selected === node.char ? "active" : ""}`}
            transform={`translate(${node.x}, ${node.y})`}
            onClick={() => setSelected(node.char)}
          >
            <circle r={node.radius} />
            <text className="node-glyph" dy="0.35em" direction="rtl">
              {displayChar(node.char)}
            </text>
            <text className="node-weight" dy={node.radius + 14}>
              {Math.round((node.centrality / maxCentrality) * 100)}
            </text>
          </g>
        ))}
      </svg>
      <div className="network-summary">
        <span>{layoutNodes.length} nodes</span>
        <span>{layoutEdges.length} edges</span>
        <span>{selectedEdges.length} selected links</span>
      </div>
    </div>
  );
}

function RootNetworkView({
  roots,
  morphWords,
  selectedRoot,
  selectedWordId,
  setSelectedRoot,
  setSelectedWordId,
}: {
  roots: RootNode[];
  morphWords: MorphWord[];
  selectedRoot: string;
  selectedWordId: string;
  setSelectedRoot: (root: string) => void;
  setSelectedWordId: (wordId: string) => void;
}) {
  type RootLayoutNode = {
    id: string;
    label: string;
    type: "root" | "word" | "surah";
    weight: number;
    root?: string;
    wordId?: string;
    radius: number;
    x?: number;
    y?: number;
  };
  type RootLayoutEdge = {
    id: string;
    source: string | RootLayoutNode;
    target: string | RootLayoutNode;
    weight: number;
    type: "derives" | "appears";
  };

  const { layoutNodes, layoutEdges, maxWeight } = useMemo(() => {
    const chosenRoots = selectedRoot
      ? roots.filter((root) => root.root === selectedRoot)
      : roots.slice(0, 10);
    const chosenRootSet = new Set(chosenRoots.map((root) => root.root));
    const relevantWords = morphWords.filter((word) => word.roots.some((root) => chosenRootSet.has(root)));
    const wordFormCounts = new Map<string, { count: number; word: MorphWord; root: string }>();

    relevantWords.forEach((word) => {
      word.roots.filter((root) => chosenRootSet.has(root)).forEach((root) => {
        const key = `${root}:${word.wordText}`;
        const existing = wordFormCounts.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          wordFormCounts.set(key, { count: 1, word, root });
        }
      });
    });

    const chosenWordForms = [...wordFormCounts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, selectedRoot ? 34 : 24);
    const chosenSurahs = new Map<number, number>();

    relevantWords.forEach((word) => {
      if (selectedRoot && !word.roots.includes(selectedRoot)) return;
      chosenSurahs.set(word.surahNumber, (chosenSurahs.get(word.surahNumber) ?? 0) + 1);
    });

    const topSurahs = [...chosenSurahs.entries()].sort((a, b) => b[1] - a[1]).slice(0, selectedRoot ? 18 : 12);
    const largest = Math.max(
      ...chosenRoots.map((root) => root.wordCount),
      ...chosenWordForms.map(([, form]) => form.count),
      ...topSurahs.map(([, count]) => count),
      1,
    );

    const graphNodes: RootLayoutNode[] = [
      ...chosenRoots.map((root) => ({
        id: `root:${root.root}`,
        label: root.root,
        type: "root" as const,
        weight: root.wordCount,
        root: root.root,
        radius: 18 + (root.wordCount / largest) * 30,
      })),
      ...chosenWordForms.map(([key, form]) => ({
        id: `word:${key}`,
        label: form.word.wordText,
        type: "word" as const,
        weight: form.count,
        root: form.root,
        wordId: form.word.id,
        radius: 13 + (form.count / largest) * 24,
      })),
      ...topSurahs.map(([surahNumber, count]) => ({
        id: `surah:${surahNumber}`,
        label: `${surahNumber}`,
        type: "surah" as const,
        weight: count,
        radius: 12 + (count / largest) * 22,
      })),
    ];
    const nodeIds = new Set(graphNodes.map((node) => node.id));
    const graphEdges: RootLayoutEdge[] = [
      ...chosenWordForms.map(([key, form]) => ({
        id: `root:${form.root}->word:${key}`,
        source: `root:${form.root}`,
        target: `word:${key}`,
        weight: form.count,
        type: "derives" as const,
      })),
      ...topSurahs.flatMap(([surahNumber]) =>
        chosenWordForms
          .filter(([, form]) =>
            relevantWords.some(
              (word) =>
                word.surahNumber === surahNumber &&
                word.wordText === form.word.wordText &&
                word.roots.includes(form.root),
            ),
          )
          .slice(0, 12)
          .map(([key, form]) => ({
            id: `word:${key}->surah:${surahNumber}`,
            source: `word:${key}`,
            target: `surah:${surahNumber}`,
            weight: relevantWords.filter(
              (word) =>
                word.surahNumber === surahNumber &&
                word.wordText === form.word.wordText &&
                word.roots.includes(form.root),
            ).length,
            type: "appears" as const,
          })),
      ),
    ].filter((edge) => nodeIds.has(edge.source as string) && nodeIds.has(edge.target as string));

    forceSimulation<RootLayoutNode>(graphNodes)
      .force(
        "link",
        forceLink<RootLayoutNode, RootLayoutEdge>(graphEdges)
          .id((node) => node.id)
          .distance((edge) => (edge.type === "derives" ? 105 : 145))
          .strength(0.72),
      )
      .force("charge", forceManyBody<RootLayoutNode>().strength(-520))
      .force("collide", forceCollide<RootLayoutNode>().radius((node) => node.radius + 16))
      .force("center", forceCenter<RootLayoutNode>(500, 300))
      .stop()
      .tick(190);

    graphNodes.forEach((node) => {
      node.x = Math.max(60, Math.min(940, node.x ?? 500));
      node.y = Math.max(58, Math.min(542, node.y ?? 300));
    });

    return {
      layoutNodes: graphNodes,
      layoutEdges: graphEdges,
      maxWeight: largest,
    };
  }, [morphWords, roots, selectedRoot]);

  const nodeById = new Map(layoutNodes.map((node) => [node.id, node]));

  return (
    <div className="root-network-stage">
      <svg className="network-svg" viewBox="0 0 1000 600" role="img" aria-label="Root to word to surah network">
        {layoutEdges.map((edge) => {
          const source = nodeById.get(edge.source as string);
          const target = nodeById.get(edge.target as string);
          if (!source || !target) return null;
          return (
            <line
              key={edge.id}
              className={`root-edge ${edge.type}`}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              strokeWidth={1 + (edge.weight / maxWeight) * 7}
            />
          );
        })}
        {layoutNodes.map((node) => (
          <g
            key={node.id}
            className={`root-node ${node.type} ${selectedRoot && node.root === selectedRoot ? "active" : ""} ${selectedWordId && node.wordId === selectedWordId ? "selected-word" : ""}`}
            transform={`translate(${node.x}, ${node.y})`}
            onClick={() => {
              if (node.type === "root" && node.root) setSelectedRoot(selectedRoot === node.root ? "" : node.root);
              if (node.type === "word" && node.wordId) setSelectedWordId(node.wordId);
            }}
          >
            <circle r={node.radius} />
            <text className="node-glyph" dy="0.35em" direction="rtl">
              {node.label}
            </text>
            <text className="node-weight" dy={node.radius + 14}>
              {node.weight}
            </text>
          </g>
        ))}
      </svg>
      <div className="network-summary">
        <span>{layoutNodes.length} nodes</span>
        <span>{layoutEdges.length} links</span>
        <span>{selectedRoot || "top roots"}</span>
      </div>
    </div>
  );
}

function RootCooccurrenceView({
  pairs,
  selectedRoot,
  selectedPairId,
  setSelectedRoot,
  setSelectedPairId,
}: {
  pairs: RootCooccurrence[];
  selectedRoot: string;
  selectedPairId: string;
  setSelectedRoot: (root: string) => void;
  setSelectedPairId: (pairId: string) => void;
}) {
  type CoNode = {
    id: string;
    root: string;
    weight: number;
    radius: number;
    x?: number;
    y?: number;
  };
  type CoEdge = {
    id: string;
    source: string | CoNode;
    target: string | CoNode;
    weight: number;
  };

  const { nodes, edges, maxWeight } = useMemo(() => {
    const visiblePairs = (selectedRoot
      ? pairs.filter((pair) => pair.rootA === selectedRoot || pair.rootB === selectedRoot)
      : pairs
    ).slice(0, selectedRoot ? 60 : 90);
    const rootWeights = new Map<string, number>();

    visiblePairs.forEach((pair) => {
      rootWeights.set(pair.rootA, (rootWeights.get(pair.rootA) ?? 0) + pair.weight);
      rootWeights.set(pair.rootB, (rootWeights.get(pair.rootB) ?? 0) + pair.weight);
    });

    const largest = Math.max(...visiblePairs.map((pair) => pair.weight), ...rootWeights.values(), 1);
    const graphNodes: CoNode[] = [...rootWeights.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, selectedRoot ? 48 : 42)
      .map(([root, weight]) => ({
        id: root,
        root,
        weight,
        radius: 13 + (weight / largest) * 30,
      }));
    const nodeIds = new Set(graphNodes.map((node) => node.id));
    const graphEdges: CoEdge[] = visiblePairs
      .filter((pair) => nodeIds.has(pair.rootA) && nodeIds.has(pair.rootB))
      .map((pair) => ({
        id: pair.id,
        source: pair.rootA,
        target: pair.rootB,
        weight: pair.weight,
      }));

    forceSimulation<CoNode>(graphNodes)
      .force(
        "link",
        forceLink<CoNode, CoEdge>(graphEdges)
          .id((node) => node.id)
          .distance((edge) => 180 - Math.min(edge.weight / largest, 1) * 95)
          .strength(0.7),
      )
      .force("charge", forceManyBody<CoNode>().strength(-500))
      .force("collide", forceCollide<CoNode>().radius((node) => node.radius + 14))
      .force("center", forceCenter<CoNode>(500, 300))
      .stop()
      .tick(190);

    graphNodes.forEach((node) => {
      node.x = Math.max(58, Math.min(942, node.x ?? 500));
      node.y = Math.max(54, Math.min(546, node.y ?? 300));
    });

    return {
      nodes: graphNodes,
      edges: graphEdges,
      maxWeight: largest,
    };
  }, [pairs, selectedRoot]);

  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  return (
    <div className="cooccur-stage">
      <svg className="network-svg" viewBox="0 0 1000 600" role="img" aria-label="Root co-occurrence graph">
        {edges.map((edge) => {
          const source = nodeById.get(edge.source as string);
          const target = nodeById.get(edge.target as string);
          if (!source || !target) return null;
          return (
            <line
              key={edge.id}
              className={`cooccur-edge ${selectedPairId === edge.id ? "active" : ""}`}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              strokeWidth={1 + (edge.weight / maxWeight) * 8}
              onClick={() => setSelectedPairId(edge.id)}
            />
          );
        })}
        {nodes.map((node) => (
          <g
            key={node.id}
            className={`cooccur-node ${selectedRoot === node.root ? "active" : ""}`}
            transform={`translate(${node.x}, ${node.y})`}
            onClick={() => setSelectedRoot(selectedRoot === node.root ? "" : node.root)}
          >
            <circle r={node.radius} />
            <text className="node-glyph" dy="0.35em" direction="rtl">
              {node.root}
            </text>
            <text className="node-weight" dy={node.radius + 14}>
              {node.weight}
            </text>
          </g>
        ))}
      </svg>
      <div className="network-summary">
        <span>{nodes.length} roots</span>
        <span>{edges.length} pairs</span>
        <span>{selectedRoot || "top co-occurrences"}</span>
      </div>
    </div>
  );
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportPayload(surahs: QuranSurah[]) {
  downloadJson("quran-rasm-uthmani-source.json", surahs);
}

function exportAnalysis(
  surahs: QuranSurah[],
  graph: ReturnType<typeof ingestSurahs>,
  morphology: ReturnType<typeof buildMorphologyGraph>,
  scope: Scope,
) {
  const payload = {
    schema: "quran-letter-graph.analysis.v1",
    generatedAt: new Date().toISOString(),
    scope,
    source: surahs,
    preservation: graph.preservation,
    stats: graph.stats,
    words: graph.words,
    atoms: graph.units,
    nodes: graph.nodes,
    edges: graph.edges,
    matrix: graph.matrix,
    similarityPairs: graph.similarityPairs,
    morphology: {
      matchedWords: morphology.matchedWords,
      unmatchedWords: morphology.unmatchedWords,
      words: morphology.words,
      roots: morphology.roots,
      rootSurahEdges: morphology.rootSurahEdges,
      rootCooccurrences: morphology.rootCooccurrences,
      rootSimilarities: morphology.rootSimilarities,
      ayahVectors: morphology.ayahVectors,
    },
  };

  downloadJson("quran-rasm-uthmani-analysis.json", payload);
}

function exportEvidence(value: unknown) {
  downloadJson("quran-root-evidence.json", value);
}

function loadInitialSurahs() {
  try {
    if (window.localStorage.getItem(STORAGE_VERSION_KEY) !== STORAGE_VERSION) {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(STORAGE_ENABLED_KEY);
      window.localStorage.setItem(STORAGE_VERSION_KEY, STORAGE_VERSION);
    }
    if (window.localStorage.getItem(STORAGE_ENABLED_KEY) !== "true") return uthmaniSeed;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return uthmaniSeed;
    return mergeSurahs(uthmaniSeed, parseSurahPayload(JSON.parse(stored)));
  } catch {
    return uthmaniSeed;
  }
}

function resetStoredCorpus() {
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(STORAGE_ENABLED_KEY);
  window.localStorage.setItem(STORAGE_VERSION_KEY, STORAGE_VERSION);
  return uthmaniSeed;
}

export default function App() {
  const [surahs, setSurahs] = useState<QuranSurah[]>(loadInitialSurahs);
  const [selectedSurah, setSelectedSurah] = useState(1);
  const [scope, setScope] = useState<Scope>("surah");
  const [analysisScope, setAnalysisScope] = useState<AnalysisScope>("selected");
  const [view, setView] = useState<View>("network");
  const [query, setQuery] = useState("");
  const [selectedNode, setSelectedNode] = useState("ل");
  const [error, setError] = useState("");
  const [loadingCorpus, setLoadingCorpus] = useState(false);
  const [corpusStatus, setCorpusStatus] = useState("");
  const [loadingMorphology, setLoadingMorphology] = useState(false);
  const [morphologyStatus, setMorphologyStatus] = useState("");
  const [morphSegments, setMorphSegments] = useState<MorphSegment[]>([]);
  const [selectedRoot, setSelectedRoot] = useState("");
  const [selectedPairId, setSelectedPairId] = useState("");
  const [selectedMorphWordId, setSelectedMorphWordId] = useState("");
  const [selectedAyahId, setSelectedAyahId] = useState("");
  const [ayahFrom, setAyahFrom] = useState("");
  const [ayahTo, setAyahTo] = useState("");
  const [minEdgeWeight, setMinEdgeWeight] = useState(2);
  const [topNodeLimit, setTopNodeLimit] = useState(32);
  const [networkMode, setNetworkMode] = useState<NetworkMode>("hubs");
  const [enabledKinds, setEnabledKinds] = useState<Record<AtomicKind, boolean>>({
    letter: true,
    mark: true,
    space: false,
    punctuation: true,
    symbol: true,
  });

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_ENABLED_KEY) !== "true") return;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(surahs));
    } catch {
      setError("Corpus is loaded, but it is too large for browser local storage. Export it or reload with the cloud button.");
    }
  }, [surahs]);

  const activeSurahs = useMemo(
    () => (scope === "corpus" ? surahs : surahs.filter((surah) => surah.number === selectedSurah)),
    [scope, selectedSurah, surahs],
  );
  const scopedSurahs = useMemo(
    () => (analysisScope === "loaded" ? activeSurahs : surahs.filter((surah) => surah.number === selectedSurah)),
    [activeSurahs, analysisScope, selectedSurah, surahs],
  );
  const analysisSurahs = useMemo(
    () => filterByAyahRange(scopedSurahs, ayahFrom, ayahTo),
    [scopedSurahs, ayahFrom, ayahTo],
  );
  const graph = useMemo(() => ingestSurahs(analysisSurahs), [analysisSurahs]);
  const needsMorphRelations = ["roots", "cooccur", "similarity", "morphology"].includes(view);
  const needsMorphSimilarity = view === "similarity";
  const morphology = useMemo(
    () =>
      buildMorphologyGraph(graph.words, analysisSurahs, morphSegments, {
        includeRelations: needsMorphRelations,
        includeSimilarity: needsMorphSimilarity,
      }),
    [analysisSurahs, graph.words, morphSegments, needsMorphRelations, needsMorphSimilarity],
  );
  const visibleNodeIds = useMemo(
    () => new Set(graph.nodes.filter((node) => enabledKinds[node.kind]).map((node) => node.id)),
    [enabledKinds, graph.nodes],
  );
  const visibleNodes = useMemo(
    () => graph.nodes.filter((node) => visibleNodeIds.has(node.id)),
    [graph.nodes, visibleNodeIds],
  );
  const visibleEdges = useMemo(
    () =>
      graph.edges.filter(
        (edge) => edge.weight >= minEdgeWeight && visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to),
      ),
    [graph.edges, minEdgeWeight, visibleNodeIds],
  );
  const selected = graph.nodes.find((node) => node.char === selectedNode) ?? graph.nodes[0];
  const filteredUnits = graph.units.filter((unit) => {
    const value = query.trim();
    if (!enabledKinds[unit.kind]) return false;
    if (!value) return true;
    return (
      unit.char.includes(value) ||
      unit.word.includes(value) ||
      unit.codePoint.toLowerCase().includes(value.toLowerCase()) ||
      unit.id.toLowerCase().includes(value.toLowerCase())
    );
  });
  const filteredWords = graph.words.filter((word) => {
    const value = query.trim();
    return (
      !value ||
      word.text.includes(value) ||
      word.id.toLowerCase().includes(value.toLowerCase()) ||
      word.codePoints.some((codePoint) => codePoint.toLowerCase().includes(value.toLowerCase()))
    );
  });
  const filteredMorphWords = morphology.words.filter((word) => {
    const value = query.trim();
    const matchesRoot = !selectedRoot || word.roots.includes(selectedRoot);
    if (!matchesRoot) return false;
    if (!value) return true;
    return (
      word.wordText.includes(value) ||
      word.roots.some((root) => root.includes(value)) ||
      word.lemmas.some((lemma) => lemma.includes(value)) ||
      word.id.toLowerCase().includes(value.toLowerCase())
    );
  });
  const filteredRoots = morphology.roots.filter((root) => {
    const value = query.trim();
    return (
      !value ||
      root.root.includes(value) ||
      root.lemmas.some((lemma) => lemma.includes(value)) ||
      root.words.some((word) => word.includes(value))
    );
  });
  const filteredCooccurrences = morphology.rootCooccurrences.filter((pair) => {
    const value = query.trim();
    const matchesRoot = !selectedRoot || pair.rootA === selectedRoot || pair.rootB === selectedRoot;
    if (!matchesRoot) return false;
    if (!value) return true;
    return (
      pair.rootA.includes(value) ||
      pair.rootB.includes(value) ||
      pair.samples.some((sample) => sample.words.some((word) => word.includes(value)))
    );
  });
  const selectedPair =
    morphology.rootCooccurrences.find((pair) => pair.id === selectedPairId) ??
    filteredCooccurrences[0];
  const selectedAyahVector =
    morphology.ayahVectors.find((ayah) => ayah.id === selectedAyahId) ??
    morphology.ayahVectors[0];
  const similarAyahs = useMemo(() => {
    if (!selectedAyahVector) return [];

    return morphology.ayahVectors
      .filter((ayah) => ayah.id !== selectedAyahVector.id)
      .map((ayah) => ({
        ...ayah,
        score: cosineRecords(selectedAyahVector.rootCounts, ayah.rootCounts),
        sharedRoots: ayah.roots.filter((root) => selectedAyahVector.roots.includes(root)),
      }))
      .filter((ayah) => ayah.score > 0)
      .sort((a, b) => b.score - a.score || a.surahNumber - b.surahNumber || a.ayah - b.ayah)
      .slice(0, 120);
  }, [morphology.ayahVectors, selectedAyahVector]);
  const evidenceRoots = selectedPair ? [selectedPair.rootA, selectedPair.rootB] : selectedRoot ? [selectedRoot] : [];
  const evidenceItems = useMemo(() => {
    if (evidenceRoots.length === 0) return [];

    const ayahMap = new Map<
      string,
      {
        id: string;
        surahNumber: number;
        ayah: number;
        text: string;
        roots: string[];
        words: MorphWord[];
      }
    >();

    morphology.words.forEach((word) => {
      const matchedRoots = word.roots.filter((root) => evidenceRoots.includes(root));
      if (matchedRoots.length === 0) return;
      const key = `${word.surahNumber}:${word.ayah}`;
      const text =
        graph.preservation.perAyah.find(
          (candidate) => candidate.surahNumber === word.surahNumber && candidate.ayah === word.ayah,
        )?.original ?? "";
      const existing = ayahMap.get(key) ?? {
        id: key,
        surahNumber: word.surahNumber,
        ayah: word.ayah,
        text,
        roots: [],
        words: [],
      };

      matchedRoots.forEach((root) => {
        if (!existing.roots.includes(root)) existing.roots.push(root);
      });
      existing.words.push(word);
      ayahMap.set(key, existing);
    });

    return [...ayahMap.values()]
      .filter((item) => (evidenceRoots.length === 2 ? evidenceRoots.every((root) => item.roots.includes(root)) : true))
      .sort((a, b) => a.surahNumber - b.surahNumber || a.ayah - b.ayah)
      .slice(0, 80);
  }, [evidenceRoots, graph.preservation.perAyah, morphology.words]);
  const selectedMorphWord =
    morphology.words.find((word) => word.id === selectedMorphWordId) ??
    filteredMorphWords[0] ??
    morphology.words[0];
  const selectedWordAtoms = selectedMorphWord
    ? graph.units.filter((unit) => unit.wordId === selectedMorphWord.id)
    : [];

  async function handleUpload(file: File | null) {
    if (!file) return;
    try {
      const parsed = parseSurahPayload(JSON.parse(await file.text()));
      setSurahs((current) => mergeSurahs(current, parsed));
      setSelectedSurah(parsed[0]?.number ?? 1);
      setError("");
      setCorpusStatus(`Merged ${parsed.length} uploaded surah.`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to read JSON.");
    }
  }

  function handleReset() {
    const seed = resetStoredCorpus();
    setSurahs(seed);
    setSelectedSurah(seed[0]?.number ?? 1);
    setScope("surah");
    setError("");
    setCorpusStatus("Reset to seeded Al-Fatihah.");
  }

  function toggleKind(kind: AtomicKind) {
    setEnabledKinds((current) => ({
      ...current,
      [kind]: !current[kind],
    }));
  }

  function resetAnalysisFilters() {
    setAyahFrom("");
    setAyahTo("");
    setMinEdgeWeight(2);
    setTopNodeLimit(32);
    setNetworkMode("hubs");
    setSelectedRoot("");
    setSelectedPairId("");
    setSelectedMorphWordId("");
    setEnabledKinds({
      letter: true,
      mark: true,
      space: false,
      punctuation: true,
      symbol: true,
    });
  }

  async function loadBundledCorpus(options?: { silent?: boolean }) {
    setLoadingCorpus(true);
    setError("");
    if (!options?.silent) setCorpusStatus("Reading bundled corpus manifest...");

    try {
      const manifestResponse = await fetch(BUNDLED_MANIFEST);
      if (!manifestResponse.ok) {
        if (options?.silent) return;
        throw new Error(
          `Corpus manifest not found. Run "npm run pull:quran" first, then refresh the app.`,
        );
      }

      const manifest = (await manifestResponse.json()) as CorpusManifest;
      const orderedFiles = [...manifest.files].sort((a, b) => a.number - b.number);
      const parsedSurahs: QuranSurah[] = [];

      for (let index = 0; index < orderedFiles.length; index += 1) {
        const file = orderedFiles[index];
        if (!options?.silent) setCorpusStatus(`Loading ${file.name} (${index + 1}/${orderedFiles.length})...`);
        const response = await fetch(file.path);
        if (!response.ok) {
          throw new Error(`Unable to load ${file.name}: ${response.status} ${response.statusText}`);
        }
        parsedSurahs.push(...parseSurahPayload(await response.json()));
      }

      setSurahs((current) => mergeSurahs(current, parsedSurahs));
      setSelectedSurah(1);
      setScope("corpus");
      setAnalysisScope("selected");
      setCorpusStatus(
        options?.silent
          ? `Auto-loaded ${parsedSurahs.length} bundled surahs.`
          : `Loaded ${parsedSurahs.length} surahs from ${manifest.source}.`,
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load bundled corpus.");
      setCorpusStatus("");
    } finally {
      setLoadingCorpus(false);
    }
  }

  async function loadMorphology(options?: { silent?: boolean }) {
    setLoadingMorphology(true);
    setError("");
    if (!options?.silent) setMorphologyStatus("Loading morphology dataset...");

    try {
      const response = await fetch(MORPHOLOGY_TEXT_PATH);
      if (!response.ok) {
        if (options?.silent) return;
        throw new Error(`Morphology dataset not found. Run "npm run pull:morphology" first, then refresh the app.`);
      }
      const parsed = parseMorphologyText(await response.text());
      setMorphSegments(parsed);
      setMorphologyStatus(
        options?.silent
          ? `Auto-loaded ${parsed.length} morphology segments.`
          : `Loaded ${parsed.length} morphology segments.`,
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load morphology dataset.");
      setMorphologyStatus("");
    } finally {
      setLoadingMorphology(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Braces size={24} />
          <div>
            <h1>Quran Letter Graph</h1>
            <span>Rasm Uthmani ingestion</span>
          </div>
        </div>

        <label className="field">
          <span>Surah</span>
          <select value={selectedSurah} onChange={(event) => setSelectedSurah(Number(event.target.value))}>
            {surahs.map((surah) => (
              <option key={surah.number} value={surah.number}>
                {surah.number}. {surah.englishName}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Scope</span>
          <select value={scope} onChange={(event) => setScope(event.target.value as Scope)}>
            <option value="surah">Selected surah</option>
            <option value="corpus">Loaded corpus</option>
          </select>
        </label>

        <label className="field">
          <span>Analyze</span>
          <select value={analysisScope} onChange={(event) => setAnalysisScope(event.target.value as AnalysisScope)}>
            <option value="selected">Selected surah only</option>
            <option value="loaded">All loaded surahs</option>
          </select>
        </label>

        <section className="filter-panel">
          <div className="filter-heading">
            <strong>Query</strong>
            <button type="button" onClick={resetAnalysisFilters}>Reset</button>
          </div>

          <div className="range-row">
            <label>
              <span>Ayah from</span>
              <input value={ayahFrom} onChange={(event) => setAyahFrom(event.target.value)} inputMode="numeric" placeholder="Any" />
            </label>
            <label>
              <span>Ayah to</span>
              <input value={ayahTo} onChange={(event) => setAyahTo(event.target.value)} inputMode="numeric" placeholder="Any" />
            </label>
          </div>

          <label className="field">
            <span>Network mode</span>
            <select value={networkMode} onChange={(event) => setNetworkMode(event.target.value as NetworkMode)}>
              <option value="hubs">Global hubs</option>
              <option value="neighborhood">Selected neighborhood</option>
            </select>
          </label>

          <div className="range-row">
            <label>
              <span>Top nodes</span>
              <input
                value={topNodeLimit}
                min={8}
                max={80}
                type="number"
                onChange={(event) => setTopNodeLimit(Number(event.target.value))}
              />
            </label>
            <label>
              <span>Min edge</span>
              <input
                value={minEdgeWeight}
                min={1}
                type="number"
                onChange={(event) => setMinEdgeWeight(Number(event.target.value))}
              />
            </label>
          </div>

          <div className="kind-grid" aria-label="Atom kinds">
            {atomKinds.map((kind) => (
              <label key={kind}>
                <input type="checkbox" checked={enabledKinds[kind]} onChange={() => toggleKind(kind)} />
                <span>{kind}</span>
              </label>
            ))}
          </div>
        </section>

        <div className="tool-row">
          <label className="icon-button" title="Import surah JSON">
            <FileUp size={18} />
            <input type="file" accept="application/json,.json" onChange={(event) => handleUpload(event.target.files?.[0] ?? null)} />
          </label>
          <button className="icon-button" title="Export current ingestion payload" onClick={() => exportPayload(surahs)}>
            <Download size={18} />
          </button>
          <button className="icon-button" title="Export full analysis" onClick={() => exportAnalysis(analysisSurahs, graph, morphology, scope)}>
            <Database size={18} />
          </button>
          <button className="icon-button" title="Load full pulled corpus" onClick={() => loadBundledCorpus()} disabled={loadingCorpus}>
            <CloudDownload size={18} />
          </button>
          <button className="icon-button" title="Load morphology dataset" onClick={() => loadMorphology()} disabled={loadingMorphology}>
            <Sparkles size={18} />
          </button>
          <button className="icon-button" title="Reset corpus" onClick={handleReset}>
            <RotateCcw size={18} />
          </button>
        </div>

        {error ? <div className="error">{error}</div> : null}
        {corpusStatus ? <div className="status">{corpusStatus}</div> : null}
        {morphologyStatus ? <div className="status">{morphologyStatus}</div> : null}
        {analysisScope === "loaded" ? (
          <div className="status">Full loaded-corpus analysis is heavier. Switch Analyze back to selected surah for faster browsing.</div>
        ) : null}

        <div className="metrics-grid">
          <Metric label="Surahs" value={graph.stats.surahs} />
          <Metric label="Ayat" value={graph.stats.ayat} />
          <Metric label="Words" value={graph.stats.words} />
          <Metric label="Atoms" value={graph.stats.atomicUnits} />
          <Metric label="Letters" value={graph.stats.letters} />
          <Metric label="Marks" value={graph.stats.marks} />
          <Metric label="Nodes" value={visibleNodes.length} />
          <Metric label="Edges" value={visibleEdges.length} />
          <Metric label="Roots" value={morphology.roots.length} />
          <Metric label="Morph" value={morphology.matchedWords} />
          <Metric label="Pairs" value={morphology.rootCooccurrences.length} />
          <Metric label="Similar" value={morphology.rootSimilarities.length} />
          <Metric label="Exact" value={graph.stats.exactReconstruction ? "Yes" : "No"} />
        </div>

        {selected ? (
          <div className="node-detail">
            <div className="detail-glyph" dir="rtl">
              {selected.kind === "space" ? "␠" : selected.char}
            </div>
            <div>
              <span>{selected.codePoint}</span>
              <strong>{selected.frequency} occurrences</strong>
              <KindBadge kind={selected.kind} />
            </div>
            <dl>
              <dt>In</dt>
              <dd>{selected.inWeight}</dd>
              <dt>Out</dt>
              <dd>{selected.outWeight}</dd>
              <dt>First</dt>
              <dd>{selected.firstSeen}</dd>
            </dl>
          </div>
        ) : null}

        {selectedMorphWord ? (
          <div className="word-detail">
            <div className="detail-label">Word Inspector</div>
            <div className="detail-word" dir="rtl">{selectedMorphWord.wordText}</div>
            <dl>
              <dt>Ref</dt>
              <dd>{selectedMorphWord.surahNumber}:{selectedMorphWord.ayah}:{selectedMorphWord.wordIndexInAyah + 1}</dd>
              <dt>Root</dt>
              <dd dir="rtl">{selectedMorphWord.roots.join("، ") || "—"}</dd>
              <dt>Lemma</dt>
              <dd dir="rtl">{selectedMorphWord.lemmas.join("، ") || "—"}</dd>
            </dl>
            <div className="segment-stack">
              {selectedMorphWord.segments.map((segment) => (
                <button
                  key={segment.id}
                  type="button"
                  onClick={() => segment.root && setSelectedRoot(segment.root)}
                  title={segment.features.join(" | ")}
                >
                  <b dir="rtl">{segment.segmentText}</b>
                  <span>{segment.pos}</span>
                  {segment.root ? <small dir="rtl">{segment.root}</small> : null}
                </button>
              ))}
            </div>
            <div className="atom-strip">
              {selectedWordAtoms.map((unit) => (
                <span key={unit.id} className={unit.kind} title={`${unit.codePoint} · ${unit.kind}`} dir="rtl">
                  {displayChar(unit.char)}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {evidenceRoots.length > 0 ? (
          <div className="evidence-panel">
            <div className="evidence-head">
              <div>
                <div className="detail-label">Evidence</div>
                <strong dir="rtl">{evidenceRoots.join(" + ")}</strong>
              </div>
              <button
                type="button"
                onClick={() =>
                  exportEvidence({
                    roots: evidenceRoots,
                    pair: selectedPair,
                    ayahs: evidenceItems,
                  })
                }
              >
                Export
              </button>
            </div>
            <div className="evidence-list">
              {evidenceItems.slice(0, 10).map((item) => (
                <article key={item.id}>
                  <header>
                    <button type="button" onClick={() => setSelectedAyahId(item.id)}>
                      {item.surahNumber}:{item.ayah}
                    </button>
                    <small dir="rtl">{item.roots.join("، ")}</small>
                  </header>
                  <p dir="rtl">{item.text}</p>
                  <div className="evidence-words">
                    {item.words.slice(0, 10).map((word) => (
                      <button
                        key={word.id}
                        type="button"
                        onClick={() => setSelectedMorphWordId(word.id)}
                        dir="rtl"
                      >
                        {word.wordText}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null}
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="surah-title" dir="rtl">
            <h2>{analysisScope === "loaded" ? "المصحف" : analysisSurahs[0]?.name}</h2>
            <span>
              {analysisScope === "loaded"
                ? `${analysisSurahs.length} surah in active analysis`
                : `${surahs.length} loaded · analyzing ${analysisSurahs[0]?.englishName ?? "selected surah"}`}
            </span>
          </div>
          <div className="search">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter atoms" />
          </div>
        </header>

        <nav className="tabs" aria-label="Analysis views">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} className={view === tab.id ? "active" : ""} onClick={() => setView(tab.id)}>
                <Icon size={17} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="content-grid">
          <section className="analysis-output" aria-label="Selected analysis output">

          {view === "network" ? (
            <section className="analysis-panel">
              <NetworkView
                nodes={visibleNodes}
                edges={visibleEdges}
                selected={selected?.char ?? ""}
                setSelected={setSelectedNode}
                mode={networkMode}
                topNodeLimit={topNodeLimit}
              />
              <div className="edge-list">
                {visibleEdges.slice(0, 12).map((edge) => (
                  <button key={edge.id} onClick={() => setSelectedNode(edge.from)}>
                    <span dir="rtl">{displayChar(edge.sourceChar)}</span>
                    <small>→</small>
                    <span dir="rtl">{displayChar(edge.targetChar)}</span>
                    <strong>{edge.weight}</strong>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {view === "stream" ? (
            <section className="table-panel">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Atom</th>
                    <th>Code</th>
                    <th>UTF-16</th>
                    <th>Kind</th>
                    <th>Surah Pos</th>
                    <th>Ayah Pos</th>
                    <th>Ayah</th>
                    <th>Word Pos</th>
                    <th>Word</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUnits.slice(0, 220).map((unit) => (
                    <tr key={unit.id}>
                      <td>{unit.absoluteIndex}</td>
                      <td dir="rtl">{unit.kind === "space" ? "␠" : unit.char}</td>
                      <td>{unit.codePoint}</td>
                      <td>{unit.utf16}</td>
                      <td><KindBadge kind={unit.kind} /></td>
                      <td>{unit.surahCharIndex}</td>
                      <td>{unit.ayahCharIndex}</td>
                      <td>{unit.surahNumber}:{unit.ayah}</td>
                      <td>{unit.charIndexInWord ?? "boundary"}</td>
                      <td dir="rtl">{unit.word}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {view === "words" ? (
            <section className="table-panel">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Word</th>
                    <th>ID</th>
                    <th>Ayah</th>
                    <th>Word Pos</th>
                    <th>Atom Range</th>
                    <th>Ayah Range</th>
                    <th>Codepoints</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredWords.slice(0, 220).map((word) => (
                    <tr key={word.id}>
                      <td>{word.absoluteWordIndex}</td>
                      <td dir="rtl">{word.text}</td>
                      <td>{word.id}</td>
                      <td>{word.surahNumber}:{word.ayah}</td>
                      <td>{word.wordIndexInAyah}</td>
                      <td>{word.startAbsoluteIndex}-{word.endAbsoluteIndex}</td>
                      <td>{word.startAyahIndex}-{word.endAyahIndex}</td>
                      <td>{word.codePoints.join(" ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {view === "roots" ? (
            <section className="root-workspace">
              {filteredRoots.length ? (
                <RootNetworkView
                  roots={filteredRoots}
                  morphWords={filteredMorphWords}
                  selectedRoot={selectedRoot}
                  selectedWordId={selectedMorphWord?.id ?? ""}
                  setSelectedRoot={(root) => {
                    setSelectedRoot(root);
                    setSelectedPairId("");
                  }}
                  setSelectedWordId={setSelectedMorphWordId}
                />
              ) : (
                <EmptyState
                  title="No roots to show"
                  body="Load morphology with the sparkle button, or clear the search/root filters."
                />
              )}
              <div className="table-panel embedded-table">
                <table>
                  <thead>
                    <tr>
                      <th>Root</th>
                      <th>Words</th>
                      <th>Segments</th>
                      <th>Surahs</th>
                      <th>Ayat</th>
                      <th>Lemmas</th>
                      <th>Forms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRoots.slice(0, 180).map((root) => (
                      <tr
                        key={root.id}
                        onClick={() => {
                          setSelectedRoot(selectedRoot === root.root ? "" : root.root);
                          setSelectedPairId("");
                        }}
                      >
                        <td dir="rtl">{root.root}</td>
                        <td>{root.wordCount}</td>
                        <td>{root.frequency}</td>
                        <td>{root.surahCount}</td>
                        <td>{root.ayahCount}</td>
                        <td dir="rtl">{root.lemmas.slice(0, 8).join("، ")}</td>
                        <td dir="rtl">{root.words.slice(0, 8).join("، ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {view === "cooccur" ? (
            <section className="root-workspace">
              {filteredCooccurrences.length ? (
                <RootCooccurrenceView
                  pairs={filteredCooccurrences}
                  selectedRoot={selectedRoot}
                  selectedPairId={selectedPairId}
                  setSelectedRoot={(root) => {
                    setSelectedRoot(root);
                    setSelectedPairId("");
                  }}
                  setSelectedPairId={setSelectedPairId}
                />
              ) : (
                <EmptyState
                  title="No co-occurrences to show"
                  body="Load morphology, choose a wider ayah range, or clear the selected root/search filter."
                />
              )}
              <div className="table-panel embedded-table">
                <table>
                  <thead>
                    <tr>
                      <th>Root A</th>
                      <th>Root B</th>
                      <th>Weight</th>
                      <th>Ayat</th>
                      <th>Surahs</th>
                      <th>Sample</th>
                      <th>Words</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCooccurrences.slice(0, 240).map((pair) => (
                      <tr
                        key={pair.id}
                        className={selectedPairId === pair.id ? "selected-row" : ""}
                        onClick={() => {
                          setSelectedPairId(pair.id);
                          setSelectedRoot(selectedRoot === pair.rootA ? pair.rootB : pair.rootA);
                        }}
                      >
                        <td dir="rtl">{pair.rootA}</td>
                        <td dir="rtl">{pair.rootB}</td>
                        <td>{pair.weight}</td>
                        <td>{pair.ayahCount}</td>
                        <td>{pair.surahs.slice(0, 12).join(", ")}</td>
                        <td>{pair.samples[0]?.surahNumber}:{pair.samples[0]?.ayah}</td>
                        <td dir="rtl">{pair.samples[0]?.words.slice(0, 8).join("، ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {view === "similarity" ? (
            <section className="similarity-workspace">
              <div className="similarity-panel">
                <header>
                  <div>
                    <h3>Root Similarity</h3>
                    <span>Cosine similarity from co-occurrence context</span>
                  </div>
                  {selectedRoot ? <b dir="rtl">{selectedRoot}</b> : null}
                </header>
                {morphology.rootSimilarities.length ? (
                <div className="table-panel embedded-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Root A</th>
                        <th>Root B</th>
                        <th>Score</th>
                        <th>Shared Context</th>
                        <th>Sample</th>
                      </tr>
                    </thead>
                    <tbody>
                      {morphology.rootSimilarities
                        .filter((pair) => !selectedRoot || pair.rootA === selectedRoot || pair.rootB === selectedRoot)
                        .filter((pair) => {
                          const value = query.trim();
                          return !value || pair.rootA.includes(value) || pair.rootB.includes(value) || pair.sharedRoots.some((root) => root.includes(value));
                        })
                        .slice(0, 220)
                        .map((pair) => (
                          <tr
                            key={pair.id}
                            onClick={() => {
                              setSelectedRoot(selectedRoot === pair.rootA ? pair.rootB : pair.rootA);
                              setSelectedPairId("");
                            }}
                          >
                            <td dir="rtl">{pair.rootA}</td>
                            <td dir="rtl">{pair.rootB}</td>
                            <td>{pair.score.toFixed(3)}</td>
                            <td dir="rtl">{pair.sharedRoots.slice(0, 8).join("، ")}</td>
                            <td>{pair.samples[0] ? `${pair.samples[0].surahNumber}:${pair.samples[0].ayah}` : "context only"}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                ) : (
                  <EmptyState
                    title="No root similarities yet"
                    body="Load morphology first. If it is already loaded, clear filters or use a larger corpus scope."
                  />
                )}
              </div>

              <div className="similarity-panel">
                <header>
                  <div>
                    <h3>Similar Ayahs</h3>
                    <span>Ayah vectors built from roots inside each ayah</span>
                  </div>
                  {selectedAyahVector ? <b>{selectedAyahVector.surahNumber}:{selectedAyahVector.ayah}</b> : null}
                </header>
                {similarAyahs.length ? (
                <div className="table-panel embedded-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Ayah</th>
                        <th>Score</th>
                        <th>Shared Roots</th>
                        <th>Words</th>
                        <th>Text</th>
                      </tr>
                    </thead>
                    <tbody>
                      {similarAyahs.map((ayah) => {
                        const text =
                          graph.preservation.perAyah.find(
                            (candidate) => candidate.surahNumber === ayah.surahNumber && candidate.ayah === ayah.ayah,
                          )?.original ?? "";
                        return (
                          <tr key={ayah.id} onClick={() => setSelectedAyahId(ayah.id)}>
                            <td>{ayah.surahNumber}:{ayah.ayah}</td>
                            <td>{ayah.score.toFixed(3)}</td>
                            <td dir="rtl">{ayah.sharedRoots.slice(0, 10).join("، ")}</td>
                            <td dir="rtl">{ayah.words.slice(0, 8).join("، ")}</td>
                            <td dir="rtl">{text}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                ) : (
                  <EmptyState
                    title="No similar ayahs yet"
                    body="Load morphology and select an ayah from the Evidence panel or Similarity table."
                  />
                )}
              </div>
            </section>
          ) : null}

          {view === "morphology" ? (
            <section className="table-panel">
              <table>
                <thead>
                  <tr>
                    <th>Word</th>
                    <th>Ref</th>
                    <th>Root</th>
                    <th>Lemma</th>
                    <th>POS</th>
                    <th>Segments</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMorphWords.slice(0, 320).map((word) => (
                    <tr
                      key={word.id}
                      className={selectedMorphWord?.id === word.id ? "selected-row" : ""}
                      onClick={() => {
                        setSelectedMorphWordId(word.id);
                        if (word.roots[0]) setSelectedRoot(word.roots[0]);
                        setSelectedPairId("");
                      }}
                    >
                      <td dir="rtl">{word.wordText}</td>
                      <td>{word.surahNumber}:{word.ayah}:{word.wordIndexInAyah + 1}</td>
                      <td dir="rtl">{word.roots.join("، ") || "—"}</td>
                      <td dir="rtl">{word.lemmas.join("، ") || "—"}</td>
                      <td>{word.pos.join(", ")}</td>
                      <td dir="rtl">{word.segments.map((segment) => segment.segmentText).join(" + ")}</td>
                      <td>{word.surahNumber}:{word.sourceAyah}:{word.sourceWordNumber}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {view === "nodes" ? (
            <section className="table-panel">
              <table>
                <thead>
                  <tr>
                    <th>Node</th>
                    <th>Code</th>
                    <th>Kind</th>
                    <th>Freq</th>
                    <th>Centrality</th>
                    <th>Verses</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleNodes.map((node) => (
                    <tr key={node.id} onClick={() => setSelectedNode(node.char)}>
                      <td dir="rtl">{displayChar(node.char)}</td>
                      <td>{node.codePoint}</td>
                      <td><KindBadge kind={node.kind} /></td>
                      <td>{node.frequency}</td>
                      <td>{node.inWeight + node.outWeight}</td>
                      <td>{node.verses.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {view === "edges" ? (
            <section className="table-panel">
              <table>
                <thead>
                  <tr>
                    <th>From</th>
                    <th>To</th>
                    <th>Weight</th>
                    <th>Intra</th>
                    <th>Boundary</th>
                    <th>Sample</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEdges.slice(0, 240).map((edge) => (
                    <tr key={edge.id}>
                      <td dir="rtl">{displayChar(edge.sourceChar)}</td>
                      <td dir="rtl">{displayChar(edge.targetChar)}</td>
                      <td>{edge.weight}</td>
                      <td>{edge.kinds.intra_word}</td>
                      <td>{edge.kinds.word_boundary + edge.kinds.ayah_boundary + edge.kinds.surah_boundary}</td>
                      <td dir="rtl">{edge.occurrences[0]?.word}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {view === "vectors" ? (
            <section className="table-panel">
              <table>
                <thead>
                  <tr>
                    <th>A</th>
                    <th>B</th>
                    <th>Cosine</th>
                  </tr>
                </thead>
                <tbody>
                  {graph.similarityPairs.slice(0, 160).map((pair) => (
                    <tr key={`${pair.from}-${pair.to}`}>
                      <td dir="rtl">{pair.fromChar === " " ? "␠" : pair.fromChar}</td>
                      <td dir="rtl">{pair.toChar === " " ? "␠" : pair.toChar}</td>
                      <td>{pair.score.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {view === "audit" ? (
            <section className="table-panel">
              <table>
                <thead>
                  <tr>
                    <th>Ayah</th>
                    <th>Status</th>
                    <th>Original</th>
                    <th>Reconstructed</th>
                  </tr>
                </thead>
                <tbody>
                  {graph.preservation.perAyah.map((ayah) => (
                    <tr key={`${ayah.surahNumber}:${ayah.ayah}`}>
                      <td>{ayah.surahNumber}:{ayah.ayah}</td>
                      <td><span className={`audit-status ${ayah.exactMatch ? "pass" : "fail"}`}>{ayah.exactMatch ? "exact" : "mismatch"}</span></td>
                      <td dir="rtl">{ayah.original}</td>
                      <td dir="rtl">{ayah.reconstructed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
          </section>

          <section className="text-panel">
            <div className="source-header">
              <div>
                <strong>Source Text</strong>
                <span>{graph.stats.ayat} ayat in current query · scroll here for full text</span>
              </div>
            </div>
            <div className="source-scroll">
              {analysisSurahs.map((surah) => (
                <div className="surah-block" key={surah.number}>
                  {analysisScope === "loaded" ? <h3 dir="rtl">{surah.name}</h3> : null}
                  {surah.verses.map((verse) => (
                    <p key={`${surah.number}:${verse.ayah}`} dir="rtl">
                      <span>{verse.text}</span>
                      <b>{surah.number}:{verse.ayah}</b>
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
