import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { WaveTypeTrend } from "../../../services/task";

/** 人均音浪趋势浮层（三条折线：线下人均音浪 / 线上人均音浪 / 人均音浪） */
export function WaveTrendPopover({
  online,
  offline,
  total,
  cardRef,
}: {
  online: WaveTypeTrend;
  offline: WaveTypeTrend;
  total: WaveTypeTrend;
  cardRef: React.RefObject<HTMLDivElement>;
}) {
  const POPOVER_WIDTH = 460;
  const GAP = 12;
  const rect = cardRef.current?.getBoundingClientRect();
  if (!rect) return null;
  const VIEWPORT_W = typeof window !== "undefined" ? window.innerWidth : 1440;
  const showOnRight = VIEWPORT_W - rect.right >= POPOVER_WIDTH + GAP;
  const top = rect.top;
  const left = showOnRight ? rect.right + GAP : Math.max(12, rect.left - POPOVER_WIDTH - GAP);

  // 汇总日期：取 online + offline + total 所有点的并集排序
  const dateSet = new Set<string>();
  online.points.forEach((p) => dateSet.add(p.recordDate));
  offline.points.forEach((p) => dateSet.add(p.recordDate));
  total.points.forEach((p) => dateSet.add(p.recordDate));
  const dates = Array.from(dateSet).sort();
  const onlineMap = new Map(online.points.map((p) => [p.recordDate, p.avgWaveValue]));
  const offlineMap = new Map(offline.points.map((p) => [p.recordDate, p.avgWaveValue]));
  const totalMap = new Map(total.points.map((p) => [p.recordDate, p.avgWaveValue]));

  const chartData = dates.map((d) => {
    const dt = new Date(d + "T00:00:00");
    return {
      date: `${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`,
      fullDate: d,
      offline: offlineMap.get(d) ?? null,
      online: onlineMap.get(d) ?? null,
      total: totalMap.get(d) ?? null,
    };
  });

  const offLatest = offline.latest?.avgWaveValue ?? 0;
  const onLatest = online.latest?.avgWaveValue ?? 0;
  const totalLatest = total.latest?.avgWaveValue ?? 0;

  return (
    <div
      className="fixed z-50 rounded-xl bg-white border-2 border-slate-300 overflow-hidden"
      style={{
        top,
        left,
        width: POPOVER_WIDTH,
        boxShadow: "0 12px 32px rgba(15, 23, 42, 0.18)",
      }}
    >
      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-200 bg-slate-50">
        <span className="text-[13px] font-semibold text-slate-700">人均音浪 · 近 7 天趋势</span>
        <div className="ml-auto flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500" />线下人均音浪</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />线上人均音浪</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />人均音浪</span>
        </div>
      </div>
      <div className="px-3 py-3">
        {chartData.length === 0 ? (
          <div className="py-8 text-center text-[12px] text-slate-400">暂无数据</div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} width={32} />
              <Tooltip
                contentStyle={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid #e2e8f0" }}
                formatter={(v: any, name: any) => v == null ? ["-", name] : [`${Number(v).toFixed(2)} 万`, name]}
              />
              <Line type="monotone" dataKey="offline" name="线下人均音浪" stroke="#ef4444" strokeWidth={2} dot={{ r: 3, fill: "#ef4444" }} connectNulls />
              <Line type="monotone" dataKey="online" name="线上人均音浪" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: "#f59e0b" }} connectNulls />
              <Line type="monotone" dataKey="total" name="人均音浪" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: "#10b981" }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        )}
        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 px-1">
          <span>线下 <b className="text-red-500">{offLatest.toFixed(2)}</b> 万</span>
          <span>线上 <b className="text-amber-600">{onLatest.toFixed(2)}</b> 万</span>
          <span>人均 <b className="text-emerald-600">{totalLatest.toFixed(2)}</b> 万</span>
        </div>
      </div>
    </div>
  );
}
