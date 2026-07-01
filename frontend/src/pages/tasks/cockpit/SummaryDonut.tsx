import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import type { DailyRangeStatsResponse } from "../../../types";

/** 完成率颜色 */
export function rateColor(rate: number) {
  if (rate >= 95) return "#10b981";
  if (rate >= 80) return "#f59e0b";
  return "#ef4444";
}

/** 自定义环形图中心标签 */
function DonutCenter({ cx, cy, rate }: { cx?: number; cy?: number; rate: number }) {
  return (
    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
      <tspan x={cx} dy="-6" fontSize="26" fontWeight="700" fill={rateColor(rate)}>
        {rate.toFixed(1)}%
      </tspan>
      <tspan x={cx} dy="24" fontSize="12" fill="#94a3b8">
        今日完成率
      </tspan>
    </text>
  );
}

/** 历史待办完成率 - 汇总环形图 */
export function SummaryDonut({
  data,
  label,
  children,
}: {
  data: DailyRangeStatsResponse | null;
  label: string;
  children?: React.ReactNode;
}) {
  if (!data || data.summary.total === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5">
        <div className="w-[150px] h-[150px] flex items-center justify-center rounded-full border-[8px] border-slate-100 bg-slate-50">
          <span className="text-[13px] text-slate-300">暂无数据</span>
        </div>
        <span className="text-[13px] text-slate-400">{label}</span>
      </div>
    );
  }

  const { completed, total, completionRate, exemptions } = data.summary;
  const pending = Math.max(total - completed, 0);
  const exemptRate = total > 0 ? Math.round((exemptions / total) * 1000) / 10 : 0;
  const color = rateColor(completionRate);

  const pieData = [
    { name: "已完成", value: completed || 0, color: "#10b981" },
    { name: "未完成", value: pending || 1, color: "#e2e8f0" },
  ];

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div style={{ width: 150, height: 150 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={pieData}
              cx="50%"
              cy="50%"
              innerRadius={48}
              outerRadius={65}
              paddingAngle={2}
              dataKey="value"
              strokeWidth={0}
              isAnimationActive={true}
            >
              {pieData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Pie>
            <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle">
              <tspan x="50%" dy="-10" fontSize={26} fontWeight="800" fill={color}>
                {completionRate}%
              </tspan>
              <tspan x="50%" dy={18} fontSize={13} fill="#94a3b8">
                {label}
              </tspan>
            </text>
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[13px] text-slate-500 tabular-nums">
          <span className="text-emerald-500 font-bold">{completed}</span>
          /{total} 人次
        </span>
        {exemptRate > 0 && (
          <span className="text-[13px] text-violet-500 tabular-nums">豁免 {exemptRate}%</span>
        )}
      </div>

      {children}
    </div>
  );
}
