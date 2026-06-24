import { useEffect, useRef, useState } from "react";
import { Users, Upload, RefreshCw, Calendar, User } from "lucide-react";
import { anchorSummaryApi, type AnchorDailySummary, type OperatorStat } from "../../../services/task";
import { useIdentityStore } from "../../../stores/identityStore";
import { Toast } from "../../../shared/components/Toast";

interface Props {
  scopeOrgId?: string;
}

export function AnchorSummaryCard({ scopeOrgId }: Props) {
  const { currentIdentity } = useIdentityStore();
  const [summary, setSummary] = useState<AnchorDailySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 只有 BASE_ADMIN 以上才能上传
  const canUpload =
    currentIdentity &&
    ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN"].includes(currentIdentity.roleCode);

  const load = (sid?: string) => {
    setLoading(true);
    setError(null);
    anchorSummaryApi
      .getLatest(sid ?? scopeOrgId)
      .then((data) => setSummary(data))
      .catch((e) => setError(e?.message ?? "加载失败"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeOrgId]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 重置 input 以允许再次上传同名文件
    e.target.value = "";
    setUploading(true);
    setError(null);
    try {
      const result = await anchorSummaryApi.upload(file, scopeOrgId);
      setSummary(result);
      setToast({ message: "上传成功，数据已更新", type: "success" });
    } catch (err: any) {
      const msg = err?.message ?? "上传失败";
      setError(msg);
      setToast({ message: msg, type: "error" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          duration={toast.type === "error" ? 5000 : 3000}
          onClose={() => setToast(null)}
        />
      )}
    <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
      {/* 标题行 */}
      <div className="flex items-center gap-3 px-5 h-14 border-b border-slate-100">
        {/* 左：图标 + 标题（第一行）+ 日期/上传者（第二行） */}
        <div className="flex items-center gap-2 shrink-0">
          <Users size={16} className="text-feishu-blue shrink-0" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[14px] font-semibold text-slate-700 leading-none">
              {summary?.baseOrgName
                ? `${summary.baseOrgName} · 主播汇总`
                : "基地主播汇总"}
            </span>
            {summary && (
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 text-[11px] text-slate-400">
                  <Calendar size={10} />
                  {summary.uploadDate}
                </span>
                <span className="flex items-center gap-1 text-[11px] text-slate-400">
                  <User size={10} />
                  {summary.uploaderName}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* 中：合计数据一行（flex-1 撑开） */}
        {summary && (
          <div className="flex items-center gap-x-3 flex-1 justify-center">
            <StatItem label="合计" value={summary.totalCount} color="text-slate-700" small />
            <StatItem label="线上" value={summary.onlineCount} color="text-emerald-600" small />
            <StatItem label="线下" value={summary.offlineCount} color="text-slate-400" small />
            <div className="h-3 w-px bg-slate-200" />
            <StatItem label="7天内" value={summary.within7Days} color="text-amber-600" small />
            <StatItem label="30天内" value={summary.within30Days} color="text-blue-500" small />
          </div>
        )}

        {/* 右：错误提示 + 图标按钮 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {error && <span className="text-[11px] text-red-500 mr-1">{error}</span>}
          <button
            onClick={() => load()}
            disabled={loading}
            title="刷新"
            className="flex items-center justify-center w-7 h-7 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
          {canUpload && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title="上传表格"
                className="flex items-center justify-center w-7 h-7 rounded-lg bg-feishu-blue text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                <Upload size={13} className={uploading ? "animate-pulse" : ""} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 内容区 */}
      {loading && !summary ? (
        // Skeleton
        <div className="space-y-0 divide-y divide-slate-50">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="px-5 py-4">
              <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
            </div>
          ))}
        </div>
      ) : !summary ? (
        <div className="flex flex-col items-center justify-center py-14 text-slate-400 gap-2">
          <Users size={32} className="text-slate-200" />
          <p className="text-[13px]">暂无数据，请上传主播信息表</p>
        </div>
      ) : (
        <div>
          {/* 运营明细（全部展开，无折叠） */}
          <div className="divide-y divide-slate-50">
            {(summary.operatorStats as OperatorStat[]).map((op) => (
              <OperatorRow key={op.name} op={op} />
            ))}
          </div>
        </div>
      )}
    </div>
    </>
  );
}

function StatItem({
  label,
  value,
  color,
  small,
}: {
  label: string;
  value: number;
  color: string;
  small?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-0.5">
      <span className={`${small ? "text-[10px]" : "text-[11px]"} text-slate-400`}>{label}</span>
      <span className={`${small ? "text-[13px]" : "text-[18px]"} font-bold tabular-nums leading-none ${color}`}>{value}</span>
    </div>
  );
}

function OperatorRow({ op }: { op: OperatorStat }) {
  const total = op.onlineCount + op.offlineCount;
  const onlinePct = total > 0 ? Math.round((op.onlineCount / total) * 100) : 0;
  const offlinePct = total > 0 ? 100 - onlinePct : 0;

  return (
    <div className="flex items-center gap-3 px-5 h-11 hover:bg-slate-50 transition-colors overflow-hidden">
      {/* 运营名 */}
      <span className="w-16 shrink-0 text-[13px] font-medium text-slate-600 truncate" title={op.name}>
        {op.name}
      </span>

      {/* PK 进度条（撑开中间） */}
      {total > 0 ? (
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="text-[11px] text-red-400 tabular-nums shrink-0 whitespace-nowrap">线下 {offlinePct}%</span>
          <div className="flex-1 h-1.5 rounded-full overflow-hidden flex min-w-0">
            <div
              className="h-full bg-gradient-to-r from-red-400 to-red-300 transition-all duration-500"
              style={{ width: `${offlinePct}%` }}
            />
            <div
              className="h-full bg-gradient-to-r from-blue-300 to-blue-400 transition-all duration-500"
              style={{ width: `${onlinePct}%` }}
            />
          </div>
          <span className="text-[11px] text-blue-400 tabular-nums shrink-0 whitespace-nowrap">线上 {onlinePct}%</span>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {/* 各项数据 */}
      <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
        <span className="text-[12px] text-slate-500 tabular-nums">
          合计 <strong className="text-slate-700">{op.totalCount}</strong>
        </span>
        <span className="text-[12px] text-emerald-600 tabular-nums">
          线上 <strong>{op.onlineCount}</strong>
        </span>
        <span className="text-[12px] text-slate-400 tabular-nums">
          线下 <strong>{op.offlineCount}</strong>
        </span>
        <span className="text-[12px] text-amber-500 tabular-nums">
          7天 <strong>{op.within7Days}</strong>
        </span>
        <span className="text-[12px] text-blue-400 tabular-nums">
          30天 <strong>{op.within30Days}</strong>
        </span>
      </div>
    </div>
  );
}
