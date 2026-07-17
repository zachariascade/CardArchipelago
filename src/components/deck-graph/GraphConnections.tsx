import { Copy, MoreHorizontal, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { HoverPreviewHandlers } from "../../app/App";
import { DeckGraphEdge, DeckGraphNode } from "../../deck/deckGraph";
import { DeckSnapshot } from "../../deck/deckModel";
import { getCardById } from "../../deck/deckQueries";
import { DeckStackCard } from "../deck-card/DeckStackCard";

type ConnectionItem = {
  node: DeckGraphNode;
  edge: DeckGraphEdge;
};

type EdgeFunctionConnectionGroup = {
  id: string;
  label: string;
  evidence: string;
  kind: DeckGraphEdge["kind"];
  items: ConnectionItem[];
};

type ConnectionGroup = {
  id: string;
  label: string;
  kind?: DeckGraphEdge["kind"];
  directItems: ConnectionItem[];
  functionGroups: EdgeFunctionConnectionGroup[];
  entryCount: number;
};

const CONNECTION_KIND_ORDER: DeckGraphEdge["kind"][] = ["enables", "pays_off", "supports", "protects", "answers", "depends_on", "weak_to", "belongs_to"];

export function GraphConnections({
  deck,
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onOpenCard,
  onDeleteEdge,
  onDeleteEdges,
  onCopyConnectionsJson,
  onDeleteConnectionsPatch,
  hoverPreview,
}: {
  deck: DeckSnapshot;
  nodes: DeckGraphNode[];
  edges: DeckGraphEdge[];
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
  onOpenCard: (cardId: string) => void;
  onDeleteEdge?: (edgeId: string) => void;
  onDeleteEdges?: (edgeIds: string[], label?: string) => void;
  onCopyConnectionsJson?: () => void;
  onDeleteConnectionsPatch?: () => void;
  hoverPreview?: HoverPreviewHandlers;
}) {
  const [openActionMenuId, setOpenActionMenuId] = useState<string>();
  useEffect(() => {
    if (!openActionMenuId) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".graph-edge-action-menu")) return;
      setOpenActionMenuId(undefined);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenActionMenuId(undefined);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openActionMenuId]);

  if (!nodes.length) {
    return (
      <div className="graph-connections">
        <GraphConnectionsHeading
          openMenuId={openActionMenuId}
          onOpenMenuChange={setOpenActionMenuId}
          onCopyConnectionsJson={onCopyConnectionsJson}
          onDeleteConnectionsPatch={onDeleteConnectionsPatch}
        />
        <div className="graph-connections-empty">No visible connections.</div>
      </div>
    );
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const groups = groupConnections(deck, edges, nodeById, selectedNodeId);
  return (
    <div className="graph-connections">
      <GraphConnectionsHeading
        openMenuId={openActionMenuId}
        onOpenMenuChange={setOpenActionMenuId}
        onCopyConnectionsJson={onCopyConnectionsJson}
        onDeleteConnectionsPatch={onDeleteConnectionsPatch}
      />
      {groups.map((group) => (
        <div className="graph-connection-group" key={group.id}>
          <div className="graph-connection-group-heading">
            <span>{group.label}</span>
            <strong>{group.entryCount}</strong>
          </div>
          <div id={`graph-connection-group-${selectedNodeId}-${group.id}`} className="graph-connection-group-items">
            {group.functionGroups.slice(0, 10).map((functionGroup) => (
              <div className="graph-edge-function-group" key={functionGroup.id}>
                <div className="graph-edge-function-heading">
                  <div className="graph-edge-function-toggle" aria-label={`${functionGroup.label}. ${functionGroup.evidence}`} title={functionGroup.evidence}>
                    <strong>{functionGroup.label}</strong>
                    <small>{functionGroup.items.length}</small>
                    <span className="connection-tooltip" role="tooltip">
                      {functionGroup.evidence}
                    </span>
                  </div>
                  {onDeleteEdges && (
                    <GraphEdgeActionMenu
                      menuId={`function:${functionGroup.id}`}
                      openMenuId={openActionMenuId}
                      onOpenMenuChange={setOpenActionMenuId}
                      ariaLabel={`Open actions for ${functionGroup.label}`}
                      ownershipLabel={edgeOwnershipLabel(functionGroup.items[0]?.edge, selectedNodeId, deck)}
                      deleteLabel="Delete connections"
                      onDelete={() =>
                        onDeleteEdges(
                          functionGroup.items.map((item) => item.edge.id),
                          functionGroup.label,
                        )
                      }
                    />
                  )}
                </div>
                <div id={`graph-edge-function-${selectedNodeId}-${functionGroup.id}`} className="graph-edge-function-items">
                  {functionGroup.items
                    .slice(0, 18)
                    .map((item) =>
                      renderConnectionRow(
                        item,
                        deck,
                        selectedNodeId,
                        onSelectNode,
                        onOpenCard,
                        onDeleteEdge,
                        hoverPreview,
                        openActionMenuId,
                        setOpenActionMenuId,
                      ),
                    )}
                </div>
              </div>
            ))}
            {group.directItems
              .slice(0, 18)
              .map((item) =>
                renderConnectionRow(
                  item,
                  deck,
                  selectedNodeId,
                  onSelectNode,
                  onOpenCard,
                  onDeleteEdge,
                  hoverPreview,
                  openActionMenuId,
                  setOpenActionMenuId,
                ),
              )}
          </div>
        </div>
      ))}
    </div>
  );
}

function GraphConnectionsHeading({
  openMenuId,
  onOpenMenuChange,
  onCopyConnectionsJson,
  onDeleteConnectionsPatch,
}: {
  openMenuId: string | undefined;
  onOpenMenuChange: (menuId: string | undefined) => void;
  onCopyConnectionsJson?: () => void;
  onDeleteConnectionsPatch?: () => void;
}) {
  return (
    <div className="graph-connections-heading">
      <h3>Connections</h3>
      {(onCopyConnectionsJson || onDeleteConnectionsPatch) && (
        <GraphEdgeActionMenu
          menuId="connections:patch"
          openMenuId={openMenuId}
          onOpenMenuChange={onOpenMenuChange}
          className="graph-connections-action-menu"
          ariaLabel="Open actions for Connections"
          copyLabel={onCopyConnectionsJson ? "Copy Connections JSON" : undefined}
          onCopy={onCopyConnectionsJson}
          deleteLabel="Delete"
          onDelete={onDeleteConnectionsPatch}
        />
      )}
    </div>
  );
}

function groupConnections(
  deck: DeckSnapshot,
  edges: DeckGraphEdge[],
  nodeById: Map<string, DeckGraphNode>,
  selectedNodeId: string,
): ConnectionGroup[] {
  const groups = new Map<
    string,
    { label: string; kind?: DeckGraphEdge["kind"]; directItems: ConnectionItem[]; functionGroups: Map<string, EdgeFunctionConnectionGroup> }
  >();
  edges.forEach((edge) => {
    const otherNodeId = edge.sourceId === selectedNodeId ? edge.targetId : edge.targetId === selectedNodeId ? edge.sourceId : undefined;
    if (!otherNodeId) return;
    const node = nodeById.get(otherNodeId);
    if (!node) return;
    const customLabel = edge.connectionGroup?.trim();
    const groupId = customLabel ? `custom:${customLabel.toLowerCase()}` : `kind:${edge.kind}`;
    const group = groups.get(groupId) ?? {
      label: customLabel || connectionKindLabel(edge.kind),
      kind: customLabel ? undefined : edge.kind,
      directItems: [],
      functionGroups: new Map<string, EdgeFunctionConnectionGroup>(),
    };
    const item = { node, edge };
    if (edge.generatedByFunctionId) {
      const functionGroupId = `${groupId}:function:${edge.generatedByFunctionId}`;
      const functionGroup = group.functionGroups.get(functionGroupId) ?? {
        id: functionGroupId,
        label: edge.connectionGroup?.trim() || formatEdgeFunctionName(edge.generatedByFunctionId),
        evidence: sanitizeGraphText(edge.evidence ?? "Generated selector relationship.", deck),
        kind: edge.kind,
        items: [],
      };
      functionGroup.items.push(item);
      group.functionGroups.set(functionGroupId, functionGroup);
    } else {
      group.directItems.push(item);
    }
    groups.set(groupId, group);
  });
  return Array.from(groups.entries())
    .map(([id, group]) => ({
      id,
      label: group.label,
      kind: group.kind,
      directItems: group.directItems.sort(sortConnectionItems),
      functionGroups: Array.from(group.functionGroups.values())
        .map((functionGroup) => ({ ...functionGroup, items: functionGroup.items.sort(sortConnectionItems) }))
        .sort((a, b) => b.items.length - a.items.length || groupSortIndex(a.kind) - groupSortIndex(b.kind) || a.evidence.localeCompare(b.evidence)),
      entryCount: group.directItems.length + Array.from(group.functionGroups.values()).reduce((total, functionGroup) => total + functionGroup.items.length, 0),
    }))
    .sort((a, b) => b.entryCount - a.entryCount || groupSortIndex(a.kind) - groupSortIndex(b.kind) || a.label.localeCompare(b.label));
}

function renderConnectionRow(
  { node, edge }: ConnectionItem,
  deck: DeckSnapshot,
  selectedNodeId: string,
  onSelectNode: (nodeId: string) => void,
  onOpenCard: (cardId: string) => void,
  onDeleteEdge: ((edgeId: string) => void) | undefined,
  hoverPreview: HoverPreviewHandlers | undefined,
  openActionMenuId: string | undefined,
  setOpenActionMenuId: (menuId: string | undefined) => void,
): ReactNode {
  const connectionName = node.cardId ? getCardById(deck, node.cardId)?.name ?? node.label : node.label;
  const connectionText = edgeLabel(edge, selectedNodeId, connectionName, deck);
  if (node.cardId) {
    const card = getCardById(deck, node.cardId);
    if (card) {
      return (
        <div key={`${edge.id}:${node.id}`} className="graph-card-connection-row">
          <DeckStackCard
            entry={card}
            className="graph-connection-card"
            ariaLabel={`${card.name}. ${connectionText}`}
            hoverPreview={hoverPreview}
            onSelect={() => onOpenCard(node.cardId!)}
          />
          {onDeleteEdge && (
            <GraphEdgeActionMenu
              menuId={`edge:${edge.id}`}
              openMenuId={openActionMenuId}
              onOpenMenuChange={setOpenActionMenuId}
              className="graph-card-edge-action-menu"
              ariaLabel={`Open actions for edge between selected node and ${card.name}`}
              ownershipLabel={edgeOwnershipLabel(edge, selectedNodeId, deck)}
              deleteLabel="Delete edge"
              onDelete={() => onDeleteEdge(edge.id)}
            />
          )}
          <span className="connection-tooltip" role="tooltip">
            {connectionText}
          </span>
        </div>
      );
    }
  }
  return (
    <div
      key={`${edge.id}:${node.id}`}
      className="graph-connection-row"
      role="button"
      tabIndex={0}
      onClick={() => (node.cardId ? onOpenCard(node.cardId) : onSelectNode(node.id))}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        node.cardId ? onOpenCard(node.cardId) : onSelectNode(node.id);
      }}
      onMouseEnter={(event) => node.cardId && hoverPreview?.show(node.cardId, event.currentTarget)}
      onMouseLeave={hoverPreview?.hide}
      onFocus={(event) => node.cardId && hoverPreview?.show(node.cardId, event.currentTarget)}
      onBlur={hoverPreview?.hide}
      aria-label={`${node.label}. ${connectionText}`}
    >
      <span className={`connection-kind ${node.kind}`}>{node.kind}</span>
      <strong>{node.label}</strong>
      {onDeleteEdge && (
        <GraphEdgeActionMenu
          menuId={`edge:${edge.id}`}
          openMenuId={openActionMenuId}
          onOpenMenuChange={setOpenActionMenuId}
          ariaLabel={`Open actions for edge between selected node and ${node.label}`}
          ownershipLabel={edgeOwnershipLabel(edge, selectedNodeId, deck)}
          deleteLabel="Delete edge"
          onDelete={() => onDeleteEdge(edge.id)}
        />
      )}
      <span className="connection-tooltip" role="tooltip">
        {connectionText}
      </span>
    </div>
  );
}

function GraphEdgeActionMenu({
  menuId,
  openMenuId,
  onOpenMenuChange,
  ariaLabel,
  ownershipLabel,
  copyLabel,
  onCopy,
  deleteLabel,
  onDelete,
  className,
}: {
  menuId: string;
  openMenuId: string | undefined;
  onOpenMenuChange: (menuId: string | undefined) => void;
  ariaLabel: string;
  ownershipLabel?: string;
  copyLabel?: string;
  onCopy?: () => void;
  deleteLabel?: string;
  onDelete?: () => void;
  className?: string;
}) {
  const isOpen = openMenuId === menuId;
  return (
    <div className={`graph-edge-action-menu ${isOpen ? "open" : ""} ${className ?? ""}`}>
      <button
        type="button"
        className="graph-edge-action-trigger"
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        title="Connection actions"
        onClick={(event) => {
          event.stopPropagation();
          onOpenMenuChange(isOpen ? undefined : menuId);
        }}
      >
        <MoreHorizontal size={16} />
      </button>
      <div className="graph-edge-action-dropdown" role="menu">
        {ownershipLabel && <div className="graph-edge-action-owner">{ownershipLabel}</div>}
        {onCopy && copyLabel && (
          <button
            type="button"
            className="graph-edge-action-item"
            role="menuitem"
            onClick={(event) => {
              event.stopPropagation();
              onOpenMenuChange(undefined);
              onCopy();
            }}
          >
            <Copy size={14} />
            {copyLabel}
          </button>
        )}
        {onDelete && deleteLabel && (
          <button
            type="button"
            className="graph-edge-action-item graph-edge-action-delete"
            role="menuitem"
            onClick={(event) => {
              event.stopPropagation();
              onOpenMenuChange(undefined);
              onDelete();
            }}
          >
            <Trash2 size={14} />
            {deleteLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function edgeOwnershipLabel(edge: DeckGraphEdge | undefined, selectedNodeId: string, deck: DeckSnapshot): string | undefined {
  if (!edge?.ownerCardId) return undefined;
  if (selectedNodeId === `card:${edge.ownerCardId}`) return "Owned by this card";
  const owner = getCardById(deck, edge.ownerCardId);
  return owner ? `From ${owner.name}` : "From another card";
}

function sortConnectionItems(a: ConnectionItem, b: ConnectionItem): number {
  return b.edge.strength - a.edge.strength || a.node.label.localeCompare(b.node.label);
}

function formatEdgeFunctionName(functionId: string): string {
  const idParts = functionId.split(":");
  const slug = idParts[idParts.length - 1] || functionId;
  const words = slug
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "Edge Function";
  return words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(" ");
}

function groupSortIndex(kind?: DeckGraphEdge["kind"]): number {
  if (!kind) return -1;
  return CONNECTION_KIND_ORDER.indexOf(kind);
}

function connectionKindLabel(kind: DeckGraphEdge["kind"]): string {
  const labels: Record<DeckGraphEdge["kind"], string> = {
    supports: "Supports",
    enables: "Enables",
    pays_off: "Pays Off",
    protects: "Protects",
    answers: "Answers",
    depends_on: "Depends On",
    weak_to: "Weak To",
    belongs_to: "Belongs To",
  };
  return labels[kind];
}

function edgeLabel(edge: DeckGraphEdge, selectedNodeId: string, otherName: string, deck: DeckSnapshot): string {
  const direction = edge.sourceId === selectedNodeId ? "to" : edge.targetId === selectedNodeId ? "from" : "with";
  const evidence = edge.evidence ? ` ${sanitizeGraphText(edge.evidence, deck)}` : "";
  return `${connectionKindLabel(edge.kind)} ${direction} ${otherName}. Strength ${edge.strength}. AI.${evidence}`;
}

function sanitizeGraphText(text: string, deck: DeckSnapshot): string {
  return text.replace(/\bcard:([A-Za-z0-9_-]+)/g, (match, cardId: string) => getCardById(deck, cardId)?.name ?? match);
}
