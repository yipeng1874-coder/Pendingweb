import { LineChart, Line, XAxis, YAxis, LabelList, ResponsiveContainer } from "recharts";

/** 近30天主播流失 - 7日每日流失折线图浮层 */
export function LossTrendPopover({
  lossDetail,
  lossOperatorDetail,
  anchorDate,
  cardRef,
}: {
  lossDetail: Record<string, number>;
  lossOperatorDetail: Record<string, Record<string, number>>;
  anchorDate: string;
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

  const chartData: { date: string; loss: number; fullDate: string; ops: Record<string, number> }[] = [];
  if (anchorDate) {
    for (let i = 6; i >= 0; i--) {
      const dt = new Date(anchorDate + "T00:00:00");
      dt.setDate(dt.getDate() - i);
      const y = dt.getFullYear(), m = dt.getMonth() + 1, d = dt.getDate();
      const fullDate = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      chartData.push({
        date: `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
        loss: lossDetail[fullDate] || 0,
        fullDate,
        ops: lossOperatorDetail[fullDate] || {},
      });
    }
  }
  const total = chartData.reduce((s, p) => s + p.loss, 0);
  const hasData = chartData.some(p => p.loss > 0);

  return (
    <div
      className="fixed z-50 rounded-xl bg-white border-2 border-red-200"
      style={{ top, left, width: POPOVER_WIDTH, boxShadow: "0 12px 32px rgba(15, 23, 42, 0.18)" }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-red-50">
        <span className="text-[13px] font-semibold text-slate-700">近7日每日流失趋势</span>
        <span className="text-[11px] text-red-500 font-medium">7天合计 {total} 人</span>
      </div>
      <div className="px-2 py-1">
        {!hasData ? (
          <div className="h-[140px] flex items-center justify-center text-[12px] text-slate-400">暂无数据</div>
        ) : (
          <div className="h-[120px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 18, right: 12, bottom: 8, left: 0 }}>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={24} allowDecimals={false} />
                <Line type="monotone" dataKey="loss" stroke="#ef4444" strokeWidth={2} dot={{ r: 3, fill: "#ef4444" }} activeDot={{ r: 5 }}>
                  <LabelList dataKey="loss" position="top" fill="#ef4444" fontSize={10} fontWeight={600} />
                </Line>
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      {hasData && (
        <div className="border-t border-slate-200 max-h-[180px] overflow-y-auto">
          {chartData.filter(p => p.loss > 0).map(p => {
            const ops = Object.entries(p.ops).sort((a, b) => (b[1] as number) - (a[1] as number));
            return (
              <div key={p.fullDate} className="px-3 py-1.5 border-b border-slate-100 last:border-b-0">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-slate-500 tabular-nums">{p.fullDate}</span>
                  <span className="font-semibold text-red-500 tabular-nums">{p.loss} 人</span>
                </div>
                {ops.length > 0 && (
                  <div className="mt-1 pl-2 space-y-0.5">
                    {ops.map(([op, n]) => (
                      <div key={op} className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-600">{op}</span>
                        <span className="text-slate-500 tabular-nums">{n as number} 人</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
