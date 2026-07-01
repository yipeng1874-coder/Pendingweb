import React, { useEffect, useRef, useState } from "react";

type Props = {
  icon: React.ReactNode;
  title: string;
  description: string;
  count: number;
  pendingCount: number;
  urgentCount: number;
  overdueCount: number;
  tone: string;
  emptyText: string;
  children: React.ReactNode;
  variant?: "section" | "column";
  className?: string;
  action?: React.ReactNode;
  hideDescription?: boolean;
  hideStats?: boolean;
  /** 空数据时将容器高度收缩到最小（仅保留标题栏），用于「隐藏空」模式 */
  compactEmpty?: boolean;
  /** KPI 点击联动高亮 */
  sectionKey?: string;
  isHighlighted?: boolean;
  highlightColor?: string;
  onHighlightDone?: () => void;
};

export function TaskDashboardSection({ icon, title, description, count, pendingCount, urgentCount, overdueCount, tone, emptyText, children, variant = "section", className = "", action, hideDescription = false, hideStats = false, compactEmpty = false, sectionKey, isHighlighted, highlightColor = "#3b82f6", onHighlightDone }: Props) {
  const isColumn = variant === "column";
  const isEmpty = count === 0;
  const sectionRef = useRef<HTMLElement>(null);
  const [highlightPhase, setHighlightPhase] = useState<"pulse" | "breathe" | null>(null);

  // 注入动画 keyframes（仅注入一次）
  useEffect(() => {
    const styleId = "kpi-pulse-keyframes";
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      @keyframes kpi-pulse-flash {
        0%, 100% { box-shadow: 0 0 0 0 var(--pulse-color, #3b82f6); }
        16%  { box-shadow: 0 0 0 3px var(--pulse-color, #3b82f6); }
        33%  { box-shadow: 0 0 0 8px transparent; }
        50%  { box-shadow: 0 0 0 3px var(--pulse-color, #3b82f6); }
        66%  { box-shadow: 0 0 0 8px transparent; }
        83%  { box-shadow: 0 0 0 3px var(--pulse-color, #3b82f6); }
      }
      @keyframes kpi-breathe {
        0%, 100% { box-shadow: 0 0 0 2px var(--pulse-color, #3b82f6); }
        50%      { box-shadow: 0 0 0 10px transparent; }
      }
    `;
    document.head.appendChild(style);
  }, []);

  useEffect(() => {
    if (isHighlighted) {
      // 先滚动到视图中央
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      // 阶段1：滚动到位后脉冲闪烁 0.9s
      const t1 = setTimeout(() => setHighlightPhase("pulse"), 400);
      // 阶段2：脉冲结束后呼吸辉光 2.5s
      const t2 = setTimeout(() => setHighlightPhase("breathe"), 400 + 900);
      // 全部结束后清除
      const t3 = setTimeout(() => {
        setHighlightPhase(null);
        onHighlightDone?.();
      }, 400 + 900 + 2500);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }
  }, [isHighlighted, onHighlightDone]);

  const animClass =
    highlightPhase === "pulse"
      ? "animate-[kpi-pulse-flash_0.9s_ease-in-out]"
      : highlightPhase === "breathe"
        ? "animate-[kpi-breathe_2.5s_ease-in-out]"
        : "";

  return (
    <section
      ref={sectionRef}
      data-section-key={sectionKey}
      className={`border bg-white/95 shadow-[0_8px_24px_rgba(15,23,42,0.035)] transition-all duration-300 ${isColumn ? "flex max-h-[calc(100vh-238px)] min-h-0 flex-col rounded-2xl border-slate-200/70" : "rounded-[28px] border-slate-100 p-4"} ${isEmpty && compactEmpty ? "overflow-hidden" : ""} ${animClass} ${className}`}
      style={highlightPhase ? ({ "--pulse-color": highlightColor } as React.CSSProperties) : undefined}
    >
      <div className={`${isColumn ? "border-b border-slate-200 bg-slate-100 px-3 py-2.5" : "mb-4 flex flex-wrap items-start justify-between gap-3 rounded-t-[28px] bg-slate-100 -mx-4 -mt-4 px-4 pt-3 pb-3"}`}>
        <div className="flex min-w-0 items-center gap-2.5">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${tone}`}>{icon}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-semibold text-slate-900">{title}</h2>
              <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-500">{count}</span>
              {action && <div className="ml-auto shrink-0">{action}</div>}
            </div>
            {!hideDescription && <p className={`mt-0.5 text-[11px] leading-4 text-slate-400 ${isColumn ? "truncate" : ""}`}>{description}</p>}
          </div>
        </div>
        {!hideStats && (
          <div className={`${isColumn ? "mt-2 grid grid-cols-3 gap-1.5" : "flex flex-wrap gap-2 text-xs"}`}>
            <span className="rounded-lg bg-slate-50 px-2 py-1 text-center text-[11px] font-medium text-slate-500">未 {pendingCount}</span>
            <span className={`rounded-lg px-2 py-1 text-center text-[11px] font-medium ${urgentCount > 0 ? "bg-amber-50 text-amber-600" : "bg-slate-50 text-slate-300"}`}>近 {urgentCount}</span>
            <span className={`rounded-lg px-2 py-1 text-center text-[11px] font-medium ${overdueCount > 0 ? "bg-red-50 text-red-600" : "bg-slate-50 text-slate-300"}`}>逾 {overdueCount}</span>
          </div>
        )}
      </div>
      {isEmpty ? (
        <div className={`m-2 flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 text-center text-slate-400 ${compactEmpty ? "min-h-[40px] py-1.5 opacity-60" : "min-h-[180px] py-10"}`}>
          {!compactEmpty && <div className="mb-2 text-slate-300">{icon}</div>}
          <p className={`text-xs ${compactEmpty ? "text-[10px]" : ""}`}>{emptyText}</p>
        </div>
      ) : (
        <div className={`${isColumn ? "custom-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto p-2" : "space-y-3"}`}>{children}</div>
      )}
    </section>
  );
}
