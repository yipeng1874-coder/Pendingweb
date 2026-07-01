import type { HallOperatorStat } from "../../../services/task";

/** 厅个数运营明细浮层（悬停显示，固定在悬停卡片左侧） */
export function HallOperatorPopover({
  field,
  recordDate,
  operators,
  prevDayOperators,
  cardRef,
}: {
  field: "formal" | "training";
  recordDate: string;
  operators: HallOperatorStat[];
  prevDayOperators: HallOperatorStat[];
  cardRef: React.RefObject<HTMLDivElement>;
}) {
  // 昨日数据映射表（key = operator name）
  const prevMap = new Map(prevDayOperators.map((o) => [o.operator, o]));

  // 根据悬停字段选择排序键
  const sorted = [...operators].sort((a, b) => {
    if (field === "formal") return b.formalHallCount - a.formalHallCount;
    return b.trainingHallCount - a.trainingHallCount;
  });

  // 计算该字段的总和（用于占比分母）
  const total = sorted.reduce(
    (sum, op) => sum + (field === "formal" ? op.formalHallCount : op.trainingHallCount),
    0
  );

  const titleMap: Record<"formal" | "training", string> = {
    formal: "正式厅 · 按运营占比排序",
    training: "训练厅 · 按运营占比排序",
  };

  // 浮层宽度
  const POPOVER_WIDTH = 360;
  const GAP = 12;
  const VIEWPORT_WIDTH = typeof window !== "undefined" ? window.innerWidth : 1440;

  // 取卡片位置（若 ref 不可用则隐藏）
  const rect = cardRef.current?.getBoundingClientRect();
  if (!rect) return null;
  const top = rect.top;

  // 智能选择浮层位置：默认显示在卡片右侧；若右侧空间不足则显示在左侧
  const spaceOnRight = VIEWPORT_WIDTH - rect.right;
  const showOnRight = spaceOnRight >= POPOVER_WIDTH + GAP;
  const left = showOnRight
    ? rect.right + GAP
    : Math.max(12, rect.left - POPOVER_WIDTH - GAP);

  return (
    <div
      className="fixed z-50 rounded-xl bg-white overflow-hidden border-2 border-slate-300"
      style={{
        top,
        left,
        width: POPOVER_WIDTH,
        boxShadow: "0 12px 32px rgba(15, 23, 42, 0.18)",
      }}
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-slate-700">{titleMap[field]}</span>
          <span className="text-[11px] text-slate-500">
            归属日期 {recordDate || "--"} · 共 {operators.length} 个运营
          </span>
        </div>
      </div>

      {/* 表头 */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border-b border-slate-100">
        <span className="flex-1 text-[10px] font-medium text-slate-400 uppercase">运营</span>
        <span className="w-[76px] text-[10px] font-medium text-slate-400 text-right">占比</span>
        <span className="w-[28px] text-[10px] font-medium text-slate-400 text-right">数量</span>
        <span className="w-[40px] text-[10px] font-medium text-slate-400 text-right">较昨日</span>
      </div>

      <div className="max-h-[320px] overflow-y-auto divide-y divide-slate-100">
        {sorted.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-[12px] text-slate-400 mb-2">暂无运营明细</p>
            <p className="text-[11px] text-slate-300">请点击右上角「上传数据看板」录入每日快照</p>
          </div>
        ) : (
          sorted.map((op) => {
            const count = field === "formal" ? op.formalHallCount : op.trainingHallCount;
            const pct = total > 0 ? (count / total) * 100 : 0;

            // 较昨日变化
            const prevOp = prevMap.get(op.operator);
            const prevCount = prevOp ? (field === "formal" ? prevOp.formalHallCount : prevOp.trainingHallCount) : null;
            const diff = prevCount !== null ? count - prevCount : null;

            return (
              <div key={op.operator} className="flex items-center gap-2 px-3 py-2">
                <span className="flex-1 text-[12px] text-slate-700 truncate min-w-0">{op.operator}</span>
                <div className="flex items-center gap-1 w-[76px]">
                  <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden min-w-0">
                    <div
                      className={`h-full ${field === "formal" ? "bg-blue-500" : "bg-emerald-500"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-slate-400 tabular-nums w-[28px] text-right">
                    {pct.toFixed(0)}%
                  </span>
                </div>
                <span className="text-[13px] font-semibold text-slate-700 tabular-nums w-[28px] text-right">
                  {count}
                </span>
                <span className={`text-[12px] font-semibold tabular-nums w-[40px] text-right ${
                  diff === null ? "text-slate-300" : diff > 0 ? "text-emerald-600" : diff < 0 ? "text-red-500" : "text-slate-400"
                }`}>
                  {diff === null ? "--" : diff === 0 ? "0" : diff > 0 ? `+${diff}` : `${diff}`}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
