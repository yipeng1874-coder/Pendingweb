/** KPI 小卡片 */
export function KpiCard({
  icon,
  label,
  value,
  colorClass,
  bgClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  colorClass: string;
  bgClass: string;
}) {
  return (
    <div className="flex flex-1 min-w-0 items-center gap-3 rounded-xl border border-slate-100 bg-white px-4 py-4 shadow-sm">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${bgClass}`}>
        <span className={colorClass}>{icon}</span>
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-slate-400 leading-none mb-1">{label}</p>
        <p className={`text-[28px] font-bold leading-none tabular-nums ${colorClass}`}>{value}</p>
      </div>
    </div>
  );
}

/** 主播运营 KPI 卡片（含较昨日变化量，支持三值模式） */
export function AnchorLiveKpiCard({
  icon,
  label,
  value,
  unit,
  change,
  changeLabel = "较昨日",
  iconColor,
  iconBg,
  secondaryChange,
  secondaryLabel,
  trendChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  unit: string;
  change: number;
  changeLabel?: string;
  iconColor: string;
  iconBg: string;
  secondaryChange?: number;
  secondaryLabel?: string;
  trendChange?: number;
}) {
  const isUp = change >= 0;
  return (
    <div className="flex flex-1 min-w-0 items-center gap-3 rounded-xl border border-slate-100 bg-white px-4 py-4 shadow-sm">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
        <span className={iconColor}>{icon}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-slate-400 leading-none mb-1">{label}</p>
        <div className="flex items-baseline gap-1">
          {typeof value === "string" && value.includes(" / ") ? (
            <>
              <p className="text-[30px] font-bold leading-none tabular-nums text-slate-700">{value.split(" / ")[0]}</p>
              <span className="text-[30px] font-bold leading-none text-slate-400 mx-0.5">/</span>
              <p className="text-[22px] font-semibold leading-none tabular-nums text-slate-500">{value.split(" / ")[1]}</p>
              <span className="text-[13px] text-slate-500">{unit}</span>
            </>
          ) : (
            <>
              <p className="text-[30px] font-bold leading-none tabular-nums text-slate-700">{value}</p>
              {trendChange !== undefined && trendChange !== 0 && (
                <span className={`text-[18px] font-bold leading-none tabular-nums ml-0.5 ${
                  trendChange >= 0 ? 'text-emerald-700' : 'text-red-600'
                }`}>
                  {trendChange >= 0 ? '↑' : '↓'}{Math.abs(trendChange).toFixed(1)}
                </span>
              )}
              <span className="text-[13px] text-slate-500">{unit}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end self-end pb-0.5 gap-0.5">
        {secondaryChange !== undefined && secondaryLabel ? (
          <div className="flex items-baseline gap-0.5 whitespace-nowrap">
            <span className="text-[13px] text-slate-500">{changeLabel}</span>
            <span className="text-[15px] font-bold tabular-nums text-slate-800">
              {change}
            </span>
            <span className="text-[12px] text-slate-300 mx-0.5">·</span>
            <span className="text-[13px] text-slate-500">{secondaryLabel}</span>
            <span className="text-[15px] font-bold tabular-nums text-slate-800">
              {secondaryChange}
            </span>
          </div>
        ) : (
          <div className="flex items-baseline">
            <span className="text-[11px] text-slate-400 mr-0.5">{changeLabel}</span>
            <span className={`text-[14px] font-semibold tabular-nums ${isUp ? "text-emerald-600" : "text-red-500"}`}>
              {isUp ? "↑" : "↓"}{Math.abs(change)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
