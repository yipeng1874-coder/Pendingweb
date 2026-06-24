import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, X, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { anchorApi } from "../api";

type ExportTask = {
  id: string;
  status: "pending" | "processing" | "done" | "failed";
  rowCount: number | null;
  filePath: string | null;
  errorMsg: string | null;
  createdAt: string;
  expiresAt: string;
  params: Record<string, string>;
};

interface ExportTasksModalProps {
  onClose: () => void;
  onToast: (msg: { text: string; type: "success" | "error" }) => void;
}

function StatusBadge({ status }: { status: ExportTask["status"] }) {
  if (status === "done")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 size={11} /> 已完成
      </span>
    );
  if (status === "failed")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
        <AlertCircle size={11} /> 失败
      </span>
    );
  if (status === "processing")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
        <Loader2 size={11} className="animate-spin" /> 处理中
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
      <Clock size={11} /> 排队中
    </span>
  );
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatExpires(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function ExportTasksModal({ onClose, onToast }: ExportTasksModalProps) {
  const [tasks, setTasks] = useState<ExportTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await anchorApi.listExportTasks();
      setTasks(list);
    } catch {
      /* 静默 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 有进行中任务时轮询
  useEffect(() => {
    const hasPending = tasks.some((t) => t.status === "pending" || t.status === "processing");
    if (hasPending) {
      pollRef.current = setTimeout(() => void load(), 3000);
    }
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [tasks, load]);

  // 锁定背景滚动
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  async function handleDownload(task: ExportTask) {
    const date = new Date(task.createdAt).toISOString().slice(0, 10).replace(/-/g, "");
    const orgId = (task.params as Record<string, string>).orgId ?? "unknown";
    const filename = `主播账号导出_${orgId.slice(-6)}_${date}.csv`;
    setDownloading(task.id);
    try {
      await anchorApi.downloadExportTaskFile(task.id, filename);
    } catch (err) {
      onToast({ text: err instanceof Error ? err.message : "下载失败，请重试", type: "error" });
    } finally {
      setDownloading(null);
    }
  }

  return (
    <>
      {/* 遮罩 */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* 弹窗 */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-xl rounded-3xl bg-white shadow-2xl flex flex-col max-h-[80vh]">
          {/* 头部 */}
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-base font-semibold text-slate-900">导出记录</h3>
              <p className="text-xs text-slate-400 mt-0.5">CSV 文件 7 天内有效，过期后自动删除</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
            >
              <X size={18} />
            </button>
          </div>

          {/* 内容 */}
          <div className="overflow-y-auto flex-1 px-6 py-4">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-slate-400 gap-2">
                <Loader2 size={18} className="animate-spin" />
                <span className="text-sm">加载中…</span>
              </div>
            ) : tasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-slate-400 gap-2">
                <Download size={32} strokeWidth={1.2} />
                <span className="text-sm">暂无导出记录</span>
                <span className="text-xs text-slate-300">点击"导出"按钮创建一条导出任务</span>
              </div>
            ) : (
              <div className="space-y-3">
                {tasks.map((task) => {
                  const isExpired = new Date(task.expiresAt) < new Date();
                  return (
                    <div
                      key={task.id}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <StatusBadge status={task.status} />
                          {task.status === "done" && task.rowCount != null && (
                            <span className="text-xs text-slate-500">{task.rowCount} 条</span>
                          )}
                          {task.status === "done" && isExpired && (
                            <span className="text-xs text-red-400">已过期</span>
                          )}
                          {task.status === "done" && !isExpired && (
                            <span className="text-xs text-slate-400">有效期至 {formatExpires(task.expiresAt)} 日</span>
                          )}
                          {task.status === "failed" && task.errorMsg && (
                            <span className="text-xs text-red-400 truncate max-w-[160px]" title={task.errorMsg}>
                              {task.errorMsg}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-slate-400">{formatTime(task.createdAt)}</p>
                      </div>
                      {task.status === "done" && !isExpired && (
                        <button
                          type="button"
                          onClick={() => handleDownload(task)}
                          disabled={downloading === task.id}
                          className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-feishu-blue px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 transition"
                        >
                          {downloading === task.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Download size={12} />
                          )}
                          下载
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
