"use client";

import { useMemo, useState } from "react";
import { Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend } from "chart.js";
import { Line } from "react-chartjs-2";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

type UsageSeriesPoint = { tokens: number; usd: number };

type Usage = {
  hourly?: Array<{ hour_start_utc: string } & UsageSeriesPoint>;
  daily?: Array<{ day_start_utc: string } & UsageSeriesPoint>;
  weekly?: Array<{ week_start_utc: string } & UsageSeriesPoint>;
};

type Granularity = "hourly" | "daily" | "weekly";

function formatLabel(granularity: Granularity, iso: string) {
  const d = new Date(iso);
  if (granularity === "hourly") return `${String(d.getUTCHours()).padStart(2, "0")}:00`;
  if (granularity === "daily") return `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return d.toISOString().slice(0, 10);
}

export function UsageCharts({ usage }: { usage: Usage | null | undefined }) {
  const [granularity, setGranularity] = useState<Granularity>("daily");

  const series = useMemo(() => {
    if (!usage) return [];
    if (granularity === "hourly") return (usage.hourly || []).map((p) => ({ ts: p.hour_start_utc, tokens: p.tokens, usd: p.usd }));
    if (granularity === "weekly") return (usage.weekly || []).map((p) => ({ ts: p.week_start_utc, tokens: p.tokens, usd: p.usd }));
    return (usage.daily || []).map((p) => ({ ts: p.day_start_utc, tokens: p.tokens, usd: p.usd }));
  }, [usage, granularity]);

  const labels = useMemo(() => series.map((p) => formatLabel(granularity, p.ts)), [series, granularity]);
  const data = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: "Tokens",
          data: series.map((p) => p.tokens),
          borderColor: "rgba(148, 163, 184, 0.9)",
          backgroundColor: "rgba(148, 163, 184, 0.15)",
          tension: 0.25,
          pointRadius: 0,
          yAxisID: "yTokens",
        },
        {
          label: "AI cost (USD)",
          data: series.map((p) => Number(p.usd || 0)),
          borderColor: "rgba(52, 211, 153, 0.95)",
          backgroundColor: "rgba(52, 211, 153, 0.12)",
          tension: 0.25,
          pointRadius: 0,
          yAxisID: "yUsd",
        },
      ],
    }),
    [labels, series]
  );

  return (
    <Card>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-sm text-slate-600">Usage charts</div>
          <div className="mt-1 text-lg font-medium text-[color:var(--app-text)]">Tokens + AI cost over time (UTC)</div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={granularity === "hourly" ? "secondary" : "ghost"} size="sm" onClick={() => setGranularity("hourly")}>
            24h
          </Button>
          <Button variant={granularity === "daily" ? "secondary" : "ghost"} size="sm" onClick={() => setGranularity("daily")}>
            30d
          </Button>
          <Button variant={granularity === "weekly" ? "secondary" : "ghost"} size="sm" onClick={() => setGranularity("weekly")}>
            12w
          </Button>
        </div>
      </div>

      <div className="mt-4 h-[260px]">
        <Line
          data={data}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
              legend: { labels: { color: "rgba(28,28,30,0.7)" } },
              tooltip: { enabled: true },
            },
            scales: {
              x: { ticks: { color: "rgba(28,28,30,0.55)" }, grid: { color: "rgba(28,28,30,0.08)" } },
              yTokens: {
                position: "left",
                ticks: { color: "rgba(28,28,30,0.55)" },
                grid: { color: "rgba(28,28,30,0.08)" },
              },
              yUsd: {
                position: "right",
                ticks: { color: "rgba(28,28,30,0.55)" },
                grid: { drawOnChartArea: false },
              },
            },
          }}
        />
      </div>

      {!usage ? <div className="mt-3 text-xs text-slate-500">Set your key and refresh to load usage.</div> : null}
    </Card>
  );
}
