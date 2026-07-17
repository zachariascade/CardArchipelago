import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DeckSnapshot } from "../../deck/deckModel";
import { colorIdentityBreakdown, manaCurve, typeBreakdown } from "../../deck/deckQueries";

const COLOR_MAP: Record<string, string> = {
  W: "#d8c99b",
  U: "#4f8fc8",
  B: "#5c5366",
  R: "#c85f43",
  G: "#5f9a6f",
  C: "#9aa0a6",
};

export function ManaCurveChart({ deck }: { deck: DeckSnapshot }) {
  const data = manaCurve(deck).map((item) => ({ ...item, label: item.manaValue === 7 ? "7+" : String(item.manaValue) }));
  return <ChartFrame data={data} xKey="label" barKey="count" color="#58798d" />;
}

export function TypeBreakdownChart({ deck }: { deck: DeckSnapshot }) {
  const data = typeBreakdown(deck).filter((item) => item.count > 0);
  return <ChartFrame data={data} xKey="type" barKey="count" color="#8c6f54" />;
}

export function ColorPipChart({ deck }: { deck: DeckSnapshot }) {
  const data = colorIdentityBreakdown(deck).filter((item) => item.count > 0);
  return (
    <div className="mini-chart">
      <ResponsiveContainer width="100%" height={170}>
        <BarChart data={data}>
          <XAxis dataKey="color" tickLine={false} axisLine={false} />
          <YAxis allowDecimals={false} width={28} tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: "rgba(40, 48, 54, 0.08)" }} />
          <Bar dataKey="count" radius={[3, 3, 0, 0]}>
            {data.map((entry) => (
              <Cell key={entry.color} fill={COLOR_MAP[entry.color]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartFrame({
  data,
  xKey,
  barKey,
  color,
}: {
  data: Record<string, string | number>[];
  xKey: string;
  barKey: string;
  color: string;
}) {
  return (
    <div className="mini-chart">
      <ResponsiveContainer width="100%" height={170}>
        <BarChart data={data}>
          <XAxis dataKey={xKey} tickLine={false} axisLine={false} interval={0} fontSize={11} />
          <YAxis allowDecimals={false} width={28} tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: "rgba(40, 48, 54, 0.08)" }} />
          <Bar dataKey={barKey} fill={color} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
