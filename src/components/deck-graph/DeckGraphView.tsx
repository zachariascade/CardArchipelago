import { Fragment, useMemo, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import { Brain, Eye, EyeOff, Minus, RotateCcw, ZoomIn } from "lucide-react";
import { AnalysisResult } from "../../analysis/analysisSchema";
import { getCardById } from "../../deck/deckQueries";
import { DeckSnapshot, getImageUri, getPrimaryTypeLine } from "../../deck/deckModel";
import {
  DeckGraph,
  DeckGraphEdge,
  DeckGraphNode,
  DeckGraphNodeKind,
  describeGraphNode,
  getConnectedGraphItems,
} from "../../deck/deckGraph";
import type { HoverPreviewHandlers } from "../../app/App";
import { GraphConnections } from "./GraphConnections";

type PositionedNode = DeckGraphNode & {
  x: number;
  y: number;
};

type PanState = {
  x: number;
  y: number;
};

type DragState = {
  startClientX: number;
  startClientY: number;
  startPan: PanState;
};

type CardTypeSegment = {
  type: string;
  color: string;
};

type CardNodeStyle = {
  fill: string;
  segments: CardTypeSegment[];
  gradientId?: string;
};

const GRAPH_WORLD_WIDTH = 2000;
const GRAPH_WORLD_HEIGHT = 1333;
const GRAPH_WORLD_MARGIN = 140;
const DEFAULT_GRAPH_SPACING = 2.5;

const NODE_COLORS: Record<DeckGraphNodeKind, string> = {
  card: "#fffdf8",
  package: "#dcefe8",
  strategy: "#e9e2f4",
  resource: "#f7e4b7",
  risk: "#f4d0c9",
};

const NODE_STROKES: Record<DeckGraphNodeKind, string> = {
  card: "#b9b0a4",
  package: "#2c7568",
  strategy: "#7258a5",
  resource: "#a66b18",
  risk: "#a84d45",
};

const EDGE_COLORS: Record<DeckGraphEdge["kind"], string> = {
  supports: "#2c7568",
  enables: "#6b5aa8",
  pays_off: "#9a6a1d",
  protects: "#285d66",
  answers: "#49616a",
  depends_on: "#a66b18",
  weak_to: "#a84d45",
  belongs_to: "#9a9389",
};

const CARD_TYPE_ORDER = ["Land", "Creature", "Artifact", "Enchantment", "Planeswalker", "Battle", "Instant", "Sorcery"] as const;

type CardTypeName = (typeof CARD_TYPE_ORDER)[number] | "Other";

const CARD_TYPE_COLORS: Record<CardTypeName, string> = {
  Land: "#d8c095",
  Creature: "#cfe8d9",
  Artifact: "#d6d2c8",
  Enchantment: "#e5d8f0",
  Planeswalker: "#f1dc9f",
  Battle: "#efc2bc",
  Instant: "#cfe4f4",
  Sorcery: "#f0d2c2",
  Other: "#fffdf8",
};

export function DeckGraphView({
  deck,
  graph,
  selectedNodeId,
  hiddenNodeIds,
  isAnalyzing,
  latestAnalysis,
  title,
  className,
  showFocusToggle = true,
  connectionsPlacement = "inspector",
  onSelectNode,
  onOpenCard,
  onAnalyzeNode,
  onPromptAnalyzeNode,
  onHideNode,
  onDeleteEdge,
  onDeleteEdges,
  onCopyConnectionsJson,
  onDeleteConnectionsPatch,
  onResetHiddenNodes,
  hoverPreview,
  toolbarActions,
}: {
  deck: DeckSnapshot;
  graph: DeckGraph;
  selectedNodeId?: string;
  hiddenNodeIds: string[];
  isAnalyzing: boolean;
  latestAnalysis?: AnalysisResult;
  title?: string;
  className?: string;
  showFocusToggle?: boolean;
  connectionsPlacement?: "inspector" | "below-graph";
  onSelectNode: (nodeId: string) => void;
  onOpenCard: (cardId: string) => void;
  onAnalyzeNode?: (nodeId: string) => void;
  onPromptAnalyzeNode?: (nodeId: string, prompt: string) => void;
  onHideNode?: (nodeId: string) => void;
  onDeleteEdge?: (edgeId: string) => void;
  onDeleteEdges?: (edgeIds: string[], label?: string) => void;
  onCopyConnectionsJson?: () => void;
  onDeleteConnectionsPatch?: () => void;
  onResetHiddenNodes?: () => void;
  hoverPreview?: HoverPreviewHandlers;
  toolbarActions?: ReactNode;
}) {
  const [zoom, setZoom] = useState(1);
  const [spacing, setSpacing] = useState(DEFAULT_GRAPH_SPACING);
  const [pan, setPan] = useState<PanState>({ x: 0, y: 0 });
  const [dragState, setDragState] = useState<DragState>();
  const [focusSelectedOnly, setFocusSelectedOnly] = useState(false);
  const [analysisPrompt, setAnalysisPrompt] = useState("");
  const baseVisibleGraph = useMemo(() => getVisibleGraph(graph, new Set(hiddenNodeIds)), [graph, hiddenNodeIds]);
  const selectedNeighborhood = useMemo(() => {
    if (!selectedNodeId) return undefined;
    const connectedNodeIds = new Set<string>([selectedNodeId]);
    const connectedEdgeIds = new Set<string>();
    baseVisibleGraph.edges.forEach((edge) => {
      if (edge.sourceId !== selectedNodeId && edge.targetId !== selectedNodeId) return;
      connectedEdgeIds.add(edge.id);
      connectedNodeIds.add(edge.sourceId);
      connectedNodeIds.add(edge.targetId);
    });
    return { connectedNodeIds, connectedEdgeIds };
  }, [selectedNodeId, baseVisibleGraph.edges]);
  const visibleGraph = useMemo(
    () => (focusSelectedOnly && selectedNeighborhood ? filterGraphToNodeIds(baseVisibleGraph, selectedNeighborhood.connectedNodeIds) : baseVisibleGraph),
    [baseVisibleGraph, focusSelectedOnly, selectedNeighborhood],
  );
  const nodes = useMemo(
    () => layoutNodes(visibleGraph.nodes, visibleGraph.edges, spacing),
    [visibleGraph.nodes, visibleGraph.edges, spacing],
  );
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? nodes[0];
  const selectedConnections = selectedNode ? getConnectedGraphItems(visibleGraph, selectedNode.id) : { nodes: [], edges: [] };
  const visibleEdges = visibleGraph.edges.filter((edge) => nodeById.has(edge.sourceId) && nodeById.has(edge.targetId));
  const cardNodeStyles = useMemo(() => getCardNodeStyles(deck, nodes), [deck, nodes]);
  const cardTypeGradients = nodes
    .map((node) => ({ node, style: cardNodeStyles.get(node.id) }))
    .filter((item): item is { node: PositionedNode; style: CardNodeStyle } => Boolean(item.style?.gradientId));
  const viewBox = getZoomedViewBox(zoom, pan);
  const selectedConnectionsPanel = selectedNode ? (
    <GraphConnections
      deck={deck}
      nodes={selectedConnections.nodes}
      edges={selectedConnections.edges}
      selectedNodeId={selectedNode.id}
      onSelectNode={onSelectNode}
      onOpenCard={onOpenCard}
      onDeleteEdge={onDeleteEdge}
      onDeleteEdges={onDeleteEdges}
      onCopyConnectionsJson={onCopyConnectionsJson}
      onDeleteConnectionsPatch={onDeleteConnectionsPatch}
      hoverPreview={hoverPreview}
    />
  ) : null;

  function handleGraphPointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.target !== event.currentTarget) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPan: pan,
    });
  }

  function handleGraphPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!dragState) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const dx = ((event.clientX - dragState.startClientX) / Math.max(1, bounds.width)) * (GRAPH_WORLD_WIDTH / zoom);
    const dy = ((event.clientY - dragState.startClientY) / Math.max(1, bounds.height)) * (GRAPH_WORLD_HEIGHT / zoom);
    setPan({
      x: clampPan(dragState.startPan.x - dx),
      y: clampPan(dragState.startPan.y - dy),
    });
  }

  function handleGraphPointerUp(event: PointerEvent<SVGSVGElement>) {
    if (dragState) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragState(undefined);
  }

  return (
    <section className={`graph-workspace ${connectionsPlacement === "below-graph" ? "graph-workspace-connections-below" : ""} ${className ?? ""}`}>
      <div className="graph-toolbar">
        <div>
          <h2>{title ?? "Graph"}</h2>
          <p>
            {visibleGraph.nodes.length} of {graph.nodes.length} nodes and {visibleGraph.edges.length} of {graph.edges.length} relationships.
            {" "}
            {graph.procedureSummary}
          </p>
        </div>
        <div className="panel-actions">
          {showFocusToggle && selectedNode && (
            <button type="button" className="secondary-button" onClick={() => setFocusSelectedOnly((value) => !value)}>
              {focusSelectedOnly ? <Eye size={16} /> : <EyeOff size={16} />}
              {focusSelectedOnly ? "Show All" : "Focus"}
            </button>
          )}
          <label className="graph-spacing-control">
            <span>Spacing {spacing.toFixed(1)}x</span>
            <input type="range" min="0.8" max="4" step="0.1" value={spacing} onChange={(event) => setSpacing(Number(event.target.value))} />
          </label>
          {onResetHiddenNodes && (
            <button type="button" className="secondary-button" onClick={onResetHiddenNodes} disabled={hiddenNodeIds.length === 0}>
              <RotateCcw size={16} />
              Reset Hidden
            </button>
          )}
          {toolbarActions}
        </div>
      </div>

      <div className="graph-layout">
        <div className="graph-canvas-panel">
          <div className="graph-zoom-controls graph-zoom-overlay" aria-label="Graph zoom controls">
            <button type="button" className="icon-button" onClick={() => setZoom((value) => clampZoom(value - 0.15))} disabled={zoom <= 0.7} aria-label="Zoom out" title="Zoom out">
              <Minus size={16} />
            </button>
            <span className="graph-zoom-readout" aria-label={`Zoom ${Math.round(zoom * 100)} percent`}>
              {Math.round(zoom * 100)}%
            </span>
            <button type="button" className="icon-button" onClick={() => setZoom((value) => clampZoom(value + 0.15))} disabled={zoom >= 3} aria-label="Zoom in" title="Zoom in">
              <ZoomIn size={16} />
            </button>
          </div>
          <svg
            className={`deck-graph-svg ${dragState ? "is-panning" : ""}`}
            viewBox={viewBox}
            role="img"
            aria-label="Deck strategy network graph"
            onPointerDown={handleGraphPointerDown}
            onPointerMove={handleGraphPointerMove}
            onPointerUp={handleGraphPointerUp}
            onPointerCancel={handleGraphPointerUp}
          >
            <defs>
              {cardTypeGradients.map(({ style }) => (
                <linearGradient key={style.gradientId} id={style.gradientId} x1="0%" x2="100%" y1="0%" y2="0%">
                  {style.segments.map((segment, index) => {
                    const start = (index / style.segments.length) * 100;
                    const end = ((index + 1) / style.segments.length) * 100;
                    return (
                      <Fragment key={`${segment.type}-${index}`}>
                        <stop offset={`${start}%`} stopColor={segment.color} />
                        <stop offset={`${end}%`} stopColor={segment.color} />
                      </Fragment>
                    );
                  })}
                </linearGradient>
              ))}
            </defs>
            <g className="graph-edges">
              {visibleEdges.map((edge) => {
                const source = nodeById.get(edge.sourceId);
                const target = nodeById.get(edge.targetId);
                if (!source || !target) return null;
                const selected = Boolean(selectedNodeId && (edge.sourceId === selectedNodeId || edge.targetId === selectedNodeId));
                const connected = selectedNeighborhood?.connectedEdgeIds.has(edge.id) ?? false;
                return (
                  <line
                    key={edge.id}
                    className={`graph-edge ${connected ? "connected" : ""}`}
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke={EDGE_COLORS[edge.kind]}
                    strokeWidth={connected ? edge.strength + 1.8 : selected ? edge.strength + 1.2 : Math.max(1, edge.strength * 0.7)}
                    strokeOpacity={connected ? 0.86 : selected ? 0.72 : 0.22}
                    strokeDasharray={edge.kind === "weak_to" || edge.kind === "depends_on" ? "7 6" : undefined}
                  />
                );
              })}
            </g>
            <g className="graph-nodes">
              {nodes.map((node) => {
                const selected = node.id === selectedNodeId;
                const radius = nodeRadius(node);
                const cardNodeStyle = cardNodeStyles.get(node.id);
                const connected = selectedNeighborhood?.connectedNodeIds.has(node.id) ?? false;
                const muted = Boolean(selectedNeighborhood && !connected);
                return (
                  <g
                    key={node.id}
                    className={`graph-node graph-node-${node.kind} ${selected ? "selected" : ""} ${connected ? "connected" : ""} ${muted ? "muted" : ""}`}
                    transform={`translate(${node.x} ${node.y})`}
                    onClick={() => onSelectNode(node.id)}
                    onMouseEnter={(event) => node.cardId && hoverPreview?.show(node.cardId, event.currentTarget as unknown as HTMLElement)}
                    onMouseLeave={hoverPreview?.hide}
                    onFocus={(event) => node.cardId && hoverPreview?.show(node.cardId, event.currentTarget as unknown as HTMLElement)}
                    onBlur={hoverPreview?.hide}
                    tabIndex={0}
                    role="button"
                    aria-label={node.label}
                  >
                    <circle
                      r={radius}
                      fill={cardNodeStyle?.fill ?? NODE_COLORS[node.kind]}
                      stroke={NODE_STROKES[node.kind]}
                      strokeWidth={selected ? 4 : 2}
                    />
                    <text y={node.kind === "card" ? radius + 13 : 5} textAnchor="middle">
                      {trimLabel(node.label, node.kind === "card" ? 16 : 22)}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
          <div className="graph-legend" aria-label="Graph legend">
            {(["strategy", "package", "resource", "risk"] as DeckGraphNodeKind[]).map((kind) => (
              <span key={kind}>
                <i style={{ background: NODE_COLORS[kind], borderColor: NODE_STROKES[kind] }} />
                {kind}
              </span>
            ))}
            {CARD_TYPE_ORDER.map((type) => (
              <span key={type}>
                <i style={{ background: CARD_TYPE_COLORS[type], borderColor: NODE_STROKES.card }} />
                {type}
              </span>
            ))}
          </div>
        </div>

        <aside className="graph-inspector">
          {selectedNode ? (
            <>
              <div className="graph-inspector-heading">
                <span>{selectedNode.kind}</span>
                <h2>{selectedNode.label}</h2>
                <p>{describeGraphNode(selectedNode, visibleGraph)}</p>
              </div>

              {selectedNode.cardId && <GraphCardPreview deck={deck} cardId={selectedNode.cardId} onOpenCard={onOpenCard} />}

              {(onAnalyzeNode || onPromptAnalyzeNode || onHideNode) && (
                <div className="panel-actions">
                  {onAnalyzeNode && (
                    <button type="button" className="primary-button" onClick={() => onAnalyzeNode(selectedNode.id)} disabled={isAnalyzing}>
                      <Brain size={16} />
                      {isAnalyzing ? "Analyzing..." : "Analyze Node"}
                    </button>
                  )}
                  {onHideNode && (
                    <button type="button" className="secondary-button" onClick={() => onHideNode(selectedNode.id)}>
                      <EyeOff size={16} />
                      Hide
                    </button>
                  )}
                </div>
              )}

              {onPromptAnalyzeNode && selectedNode.cardId && (
                <div className="graph-prompt-panel">
                  <label htmlFor={`graph-prompt-${selectedNode.id}`}>
                    <span>Prompt</span>
                    <textarea
                      id={`graph-prompt-${selectedNode.id}`}
                      value={analysisPrompt}
                      onChange={(event) => setAnalysisPrompt(event.target.value)}
                      placeholder="Example: group every card that makes, copies, or rewards artifact tokens."
                      rows={4}
                    />
                  </label>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => onPromptAnalyzeNode(selectedNode.id, analysisPrompt)}
                    disabled={isAnalyzing || !analysisPrompt.trim()}
                  >
                    <Brain size={16} />
                    {isAnalyzing ? "Analyzing..." : "Analyze Prompt"}
                  </button>
                </div>
              )}

              {connectionsPlacement === "inspector" && selectedConnectionsPanel}

              {latestAnalysis && (
                <div className="graph-analysis-note">
                  <span>Latest Analysis</span>
                  <strong>{latestAnalysis.title}</strong>
                  <p>{latestAnalysis.summary ?? "Analysis saved to the Analysis tab history."}</p>
                </div>
              )}
            </>
          ) : (
            <div className="analysis-empty-state">No graph node is selected.</div>
          )}
        </aside>
      </div>

      {connectionsPlacement === "below-graph" && (
        <section className="graph-connections-panel">
          {selectedConnectionsPanel ?? <div className="analysis-empty-state">No graph node is selected.</div>}
        </section>
      )}
    </section>
  );
}

function GraphCardPreview({ deck, cardId, onOpenCard }: { deck: DeckSnapshot; cardId: string; onOpenCard: (cardId: string) => void }) {
  const card = getCardById(deck, cardId);
  if (!card) return null;
  return (
    <button type="button" className="graph-card-preview" onClick={() => onOpenCard(cardId)}>
      {getImageUri(card) ? <img src={getImageUri(card)} alt="" /> : <span>{card.name}</span>}
      <div>
        <strong>{card.name}</strong>
        <em>{getPrimaryTypeLine(card)}</em>
      </div>
    </button>
  );
}

function getCardNodeStyles(deck: DeckSnapshot, nodes: PositionedNode[]): Map<string, CardNodeStyle> {
  const styles = new Map<string, CardNodeStyle>();
  nodes.forEach((node) => {
    if (node.kind !== "card" || !node.cardId) return;
    const card = getCardById(deck, node.cardId);
    const segments = getCardTypeSegments(card ? getPrimaryTypeLine(card) : "");
    styles.set(node.id, {
      fill: segments.length > 1 ? `url(#${getCardTypeGradientId(node.id)})` : segments[0]?.color ?? CARD_TYPE_COLORS.Other,
      gradientId: segments.length > 1 ? getCardTypeGradientId(node.id) : undefined,
      segments,
    });
  });
  return styles;
}

function getCardTypeSegments(typeLine: string): CardTypeSegment[] {
  const detected = CARD_TYPE_ORDER.filter((type) => new RegExp(`\\b${type}\\b`, "i").test(typeLine));
  const types: CardTypeName[] = detected.length ? [...detected] : ["Other"];
  return types.map((type) => ({
    type,
    color: CARD_TYPE_COLORS[type],
  }));
}

function getCardTypeGradientId(nodeId: string): string {
  return `card-type-${nodeId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function layoutNodes(nodes: DeckGraphNode[], edges: DeckGraphEdge[], spacing: number): PositionedNode[] {
  const centerX = GRAPH_WORLD_WIDTH / 2;
  const centerY = GRAPH_WORLD_HEIGHT / 2;
  const width = GRAPH_WORLD_WIDTH;
  const height = GRAPH_WORLD_HEIGHT;
  const margin = GRAPH_WORLD_MARGIN;
  const commander = nodes.find((node) => node.kind === "card" && node.weight >= 8);
  const positions = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  const seededRandom = createSeededRandom(nodes.map((node) => node.id).join("|"));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const degrees = new Map<string, number>();

  edges.forEach((edge) => {
    degrees.set(edge.sourceId, (degrees.get(edge.sourceId) ?? 0) + edge.strength);
    degrees.set(edge.targetId, (degrees.get(edge.targetId) ?? 0) + edge.strength);
  });

  nodes.forEach((node, index) => {
    const kindIndex = ["strategy", "package", "resource", "risk", "card"].indexOf(node.kind);
    const baseRadius = node.id === commander?.id ? 0 : (170 + kindIndex * 48 + seededRandom() * 145) * spacing;
    const angle = (Math.PI * 2 * index) / Math.max(1, nodes.length) + seededRandom() * 0.9;
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * baseRadius,
      y: centerY + Math.sin(angle) * baseRadius,
      vx: 0,
      vy: 0,
    });
  });

  for (let tick = 0; tick < 260; tick += 1) {
    const alpha = 1 - tick / 260;
    applyRepulsion(nodes, positions, spacing, alpha);
    applyEdgeAttraction(edges, positions, nodeById, spacing, alpha);
    applyKindGravity(nodes, positions, degrees, commander?.id, centerX, centerY, spacing, alpha);
    integratePositions(nodes, positions, width, height, margin);
  }

  return nodes.map((node) => {
    const position = positions.get(node.id) ?? { x: centerX, y: centerY };
    return { ...node, x: Math.round(position.x), y: Math.round(position.y) };
  });
}

function applyRepulsion(nodes: DeckGraphNode[], positions: Map<string, { x: number; y: number; vx: number; vy: number }>, spacing: number, alpha: number): void {
  for (let outer = 0; outer < nodes.length; outer += 1) {
    const a = nodes[outer];
    const aPosition = positions.get(a.id);
    if (!aPosition) continue;
    for (let inner = outer + 1; inner < nodes.length; inner += 1) {
      const b = nodes[inner];
      const bPosition = positions.get(b.id);
      if (!bPosition) continue;
      const dx = bPosition.x - aPosition.x || 0.01;
      const dy = bPosition.y - aPosition.y || 0.01;
      const distanceSquared = Math.max(1200, dx * dx + dy * dy);
      const distance = Math.sqrt(distanceSquared);
      const force = ((a.kind === "card" && b.kind === "card" ? 2850 : 4300) * spacing * spacing * alpha) / distanceSquared;
      const xForce = (dx / distance) * force;
      const yForce = (dy / distance) * force;
      aPosition.vx -= xForce;
      aPosition.vy -= yForce;
      bPosition.vx += xForce;
      bPosition.vy += yForce;
    }
  }
}

function applyEdgeAttraction(
  edges: DeckGraphEdge[],
  positions: Map<string, { x: number; y: number; vx: number; vy: number }>,
  nodeById: Map<string, DeckGraphNode>,
  spacing: number,
  alpha: number,
): void {
  edges.forEach((edge) => {
    const source = positions.get(edge.sourceId);
    const target = positions.get(edge.targetId);
    const sourceNode = nodeById.get(edge.sourceId);
    const targetNode = nodeById.get(edge.targetId);
    if (!source || !target || !sourceNode || !targetNode) return;
    const dx = target.x - source.x || 0.01;
    const dy = target.y - source.y || 0.01;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const preferredDistance = getPreferredEdgeDistance(edge, sourceNode, targetNode, spacing);
    const pull = (distance - preferredDistance) * (0.0025 + edge.strength * 0.0018) * alpha;
    const xForce = (dx / distance) * pull;
    const yForce = (dy / distance) * pull;
    source.vx += xForce;
    source.vy += yForce;
    target.vx -= xForce;
    target.vy -= yForce;
  });
}

function getPreferredEdgeDistance(edge: DeckGraphEdge, source: DeckGraphNode, target: DeckGraphNode, spacing: number): number {
  const cardToConcept = source.kind === "card" || target.kind === "card";
  const base = cardToConcept ? 168 : 235;
  const strengthAdjustment = (edge.strength - 1) * 16;
  return Math.max(92, base * spacing - strengthAdjustment);
}

function applyKindGravity(
  nodes: DeckGraphNode[],
  positions: Map<string, { x: number; y: number; vx: number; vy: number }>,
  degrees: Map<string, number>,
  commanderId: string | undefined,
  centerX: number,
  centerY: number,
  spacing: number,
  alpha: number,
): void {
  nodes.forEach((node) => {
    const position = positions.get(node.id);
    if (!position) return;
    const degree = degrees.get(node.id) ?? 0;
    const gravity = node.id === commanderId ? 0.045 : node.kind === "card" ? 0.0025 + degree * 0.0002 : 0.006 + node.weight * 0.0004;
    const targetRadius = (node.kind === "risk" ? 335 : node.kind === "card" ? 150 + Math.max(0, 9 - degree) * 12 : 115) * spacing;
    const angle = stableAngle(node.id);
    const targetX = node.id === commanderId ? centerX : centerX + Math.cos(angle) * targetRadius;
    const targetY = node.id === commanderId ? centerY : centerY + Math.sin(angle) * targetRadius;
    position.vx += (targetX - position.x) * gravity * alpha;
    position.vy += (targetY - position.y) * gravity * alpha;
  });
}

function integratePositions(
  nodes: DeckGraphNode[],
  positions: Map<string, { x: number; y: number; vx: number; vy: number }>,
  width: number,
  height: number,
  margin: number,
): void {
  nodes.forEach((node) => {
    const position = positions.get(node.id);
    if (!position) return;
    const radius = nodeRadius(node);
    position.vx *= 0.82;
    position.vy *= 0.82;
    position.x = clamp(position.x + position.vx, margin + radius, width - margin - radius);
    position.y = clamp(position.y + position.vy, margin + radius, height - margin - radius);
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createSeededRandom(seedText: string): () => number {
  let seed = hashString(seedText) || 1;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function stableAngle(value: string): number {
  return (hashString(value) / 4294967296) * Math.PI * 2;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getVisibleGraph(graph: DeckGraph, hiddenSet: Set<string>): DeckGraph {
  const nodes = graph.nodes.filter((node) => !hiddenSet.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    ...graph,
    nodes,
    edges: graph.edges.filter((edge) => nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId)),
  };
}

function filterGraphToNodeIds(graph: DeckGraph, nodeIds: Set<string>): DeckGraph {
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => nodeIds.has(node.id)),
    edges: graph.edges.filter((edge) => nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId)),
  };
}

function getZoomedViewBox(zoom: number, pan: PanState): string {
  const width = GRAPH_WORLD_WIDTH / zoom;
  const height = GRAPH_WORLD_HEIGHT / zoom;
  const x = (GRAPH_WORLD_WIDTH - width) / 2 + pan.x;
  const y = (GRAPH_WORLD_HEIGHT - height) / 2 + pan.y;
  return `${x} ${y} ${width} ${height}`;
}

function clampZoom(value: number): number {
  return Math.round(Math.min(3, Math.max(0.7, value)) * 100) / 100;
}

function clampPan(value: number): number {
  const limit = Math.max(GRAPH_WORLD_WIDTH, GRAPH_WORLD_HEIGHT) * 0.4;
  return Math.round(Math.min(limit, Math.max(-limit, value)));
}

function nodeRadius(node: DeckGraphNode): number {
  if (node.kind === "card") return node.weight >= 8 ? 24 : 11;
  return Math.min(42, 22 + node.weight * 1.4);
}

function trimLabel(label: string, max: number): string {
  return label.length > max ? `${label.slice(0, max - 1)}...` : label;
}
