"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface WeeklyTrendPoint {
  assignmentId: number;
  label: string;
  onTime: number;
  late: number;
  rework: number;
  missing: number;
}

/** Stacked delivery outcome per published assignment, oldest first. */
export function WeeklyTrendChart({ data }: { data: WeeklyTrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--color-border)" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
        <Tooltip cursor={{ fill: "var(--color-muted)" }} />
        <Legend />
        <Bar
          dataKey="onTime"
          stackId="s"
          name="On time"
          fill="var(--color-status-delivered)"
        />
        <Bar dataKey="late" stackId="s" name="Late" fill="var(--color-status-late)" />
        <Bar
          dataKey="rework"
          stackId="s"
          name="Needs rework"
          fill="var(--color-status-rework)"
        />
        <Bar
          dataKey="missing"
          stackId="s"
          name="Missing"
          fill="var(--color-status-missing)"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
