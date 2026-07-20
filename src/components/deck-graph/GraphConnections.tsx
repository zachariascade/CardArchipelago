import { Copy, Lock, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import type { HoverPreviewHandlers } from "../../app/App";
import { DeckGraphEdge, DeckGraphNode } from "../../deck/deckGraph";
import { DeckEntry, DeckSnapshot, getPrimaryTypeLine } from "../../deck/deckModel";
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
  addKind: DeckGraphEdge["kind"];
  connectionGroup?: string;
  edgeIds: string[];
  edgeFunctionIds: string[];
  directItems: ConnectionItem[];
  functionGroups: EdgeFunctionConnectionGroup[];
  entryCount: number;
};

type DraggedConnection = {
  edgeId: string;
  sourceGroupId: string;
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
  onMoveCardConnection,
  onRenameConnectionGroup,
  onAddCardConnectionToGroup,
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
  onMoveCardConnection?: (edgeId: string, connectionGroup: string | undefined) => void;
  onRenameConnectionGroup?: (edgeIds: string[], edgeFunctionIds: string[], connectionGroup: string) => void;
  onAddCardConnectionToGroup?: (cardId: string, selectedNodeId: string, kind: DeckGraphEdge["kind"], connectionGroup: string | undefined) => void;
  onCopyConnectionsJson?: () => void;
  onDeleteConnectionsPatch?: () => void;
  hoverPreview?: HoverPreviewHandlers;
}) {
  const [openActionMenuId, setOpenActionMenuId] = useState<string>();
  const [draggedConnection, setDraggedConnection] = useState<DraggedConnection>();
  const [activeDropGroupId, setActiveDropGroupId] = useState<string>();
  const [editingGroupId, setEditingGroupId] = useState<string>();
  const [editingGroupLabel, setEditingGroupLabel] = useState("");
  const [openAddMenuGroupId, setOpenAddMenuGroupId] = useState<string>();
  const [addConnectionSearch, setAddConnectionSearch] = useState("");
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

  useEffect(() => {
    if (!openAddMenuGroupId) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".graph-add-connection-menu")) return;
      setOpenAddMenuGroupId(undefined);
      setAddConnectionSearch("");
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenAddMenuGroupId(undefined);
      setAddConnectionSearch("");
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openAddMenuGroupId]);

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
  const finishEditingGroup = (group: ConnectionGroup) => {
    const nextLabel = editingGroupLabel.trim();
    setEditingGroupId(undefined);
    setEditingGroupLabel("");
    if (!nextLabel || nextLabel === group.label) return;
    onRenameConnectionGroup?.(group.edgeIds, group.edgeFunctionIds, nextLabel);
  };
  return (
    <div className="graph-connections">
      <GraphConnectionsHeading
        openMenuId={openActionMenuId}
        onOpenMenuChange={setOpenActionMenuId}
        onCopyConnectionsJson={onCopyConnectionsJson}
        onDeleteConnectionsPatch={onDeleteConnectionsPatch}
      />
      {groups.map((group) => {
        const canDropConnection = Boolean(onMoveCardConnection && draggedConnection && draggedConnection.sourceGroupId !== group.id);
        return (
        <div
          className={`graph-connection-group ${canDropConnection ? "can-drop-connection" : ""} ${activeDropGroupId === group.id ? "drop-target-active" : ""}`}
          key={group.id}
          onDragOver={(event) => {
            if (!canDropConnection) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setActiveDropGroupId(group.id);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActiveDropGroupId(undefined);
          }}
          onDrop={(event) => {
            if (!canDropConnection || !draggedConnection) return;
            event.preventDefault();
            onMoveCardConnection?.(draggedConnection.edgeId, group.connectionGroup);
            setDraggedConnection(undefined);
            setActiveDropGroupId(undefined);
          }}
        >
          <div
            className={`graph-connection-group-heading ${onRenameConnectionGroup ? "is-editable" : ""}`}
            onDoubleClick={() => {
              if (!onRenameConnectionGroup) return;
              setEditingGroupId(group.id);
              setEditingGroupLabel(group.label);
            }}
          >
            {editingGroupId === group.id ? (
              <input
                className="graph-connection-group-name-input"
                value={editingGroupLabel}
                autoFocus
                aria-label={`Rename ${group.label} connection group`}
                onChange={(event) => setEditingGroupLabel(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onBlur={() => finishEditingGroup(group)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setEditingGroupId(undefined);
                    setEditingGroupLabel("");
                  }
                }}
              />
            ) : (
              <span title={onRenameConnectionGroup ? "Double-click to rename" : undefined}>{group.label}</span>
            )}
            <div className="graph-connection-group-count-actions">
              <strong>{group.entryCount}</strong>
              {onAddCardConnectionToGroup && (
                <div className={`graph-add-connection-menu ${openAddMenuGroupId === group.id ? "open" : ""}`}>
                  <button
                    type="button"
                    className="graph-add-connection-trigger"
                    aria-label={`Add card connection to ${group.label}`}
                    title={`Add card connection to ${group.label}`}
                    aria-expanded={openAddMenuGroupId === group.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      setEditingGroupId(undefined);
                      setOpenAddMenuGroupId(openAddMenuGroupId === group.id ? undefined : group.id);
                      setAddConnectionSearch("");
                    }}
                    onDoubleClick={(event) => event.stopPropagation()}
                  >
                    <Plus size={14} />
                  </button>
                  {openAddMenuGroupId === group.id && (
                    <AddConnectionMenu
                      deck={deck}
                      group={group}
                      selectedNodeId={selectedNodeId}
                      search={addConnectionSearch}
                      onSearchChange={setAddConnectionSearch}
                      onAdd={(cardId) => {
                        onAddCardConnectionToGroup(cardId, selectedNodeId, group.addKind, group.connectionGroup);
                        setOpenAddMenuGroupId(undefined);
                        setAddConnectionSearch("");
                      }}
                    />
                  )}
                </div>
              )}
            </div>
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
                        group.id,
                        onMoveCardConnection ? setDraggedConnection : undefined,
                        () => {
                          setDraggedConnection(undefined);
                          setActiveDropGroupId(undefined);
                        },
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
                  group.id,
                  onMoveCardConnection ? setDraggedConnection : undefined,
                  () => {
                    setDraggedConnection(undefined);
                    setActiveDropGroupId(undefined);
                  },
                ),
              )}
          </div>
        </div>
        );
      })}
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

function AddConnectionMenu({
  deck,
  group,
  selectedNodeId,
  search,
  onSearchChange,
  onAdd,
}: {
  deck: DeckSnapshot;
  group: ConnectionGroup;
  selectedNodeId: string;
  search: string;
  onSearchChange: (value: string) => void;
  onAdd: (cardId: string) => void;
}) {
  const connectedCardNodeIds = new Set(
    [...group.directItems, ...group.functionGroups.flatMap((functionGroup) => functionGroup.items)]
      .map((item) => item.node.id)
      .filter((nodeId) => nodeId.startsWith("card:")),
  );
  const query = search.trim().toLowerCase();
  const cards = deck.entries
    .filter((entry) => !entry.unresolved)
    .filter((entry) => `card:${entry.id}` !== selectedNodeId)
    .filter((entry) => !connectedCardNodeIds.has(`card:${entry.id}`))
    .filter((entry) => {
      if (!query) return true;
      return `${entry.name} ${getPrimaryTypeLine(entry)}`.toLowerCase().includes(query);
    })
    .sort(sortDeckEntriesByName)
    .slice(0, 8);
  return (
    <div className="graph-add-connection-dropdown" role="dialog" aria-label={`Add card to ${group.label}`}>
      <input
        className="graph-add-connection-search"
        value={search}
        autoFocus
        placeholder="Search deck cards"
        aria-label="Search deck cards"
        onChange={(event) => onSearchChange(event.target.value)}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      />
      <div className="graph-add-connection-results">
        {cards.length ? (
          cards.map((card) => (
            <button
              type="button"
              className="graph-add-connection-result"
              key={card.id}
              onClick={(event) => {
                event.stopPropagation();
                onAdd(card.id);
              }}
            >
              <strong>{card.name}</strong>
              <span>{getPrimaryTypeLine(card) || "Unresolved card"}</span>
            </button>
          ))
        ) : (
          <p>No matching cards.</p>
        )}
      </div>
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
    {
      label: string;
      kind?: DeckGraphEdge["kind"];
      edgeIds: string[];
      edgeFunctionIds: Set<string>;
      directItems: ConnectionItem[];
      functionGroups: Map<string, EdgeFunctionConnectionGroup>;
    }
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
      edgeIds: [],
      edgeFunctionIds: new Set<string>(),
      directItems: [],
      functionGroups: new Map<string, EdgeFunctionConnectionGroup>(),
    };
    group.edgeIds.push(edge.id);
    const item = { node, edge };
    if (edge.generatedByFunctionId) {
      group.edgeFunctionIds.add(edge.generatedByFunctionId);
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
      addKind: group.directItems[0]?.edge.kind ?? Array.from(group.functionGroups.values())[0]?.items[0]?.edge.kind ?? group.kind ?? "supports",
      connectionGroup: group.kind ? undefined : group.label,
      edgeIds: group.edgeIds,
      edgeFunctionIds: Array.from(group.edgeFunctionIds),
      directItems: group.directItems.sort(sortConnectionItems),
      functionGroups: Array.from(group.functionGroups.values())
        .map((functionGroup) => ({ ...functionGroup, items: functionGroup.items.sort(sortConnectionItems) }))
        .sort((a, b) => b.items.length - a.items.length || groupSortIndex(a.kind) - groupSortIndex(b.kind) || a.evidence.localeCompare(b.evidence)),
      entryCount: group.directItems.length + Array.from(group.functionGroups.values()).reduce((total, functionGroup) => total + functionGroup.items.length, 0),
    }))
    .sort((a, b) => b.entryCount - a.entryCount || groupSortIndex(a.kind) - groupSortIndex(b.kind) || a.label.localeCompare(b.label));
}

function sortDeckEntriesByName(a: DeckEntry, b: DeckEntry): number {
  return a.name.localeCompare(b.name);
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
  groupId: string,
  setDraggedConnection: ((value: DraggedConnection | undefined) => void) | undefined,
  onDragEnd: () => void,
): ReactNode {
  const connectionName = node.cardId ? getCardById(deck, node.cardId)?.name ?? node.label : node.label;
  const connectionText = edgeLabel(edge, selectedNodeId, connectionName, deck);
  const isGeneratedConnection = Boolean(edge.generatedByFunctionId);
  const canDragConnection = Boolean(setDraggedConnection && node.cardId && !isGeneratedConnection);
  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    if (!canDragConnection) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", edge.id);
    setDraggedConnection?.({ edgeId: edge.id, sourceGroupId: groupId });
  };
  if (node.cardId) {
    const card = getCardById(deck, node.cardId);
    if (card) {
      return (
        <div
          key={`${edge.id}:${node.id}`}
          className={`graph-card-connection-row ${canDragConnection ? "is-draggable" : ""} ${isGeneratedConnection ? "is-generated-connection" : ""}`}
          draggable={canDragConnection}
          onDragStart={handleDragStart}
          onDragEnd={onDragEnd}
        >
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
          {isGeneratedConnection && (
            <span className="graph-generated-lock" title="Generated by an edgeFunction" aria-label="Generated by an edgeFunction">
              <Lock size={13} />
            </span>
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
