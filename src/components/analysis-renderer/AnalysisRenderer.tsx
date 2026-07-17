import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import type { HoverPreviewHandlers } from "../../app/App";
import { DeckSnapshot, getImageUri, getManaValue, getOracleText, getPrimaryTypeLine } from "../../deck/deckModel";
import { countQuery, getCardById, queryDeck } from "../../deck/deckQueries";
import { AnalysisLayoutNode, AnalysisResult } from "../../analysis/analysisSchema";
import { ColorPipChart, ManaCurveChart, TypeBreakdownChart } from "../charts/DeckCharts";

export type AnalysisNodePath = Array<string | number>;

export function AnalysisRenderer({
  deck,
  analysis,
  onSelectCard,
  hoverPreview,
  onDeleteNode,
}: {
  deck: DeckSnapshot;
  analysis: AnalysisResult;
  onSelectCard: (cardId: string) => void;
  hoverPreview?: HoverPreviewHandlers;
  onDeleteNode?: (path: AnalysisNodePath) => void;
}) {
  return (
    <section className="analysis-result">
      <div className="analysis-title">
        <h2>{analysis.title}</h2>
        {analysis.summary && <p>{analysis.summary}</p>}
      </div>
      <RenderNode deck={deck} analysis={analysis} node={analysis.layout} path={[]} onSelectCard={onSelectCard} hoverPreview={hoverPreview} onDeleteNode={onDeleteNode} />
    </section>
  );
}

function RenderNode({
  deck,
  analysis,
  node,
  path,
  onSelectCard,
  hoverPreview,
  onDeleteNode,
}: {
  deck: DeckSnapshot;
  analysis: AnalysisResult;
  node: AnalysisLayoutNode;
  path: AnalysisNodePath;
  onSelectCard: (cardId: string) => void;
  hoverPreview?: HoverPreviewHandlers;
  onDeleteNode?: (path: AnalysisNodePath) => void;
}) {
  if (node.type === "stack") {
    return (
      <div className="analysis-stack">
        {node.children.map((child, index) => (
          <RenderNode key={index} deck={deck} analysis={analysis} node={child} path={[...path, "children", index]} onSelectCard={onSelectCard} hoverPreview={hoverPreview} onDeleteNode={onDeleteNode} />
        ))}
      </div>
    );
  }

  if (node.type === "twoColumn") {
    return (
      <div className={`analysis-columns ratio-${node.ratio ?? "1:1"}`.replace(":", "-")}>
        <div>
          {node.left.map((child, index) => (
            <RenderNode key={index} deck={deck} analysis={analysis} node={child} path={[...path, "left", index]} onSelectCard={onSelectCard} hoverPreview={hoverPreview} onDeleteNode={onDeleteNode} />
          ))}
        </div>
        <div>
          {node.right.map((child, index) => (
            <RenderNode key={index} deck={deck} analysis={analysis} node={child} path={[...path, "right", index]} onSelectCard={onSelectCard} hoverPreview={hoverPreview} onDeleteNode={onDeleteNode} />
          ))}
        </div>
      </div>
    );
  }

  if (node.type === "tabs") {
    return <Tabs deck={deck} analysis={analysis} node={node} path={path} onSelectCard={onSelectCard} hoverPreview={hoverPreview} onDeleteNode={onDeleteNode} />;
  }

  if (node.type === "CardDescription") {
    const card = getCardById(deck, node.cardId);
    if (!card) return null;
    return (
      <article className="analysis-card card-description">
        <div className="analysis-card-action">
          <DeleteAnalysisButton onDelete={onDeleteNode && path.length ? () => onDeleteNode(path) : undefined} />
        </div>
        {getImageUri(card) && <img src={getImageUri(card)} alt="" />}
        <div>
          <h3>{card.name}</h3>
          <p className="type-line">{getPrimaryTypeLine(card)}</p>
          <p>{getOracleText(card) || "No Oracle text available."}</p>
        </div>
      </article>
    );
  }

  if (node.type === "NarrativePanel") {
    return (
      <article className="analysis-card">
        <AnalysisCardHeader title={node.title} onDelete={onDeleteNode && path.length ? () => onDeleteNode(path) : undefined} />
        <p>{node.body}</p>
      </article>
    );
  }

  if (node.type === "StatBlock") {
    return (
      <article className="analysis-card">
        <div className="analysis-card-action">
          <DeleteAnalysisButton onDelete={onDeleteNode && path.length ? () => onDeleteNode(path) : undefined} />
        </div>
        <div className="stat-grid">
          {node.stats.map((stat) => (
            <div className="stat" key={stat.label}>
              <span>{stat.label}</span>
              <strong>{stat.query ? countQuery(deck, stat.query) : stat.value}</strong>
            </div>
          ))}
        </div>
      </article>
    );
  }

  if (node.type === "CardList") {
    return <CardList deck={deck} node={node} onSelectCard={onSelectCard} hoverPreview={hoverPreview} onDelete={onDeleteNode && path.length ? () => onDeleteNode(path) : undefined} />;
  }

  if (node.type === "GroupedCardList") {
    return (
      <div className="analysis-stack">
        {node.groups.map((group, index) => (
          <CardList key={group.title} deck={deck} node={group} onSelectCard={onSelectCard} hoverPreview={hoverPreview} onDelete={onDeleteNode ? () => onDeleteNode([...path, "groups", index]) : undefined} />
        ))}
      </div>
    );
  }

  if (node.type === "ManaCurveChart") {
    return <ChartCard title={node.title ?? "Mana Curve"} chart={<ManaCurveChart deck={deck} />} onDelete={onDeleteNode && path.length ? () => onDeleteNode(path) : undefined} />;
  }

  if (node.type === "ColorPipChart") {
    return <ChartCard title={node.title ?? "Color Identity"} chart={<ColorPipChart deck={deck} />} onDelete={onDeleteNode && path.length ? () => onDeleteNode(path) : undefined} />;
  }

  if (node.type === "TypeBreakdownChart") {
    return <ChartCard title={node.title ?? "Type Breakdown"} chart={<TypeBreakdownChart deck={deck} />} onDelete={onDeleteNode && path.length ? () => onDeleteNode(path) : undefined} />;
  }

  if (node.type === "TagBreakdown") {
    return (
      <article className="analysis-card">
        <AnalysisCardHeader title={node.title} onDelete={onDeleteNode && path.length ? () => onDeleteNode(path) : undefined} />
        <div className="tag-row">
          {node.tags.map((tag) => (
            <span key={tag.label}>{tag.label}: {tag.count}</span>
          ))}
        </div>
      </article>
    );
  }

  if (node.type === "EvidenceList") {
    return (
      <article className="analysis-card">
        <AnalysisCardHeader title={node.title ?? "Evidence"} onDelete={onDeleteNode && path.length ? () => onDeleteNode(path) : undefined} />
        <div className="evidence-list">
          {(analysis.evidence ?? []).map((item, index) => (
            <div key={index}>
              <strong>{item.claim}</strong>
              {item.cardIds?.length ? <CardIdLinks deck={deck} cardIds={item.cardIds} onSelectCard={onSelectCard} hoverPreview={hoverPreview} /> : null}
              {item.query ? <span className="query-chip">{countQuery(deck, item.query)} matches</span> : null}
              {item.note ? <p>{item.note}</p> : null}
            </div>
          ))}
        </div>
      </article>
    );
  }

  return null;
}

function CardList({
  deck,
  node,
  onSelectCard,
  hoverPreview,
  onDelete,
}: {
  deck: DeckSnapshot;
  node: { title: string; cardIds?: string[]; query?: Parameters<typeof queryDeck>[1]; emptyText?: string };
  onSelectCard: (cardId: string) => void;
  hoverPreview?: HoverPreviewHandlers;
  onDelete?: () => void;
}) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const cards = node.cardIds?.length
    ? node.cardIds.map((id) => getCardById(deck, id)).filter(Boolean)
    : queryDeck(deck, node.query);
  const count = cards.reduce((sum, card) => sum + (card?.quantity ?? 0), 0);
  return (
    <article className="analysis-card">
      <div className="analysis-list-heading">
        <button type="button" className="analysis-heading-main" aria-expanded={!isCollapsed} onClick={() => setIsCollapsed((value) => !value)}>
          <span className="heading-title">
            {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            <h3>{node.title}</h3>
          </span>
        </button>
        <span className="analysis-heading-actions">
          <span>{count}</span>
          <DeleteAnalysisButton onDelete={onDelete} />
        </span>
      </div>
      {!isCollapsed && (
        <div className="analysis-card-list">
          {cards.length ? (
            cards.map((card) => (
              <button
                key={card!.id}
                type="button"
                onClick={() => onSelectCard(card!.id)}
                onMouseEnter={(event) => hoverPreview?.show(card!.id, event.currentTarget)}
                onMouseLeave={hoverPreview?.hide}
                onFocus={(event) => hoverPreview?.show(card!.id, event.currentTarget)}
                onBlur={hoverPreview?.hide}
              >
                <span>{card!.quantity}x</span>
                <strong>{card!.name}</strong>
                <em>MV {getManaValue(card!)}</em>
              </button>
            ))
          ) : (
            <p>{node.emptyText ?? "No cards found."}</p>
          )}
        </div>
      )}
    </article>
  );
}

function CardIdLinks({
  deck,
  cardIds,
  onSelectCard,
  hoverPreview,
}: {
  deck: DeckSnapshot;
  cardIds: string[];
  onSelectCard: (cardId: string) => void;
  hoverPreview?: HoverPreviewHandlers;
}) {
  return (
    <div className="card-link-row">
      {cardIds.map((id) => {
        const card = getCardById(deck, id);
        if (!card) return null;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelectCard(id)}
            onMouseEnter={(event) => hoverPreview?.show(id, event.currentTarget)}
            onMouseLeave={hoverPreview?.hide}
            onFocus={(event) => hoverPreview?.show(id, event.currentTarget)}
            onBlur={hoverPreview?.hide}
          >
            {card.name}
          </button>
        );
      })}
    </div>
  );
}

function ChartCard({ title, chart, onDelete }: { title: string; chart: ReactNode; onDelete?: () => void }) {
  return (
    <article className="analysis-card">
      <AnalysisCardHeader title={title} onDelete={onDelete} />
      {chart}
    </article>
  );
}

function Tabs({
  deck,
  analysis,
  node,
  path,
  onSelectCard,
  hoverPreview,
  onDeleteNode,
}: {
  deck: DeckSnapshot;
  analysis: AnalysisResult;
  node: Extract<AnalysisLayoutNode, { type: "tabs" }>;
  path: AnalysisNodePath;
  onSelectCard: (cardId: string) => void;
  hoverPreview?: HoverPreviewHandlers;
  onDeleteNode?: (path: AnalysisNodePath) => void;
}) {
  const [active, setActive] = useState(0);
  const activeTab = node.tabs[active];
  return (
    <article className="analysis-card">
      <div className="tab-row">
        {node.tabs.map((tab, index) => (
          <button key={tab.label} className={index === active ? "active" : ""} type="button" onClick={() => setActive(index)}>
            {tab.label}
          </button>
        ))}
      </div>
      <div className="analysis-stack">
        {activeTab.children.map((child, index) => (
          <RenderNode
            key={index}
            deck={deck}
            analysis={analysis}
            node={child}
            path={[...path, "tabs", active, "children", index]}
            onSelectCard={onSelectCard}
            hoverPreview={hoverPreview}
            onDeleteNode={onDeleteNode}
          />
        ))}
      </div>
    </article>
  );
}

function AnalysisCardHeader({ title, onDelete }: { title?: string; onDelete?: () => void }) {
  if (!title && !onDelete) return null;
  return (
    <div className="analysis-card-heading">
      {title ? <h3>{title}</h3> : <span />}
      <DeleteAnalysisButton onDelete={onDelete} />
    </div>
  );
}

function DeleteAnalysisButton({ onDelete }: { onDelete?: () => void }) {
  if (!onDelete) return null;
  return (
    <button
      type="button"
      className="delete-analysis-button"
      title="Delete this analysis element"
      aria-label="Delete this analysis element"
      onClick={(event) => {
        event.stopPropagation();
        onDelete();
      }}
    >
      <Trash2 size={15} />
    </button>
  );
}
