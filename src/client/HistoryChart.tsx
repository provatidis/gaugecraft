import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HistoryPoint } from "../shared/types.js";
import { date, money, number, pct } from "./format.js";

export default function HistoryChart({
  history,
  metric,
  label,
  days,
}: {
  history: (HistoryPoint | Pick<HistoryPoint, "observedAt">)[];
  metric: keyof HistoryPoint;
  label: string;
  days: number;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={history}
        margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
      >
        <CartesianGrid
          vertical={false}
          stroke="var(--line)"
          strokeDasharray="3 4"
        />
        <XAxis
          dataKey="observedAt"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(t) =>
            new Date(Number(t) * 1000)
              .toISOString()
              .slice(days > 2 ? 5 : 11, days > 2 ? 10 : 16)
          }
          tick={{ fontSize: 11, fill: "var(--muted)" }}
          axisLine={{ stroke: "var(--line)" }}
          tickLine={{ stroke: "var(--line)" }}
          minTickGap={60}
        />
        <YAxis
          width={58}
          tickFormatter={(v) => number(Number(v), true)}
          tick={{ fontSize: 11, fill: "var(--muted)" }}
          axisLine={{ stroke: "var(--line)" }}
          tickLine={{ stroke: "var(--line)" }}
          domain={
            metric === "stakeApr" || metric === "allocation"
              ? ["auto", "auto"]
              : [0, "auto"]
          }
        />
        <Tooltip
          cursor={{ stroke: "var(--muted)" }}
          labelStyle={{ color: "var(--foreground)" }}
          itemStyle={{ color: "var(--foreground)" }}
          labelFormatter={(t) => date(Number(t))}
          formatter={(v) =>
            metric === "stakeApr"
              ? pct(Number(v))
              : metric === "allocation"
                ? number(Number(v))
                : money(Number(v))
          }
          contentStyle={{
            fontSize: 12,
            borderRadius: 8,
            border: "1px solid var(--control-border)",
            background: "var(--surface)",
            color: "var(--foreground)",
          }}
        />
        <Line
          type="linear"
          dataKey={metric}
          name={label}
          stroke="var(--accent)"
          strokeWidth={2}
          dot={history.length < 6 ? { r: 3 } : false}
          activeDot={{ r: 4 }}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
