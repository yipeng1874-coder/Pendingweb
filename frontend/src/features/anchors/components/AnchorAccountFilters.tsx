import { Download, History, Search } from "lucide-react";

interface AnchorAccountFiltersProps {
  keyword: string;
  setKeyword: (val: string) => void;
  status: string;
  setStatus: (val: string) => void;
  onRefresh: () => void;
  onExport: () => void;
  onOpenExportTasks: () => void;
  exporting?: boolean;
  canExport?: boolean;
  pendingExportCount?: number;
}

export function AnchorAccountFilters({
  keyword,
  setKeyword,
  status,
  setStatus,
  onRefresh,
  onExport,
  onOpenExportTasks,
  exporting = false,
  canExport = true,
  pendingExportCount = 0,
}: AnchorAccountFiltersProps) {
  return (
    <div className="grid gap-3 md:grid-cols-[220px_140px_auto_auto_auto]">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input
          className="w-full rounded-2xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-feishu-blue"
          placeholder="昵称/抖音号/UID/手机号"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
      </div>
      <select
        className="rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-feishu-blue"
        value={status}
        onChange={(event) => setStatus(event.target.value)}
      >
        <option value="">全部状态</option>
        <option value="bound">使用中</option>
        <option value="unbound">未绑定</option>
        <option value="inactive">已停用</option>
      </select>
      <button
        className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-600"
        onClick={onRefresh}
      >
        刷新
      </button>
      <button
        className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:border-feishu-blue hover:text-feishu-blue disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
        onClick={onExport}
        disabled={!canExport || exporting}
        title={canExport ? "导出当前筛选结果为 CSV" : "请先选择左侧组织"}
      >
        <Download size={14} />
        {exporting ? "导出中…" : "导出"}
      </button>
      <button
        className="relative inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:border-feishu-blue hover:text-feishu-blue transition-colors"
        onClick={onOpenExportTasks}
        title="查看导出记录"
      >
        <History size={14} />
        导出记录
        {pendingExportCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-feishu-blue text-[10px] font-bold text-white">
            {pendingExportCount}
          </span>
        )}
      </button>
    </div>
  );
}
