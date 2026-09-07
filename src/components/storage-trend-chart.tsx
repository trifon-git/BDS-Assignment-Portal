"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatDate } from "@/lib/format";

export interface StoragePoint {
  day: number;
  cumulativeBytes: number;
}

// Duplicated from src/lib/storage.ts rather than imported: that module is
// "server-only" (it also touches the filesystem), and this chart is a client
// component.
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Cumulative storage use over the semester. A single series needs no legend. */
export function StorageTrendChart({ data }: { data: StoragePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--color-border)" />
        <XAxis
          dataKey="day"
          tickFormatter={(ms: number) => formatDate(ms)}
          tickLine={false}
          axisLine={false}
          fontSize={12}
        />
        <YAxis
          tickFormatter={(bytes: number) => formatBytes(bytes)}
          tickLine={false}
          axisLine={false}
          fontSize={12}
          width={64}
        />
        <Tooltip
          formatter={(value) => formatBytes(Number(value))}
          labelFormatter={(label) => formatDate(Number(label))}
        />
        <Area
          type="monotone"
          dataKey="cumulativeBytes"
          stroke="var(--color-chart-1)"
          fill="var(--color-chart-1)"
          fillOpacity={0.2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
