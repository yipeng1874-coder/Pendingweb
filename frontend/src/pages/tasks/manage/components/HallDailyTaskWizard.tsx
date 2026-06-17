import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, ChevronLeft, ChevronRight, ClipboardCheck, Clock3, Eye, Loader2, Plus, PowerOff, RefreshCw, Trash2 } from "lucide-react";

import type { OrgUnit, TaskEffectMode } from "../../../../types";
import { hallDailyApi, type HallTaskAssignment, type HallTaskTemplate } from "../../../../services/task";
import { TaskTemplateDrawer } from "./TaskTemplateDrawer";

// ─── 类型定义 ─────────────────────────────────────────────────────────────

type Props = {
  templates: HallTaskTemplate[];
  draftTemplatesPage?: HallTaskTemplate[];
  orgs: OrgUnit[];
  currentOrgId?: string;
  managementOrgId: string;   // 当前团队管理员所属团队 orgId
  managementOrgName?: string;
  canManageTemplates: boolean;
  initialAssignmentId?: string;
  scheduledAssignments?: HallTaskAssignment[];
  activeAssignments?: HallTaskAssignment[];
  endedAssignments?: HallTaskAssignment[];
  loadAssignmentsByStatus?: (teamOrgId: string, status: "scheduled" | "active" | "ended", offset?: number, limit?: number) => Promise<HallTaskAssignment[]>;
  loadDraftTemplatesPage?: (teamOrgId: string, offset?: number, limit?: number) => Promise<HallTaskTemplate[]>;
  onReload: () => Promise<void> | void;
  onIssued: () => void;
};

type WizardStep = 1 | 2 | 3;

type PageKey = "draft" | "scheduled" | "active" | "ended";
type PageState = Record<PageKey, number>;
const PAGE_SIZE = 3;

// ─── 工具函数 ─────────────────────────────────────────────────────────────

function statusLabel(status: string) {
  switch (status) {
    case "active": return { text: "生效中", cls: "bg-green-50 text-green-700 border border-green-200" };
    case "scheduled": return { text: "待生效", cls: "bg-amber-50 text-amber-700 border border-amber-200" };
    case "draft": return { text: "草稿", cls: "bg-slate-100 text-slate-600 border border-slate-200" };
    case "ended": return { text: "已结束", cls: "bg-slate-50 text-slate-400 border border-slate-200" };
    default: return { text: status, cls: "bg-slate-100 text-slate-500 border border-slate-200" };
  }
}

function formatDate(dateStr?: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// ─── 主组件 ───────────────────────────────────────────────────────────────

export function HallDailyTaskWizard({
  templates,
  draftTemplatesPage = [],
  orgs,
  currentOrgId,
  managementOrgId,
  managementOrgName,
  canManageTemplates,
  initialAssignmentId = "",
  scheduledAssignments = [],
  activeAssignments = [],
  endedAssignments = [],
  loadAssignmentsByStatus,
  loadDraftTemplatesPage,
  onReload,
  onIssued,
}: Props) {
  // ── 向导状态 ──
  const [step, setStep] = useState<WizardStep>(1);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedOrgIds, setSelectedOrgIds] = useState<string[]>([]);
  const [effectMode, setEffectMode] = useState<TaskEffectMode>("next_midnight");
  const [currentDraftId, setCurrentDraftId] = useState(initialAssignmentId);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [previewData, setPreviewData] = useState<{
    templateTitle: string;
    targetOrgs: { id: string; name: string }[];
    effectMode: TaskEffectMode;
  } | null>(null);
  const [templateDrawerOpen, setTemplateDrawerOpen] = useState(false);
  const [templateDrawerTemplate, setTemplateDrawerTemplate] = useState<HallTaskTemplate | null>(null);

  // ── 列表分页 ──
  const [pages, setPages] = useState<PageState>({ draft: 0, scheduled: 0, active: 0, ended: 0 });
  const [scheduledPage, setScheduledPage] = useState<HallTaskAssignment[]>(scheduledAssignments ?? []);
  const [activePage, setActivePage] = useState<HallTaskAssignment[]>(activeAssignments ?? []);
  const [endedPage, setEndedPage] = useState<HallTaskAssignment[]>(endedAssignments ?? []);
  const [draftPage, setDraftPage] = useState<HallTaskTemplate[]>(draftTemplatesPage ?? []);

  useEffect(() => { setScheduledPage(scheduledAssignments); }, [scheduledAssignments]);
  useEffect(() => { setActivePage(activeAssignments); }, [activeAssignments]);
  useEffect(() => { setEndedPage(endedAssignments); }, [endedAssignments]);
  useEffect(() => { setDraftPage(draftTemplatesPage); }, [draftTemplatesPage]);

  // ── 当前团队下属的厅列表 ──
  const teamOrg = useMemo(() => orgs.find((o) => o.id === managementOrgId), [orgs, managementOrgId]);
  const hallOrgs = useMemo(() => {
    if (!teamOrg) return [];
    return orgs
      .filter((o) => o.orgType === "HALL" && o.status === "active" && o.path.startsWith(`${teamOrg.path}/`))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [orgs, teamOrg]);

  // ── 当前 Step1 可选的模板（已发布状态）──
  const availableTemplates = useMemo(
    () => templates.filter((t) => t.status === "published"),
    [templates]
  );
  const allDraftTemplates = useMemo(
    () => draftPage.filter((t) => t.status === "draft"),
    [draftPage]
  );

  const selectedTemplate = useMemo(() => templates.find((t) => t.id === selectedTemplateId), [templates, selectedTemplateId]);

  // ── 初始化：若有 initialAssignmentId，恢复草稿状态 ──
  useEffect(() => {
    if (!initialAssignmentId) return;
    hallDailyApi.listAssignments({ teamOrgId: managementOrgId }).then((rows) => {
      const assignment = rows.find((a) => a.id === initialAssignmentId && a.status === "draft");
      if (!assignment) return;
      setCurrentDraftId(assignment.id);
      setSelectedTemplateId(assignment.template?.id ?? "");
      const orgIds = (assignment.targets ?? []).map((t) => t.hallOrgId);
      setSelectedOrgIds(orgIds);
      setEffectMode((assignment.effectMode as TaskEffectMode) ?? "next_midnight");
      if (orgIds.length > 0) setStep(3);
      else if (assignment.template?.id) setStep(2);
    }).catch(() => undefined);
  }, [initialAssignmentId, managementOrgId]);

  // ─── Step 操作 ────────────────────────────────────────────────────────

  async function handleStep1Next() {
    if (!selectedTemplateId) return;
    setSaving(true);
    try {
      const result = await hallDailyApi.saveDraft({
        assignmentId: currentDraftId || undefined,
        templateId: selectedTemplateId,
        teamOrgId: managementOrgId,
        hallOrgIds: selectedOrgIds.length ? selectedOrgIds : [],
        effectMode,
      });
      if (result?.id) setCurrentDraftId(result.id);
      setStep(2);
    } catch {
      setStep(2);
    } finally {
      setSaving(false);
    }
  }

  async function handleStep2Next() {
    if (!selectedOrgIds.length) return;
    setSaving(true);
    try {
      const result = await hallDailyApi.saveDraft({
        assignmentId: currentDraftId || undefined,
        templateId: selectedTemplateId,
        teamOrgId: managementOrgId,
        hallOrgIds: selectedOrgIds,
        effectMode,
      });
      if (result?.id) setCurrentDraftId(result.id);
      // 加载预览
      const id = result?.id ?? currentDraftId;
      if (id) {
        const preview = await hallDailyApi.getPublishPreview(id, managementOrgId);
        setPreviewData({
          templateTitle: preview.templateTitle,
          targetOrgs: preview.targetOrgs,
          effectMode: (preview.effectMode as TaskEffectMode) ?? effectMode,
        });
      }
      setStep(3);
    } catch {
      setStep(3);
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!currentDraftId) return;
    setPublishing(true);
    setPublishError("");
    try {
      await hallDailyApi.publishDraft(currentDraftId, effectMode, managementOrgId);
      await onReload();
      onIssued();
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message ?? err?.message ?? "发布失败，请稍后重试";
      setPublishError(msg);
    } finally {
      setPublishing(false);
    }
  }

  async function handleDeleteAssignment(id: string) {
    if (!window.confirm("确定要删除该任务吗？")) return;
    await hallDailyApi.deleteAssignment(id, managementOrgId).catch(() => undefined);
    await onReload();
  }

  async function handleCloseAssignment(id: string) {
    if (!window.confirm("确定要结束该任务吗？")) return;
    await hallDailyApi.closeAssignment(id, managementOrgId).catch(() => undefined);
    await onReload();
  }

  async function handlePageChange(key: PageKey, direction: "prev" | "next") {
    const next = direction === "next" ? pages[key] + 1 : pages[key] - 1;
    if (next < 0) return;
    setPages((prev) => ({ ...prev, [key]: next }));
    if (!loadAssignmentsByStatus) return;
    if (key !== "draft") {
      const rows = await loadAssignmentsByStatus(managementOrgId, key as "scheduled" | "active" | "ended", next * PAGE_SIZE, PAGE_SIZE).catch(() => []);
      if (key === "scheduled") setScheduledPage(rows);
      if (key === "active") setActivePage(rows);
      if (key === "ended") setEndedPage(rows);
    } else if (loadDraftTemplatesPage) {
      const rows = await loadDraftTemplatesPage(managementOrgId, next * PAGE_SIZE, PAGE_SIZE).catch(() => []);
      setDraftPage(rows.filter((t) => t.status === "draft"));
    }
  }

  // ─── 渲染工具 ─────────────────────────────────────────────────────────

  function renderAssignmentCard(assignment: HallTaskAssignment) {
    const sl = statusLabel(assignment.status);
    const hallCount = assignment.targets?.length ?? 0;
    return (
      <div key={assignment.id} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 px-4 py-3 hover:bg-slate-50 transition-colors">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`rounded-lg px-2 py-0.5 text-xs font-medium ${sl.cls}`}>{sl.text}</span>
            <span className="truncate text-sm font-medium text-slate-800">{assignment.template?.title ?? "未知模板"}</span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
            <span>覆盖 {hallCount} 个厅</span>
            {assignment.effectiveAt && <span>生效 {formatDate(assignment.effectiveAt)}</span>}
            {assignment.endedAt && <span>结束 {formatDate(assignment.endedAt)}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            title="查看详情"
            onClick={async () => {
              if (!assignment.templateId) return;
              try {
                const full = await hallDailyApi.getTemplateById(assignment.templateId, managementOrgId);
                setTemplateDrawerTemplate(full);
              } catch {
                setTemplateDrawerTemplate(null);
              }
              setTemplateDrawerOpen(true);
            }}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white hover:text-blue-500"
          >
            <Eye size={14} />
          </button>
          {assignment.status === "active" && (
            <button type="button" title="结束任务" onClick={() => handleCloseAssignment(assignment.id)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white hover:text-amber-500">
              <PowerOff size={14} />
            </button>
          )}
          {(assignment.status === "draft" || assignment.status === "scheduled") && (
            <button type="button" title="删除任务" onClick={() => handleDeleteAssignment(assignment.id)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white hover:text-red-500">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    );
  }

  function renderAssignmentSection(title: string, items: HallTaskAssignment[], pageKey: PageKey, badgeCls: string) {
    if (!items.length && pages[pageKey] === 0) return null;
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeCls}`}>{items.length}</span>
        </div>
        <div className="space-y-1.5">
          {items.map(renderAssignmentCard)}
          {!items.length && <p className="text-xs text-slate-400 text-center py-2">暂无数据</p>}
        </div>
        {(items.length >= PAGE_SIZE || pages[pageKey] > 0) && (
          <div className="flex items-center justify-end gap-1">
            <button type="button" disabled={pages[pageKey] === 0} onClick={() => handlePageChange(pageKey, "prev")} className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 disabled:opacity-30">
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs text-slate-400">第 {pages[pageKey] + 1} 页</span>
            <button type="button" disabled={items.length < PAGE_SIZE} onClick={() => handlePageChange(pageKey, "next")} className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 disabled:opacity-30">
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
    );
  }

  // ─── 向导步骤渲染 ─────────────────────────────────────────────────────

  function renderStep1() {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-semibold text-slate-800">第一步：选择厅管任务模板</h3>
          <p className="mt-0.5 text-xs text-slate-400">请选择一个厅管日常任务表单作为本次任务的内容模板</p>
        </div>

        {/* 已发布模板列表 */}
        {availableTemplates.length > 0 ? (
          <div className="grid gap-2">
            {availableTemplates.map((tmpl) => (
              <button
                key={tmpl.id}
                type="button"
                onClick={() => setSelectedTemplateId(tmpl.id)}
                className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-all ${
                  selectedTemplateId === tmpl.id
                    ? "border-blue-300 bg-blue-50 shadow-[0_4px_12px_rgba(59,130,246,0.12)]"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <ClipboardCheck size={16} className={`mt-0.5 shrink-0 ${selectedTemplateId === tmpl.id ? "text-blue-500" : "text-slate-400"}`} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${selectedTemplateId === tmpl.id ? "text-blue-700" : "text-slate-800"}`}>{tmpl.title}</p>
                  {tmpl.description && <p className="mt-0.5 text-xs text-slate-400 line-clamp-1">{tmpl.description}</p>}
                  <p className="mt-1 text-xs text-slate-400">{tmpl.items?.length ?? 0} 个检查项 · v{tmpl.version}</p>
                </div>
                {selectedTemplateId === tmpl.id && (
                  <div className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-blue-500">
                    <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </button>
            ))}
            {canManageTemplates && (
              <button
                type="button"
                onClick={() => { setTemplateDrawerTemplate(null); setTemplateDrawerOpen(true); }}
                className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-blue-200 bg-blue-50/50 px-4 py-3 text-sm text-blue-500 transition hover:border-blue-300 hover:bg-blue-50"
              >
                <Plus size={15} />新建厅管日常模板
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-8 text-center">
            <ClipboardCheck size={28} className="mx-auto text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">暂无可用的厅管日常任务模板</p>
            {canManageTemplates ? (
              <button
                type="button"
                onClick={() => { setTemplateDrawerTemplate(null); setTemplateDrawerOpen(true); }}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-600"
              >
                <Plus size={14} />新建厅管日常模板
              </button>
            ) : (
              <p className="mt-1 text-xs text-slate-400">请联系管理员在模板库中创建厅管日常任务模板</p>
            )}
          </div>
        )}

        {/* 草稿模板 */}
        {allDraftTemplates.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">草稿模板</p>
            {allDraftTemplates.map((tmpl) => (
              <div key={tmpl.id} className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-slate-200 px-4 py-2.5">
                <span className="text-sm text-slate-500 truncate">{tmpl.title}</span>
                <span className="shrink-0 text-xs text-slate-400">草稿 · 不可用于发布</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button
            type="button"
            disabled={!selectedTemplateId || saving}
            onClick={handleStep1Next}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-[0_4px_12px_rgba(59,130,246,0.3)] transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : null}
            下一步：选择执行厅
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    );
  }

  function renderStep2() {
    const allSelected = hallOrgs.length > 0 && hallOrgs.every((h) => selectedOrgIds.includes(h.id));
    const toggleAll = () => {
      if (allSelected) setSelectedOrgIds([]);
      else setSelectedOrgIds(hallOrgs.map((h) => h.id));
    };
    const toggleHall = (id: string) => {
      setSelectedOrgIds((prev) => prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]);
    };

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setStep(1)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <ChevronLeft size={16} />
          </button>
          <div>
            <h3 className="text-base font-semibold text-slate-800">第二步：选择执行范围（厅）</h3>
            <p className="text-xs text-slate-400">勾选需要每日执行该任务的厅，任务将下发给厅管负责人</p>
          </div>
        </div>

        {/* 选中模板信息 */}
        {selectedTemplate && (
          <div className="flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-2.5 border border-blue-100">
            <ClipboardCheck size={15} className="text-blue-500 shrink-0" />
            <span className="text-sm text-blue-700 font-medium">{selectedTemplate.title}</span>
            <button type="button" onClick={() => setStep(1)} className="ml-auto text-xs text-blue-400 hover:text-blue-600 transition">更换</button>
          </div>
        )}

        {/* 厅选择 */}
        <div className="rounded-2xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between bg-slate-50 px-4 py-2.5 border-b border-slate-200">
            <span className="text-sm font-medium text-slate-700">
              {managementOrgName ? `${managementOrgName}` : "当前团队"} · 共 {hallOrgs.length} 个厅
            </span>
            <button type="button" onClick={toggleAll} className="text-xs text-blue-500 hover:text-blue-700 transition font-medium">
              {allSelected ? "取消全选" : "全选"}
            </button>
          </div>
          {hallOrgs.length > 0 ? (
            <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {hallOrgs.map((hall) => {
                const checked = selectedOrgIds.includes(hall.id);
                // 检查该厅是否已有生效中的任务（覆盖检测）
                const activeTask = activeAssignments.find((a) =>
                  a.targets?.some((t) => t.hallOrgId === hall.id)
                );
                // 检查是否有待生效任务
                const scheduledTask = scheduledAssignments.find((a) =>
                  a.targets?.some((t) => t.hallOrgId === hall.id)
                );
                return (
                  <label key={hall.id} className={`flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors select-none ${checked ? "bg-blue-50/60" : "hover:bg-slate-50"}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleHall(hall.id)}
                      className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                    />
                    <Building2 size={15} className={`shrink-0 ${checked ? "text-blue-500" : "text-slate-400"}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${checked ? "text-blue-700" : "text-slate-700"}`}>{hall.name}</p>
                      <p className="text-xs text-slate-400">{hall.orgCode}</p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-0.5">
                      {activeTask && (
                        <span className="flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] text-amber-600">
                          <AlertTriangle size={9} />
                          执行中：{activeTask.template?.title ?? "任务"}
                        </span>
                      )}
                      {!activeTask && scheduledTask && (
                        <span className="rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] text-blue-500">
                          待生效：{scheduledTask.template?.title ?? "任务"}
                        </span>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-slate-400">当前团队下暂无有效厅，请先完善组织架构</div>
          )}
        </div>

        {selectedOrgIds.length > 0 && (
          <p className="text-xs text-slate-500">已选 <span className="font-semibold text-blue-600">{selectedOrgIds.length}</span> 个厅</p>
        )}

        {/* 覆盖逻辑说明 */}
        {selectedOrgIds.some((id) => activeAssignments.some((a) => a.targets?.some((t) => t.hallOrgId === id))) && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5">
            <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-500" />
            <p className="text-xs text-amber-700 leading-relaxed">
              所选厅中有正在执行的任务，发布后将自动替代同范围内的旧任务，旧任务将变为"已结束"状态。
            </p>
          </div>
        )}

        <div className="flex justify-between pt-2">
          <button type="button" onClick={() => setStep(1)} className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm text-slate-500 transition hover:bg-slate-100">
            <ChevronLeft size={15} />上一步
          </button>
          <button
            type="button"
            disabled={!selectedOrgIds.length || saving}
            onClick={handleStep2Next}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-[0_4px_12px_rgba(59,130,246,0.3)] transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : null}
            下一步：预览发布
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    );
  }

  function renderStep3() {
    const orgList = previewData?.targetOrgs ?? selectedOrgIds.map((id) => ({ id, name: orgs.find((o) => o.id === id)?.name ?? id }));
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setStep(2)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <ChevronLeft size={16} />
          </button>
          <div>
            <h3 className="text-base font-semibold text-slate-800">第三步：预览并发布</h3>
            <p className="text-xs text-slate-400">确认配置信息后正式发布，任务将按所选生效时间开始执行</p>
          </div>
        </div>

        {/* 配置摘要 */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/50 divide-y divide-slate-100 overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="w-20 shrink-0 text-xs text-slate-400">任务模板</span>
            <span className="text-sm font-medium text-slate-800">{previewData?.templateTitle ?? selectedTemplate?.title ?? "—"}</span>
          </div>
          <div className="flex items-start gap-3 px-4 py-3">
            <span className="w-20 shrink-0 text-xs text-slate-400">执行厅</span>
            <div className="flex flex-wrap gap-1.5">
              {orgList.map((org) => (
                <span key={org.id} className="rounded-lg bg-white border border-slate-200 px-2 py-0.5 text-xs text-slate-700">{org.name}</span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="w-20 shrink-0 text-xs text-slate-400">发布主体</span>
            <span className="text-sm text-slate-700">{managementOrgName ?? "当前团队"}</span>
          </div>
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="w-20 shrink-0 text-xs text-slate-400">任务周期</span>
            <span className="text-sm text-slate-700">每日重复执行 · 次日 16:00 截止补录</span>
          </div>
        </div>

        {/* 每日循环规则说明 */}
        <div className="rounded-2xl bg-indigo-50/60 border border-indigo-100 p-4">
          <div className="flex items-center gap-2 text-indigo-700 font-semibold text-sm mb-2">
            <RefreshCw size={13} />
            <span>每日自动循环规则</span>
          </div>
          <ul className="text-xs text-indigo-600/80 space-y-1 ml-4 list-disc leading-relaxed">
            <li>任务发布后，系统将在每日 <span className="font-semibold">00:00</span> 为每个厅自动生成一份待办记录。</li>
            <li>负责人需在当日完成，最晚可补录至次日 <span className="font-semibold">16:00</span>。</li>
            <li>发布覆盖范围相同的新任务时，旧任务将自动归档为"已结束"。</li>
          </ul>
        </div>

        {/* 生效时间选择 */}
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <p className="px-4 pt-3 pb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">生效方式</p>
          <div className="divide-y divide-slate-100">
            {(["immediate", "next_midnight"] as TaskEffectMode[]).map((mode) => {
              const isMode = effectMode === mode;
              return (
                <label key={mode} className={`flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors select-none ${isMode ? "bg-blue-50/60" : "hover:bg-slate-50"}`}>
                  <input type="radio" name="effectMode" value={mode} checked={isMode} onChange={() => setEffectMode(mode)} className="accent-blue-600" />
                  <div className="flex items-center gap-2">
                    <Clock3 size={15} className={isMode ? "text-blue-500" : "text-slate-400"} />
                    <div>
                      <p className={`text-sm font-medium ${isMode ? "text-blue-700" : "text-slate-700"}`}>
                        {mode === "immediate" ? "立即生效" : "次日零点生效"}
                      </p>
                      <p className="text-xs text-slate-400">
                        {mode === "immediate" ? "发布后立即成为进行中，同范围旧任务自动结束" : "发布后处于待生效状态，明日零点自动激活"}
                      </p>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {publishError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{publishError}</div>
        )}

        <div className="flex justify-between pt-2">
          <button type="button" onClick={() => setStep(2)} className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm text-slate-500 transition hover:bg-slate-100">
            <ChevronLeft size={15} />上一步
          </button>
          <button
            type="button"
            disabled={publishing}
            onClick={handlePublish}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(79,70,229,0.35)] transition hover:from-blue-700 hover:to-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {publishing ? <Loader2 size={15} className="animate-spin" /> : null}
            正式发布厅管日常任务
          </button>
        </div>
      </div>
    );
  }

  // ─── 整体布局 ─────────────────────────────────────────────────────────

  return (
    <>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        {/* 左侧：向导主内容 */}
        <div className="rounded-3xl bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)] overflow-hidden">
          {/* 步骤指示器 */}
          <div className="flex items-center gap-0 border-b border-slate-100">
            {([1, 2, 3] as WizardStep[]).map((s, idx) => (
              <div
                key={s}
                className={`flex flex-1 items-center justify-center gap-2 py-3.5 text-xs font-medium transition-colors ${
                  step === s ? "bg-blue-50 text-blue-700 border-b-2 border-blue-500" : step > s ? "text-slate-400" : "text-slate-300"
                }`}
              >
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${step === s ? "bg-blue-500 text-white" : step > s ? "bg-slate-300 text-white" : "bg-slate-200 text-slate-400"}`}>{s}</span>
                <span className="hidden sm:inline">{["选择模板", "选择厅", "预览发布"][idx]}</span>
              </div>
            ))}
          </div>

          <div className="p-6">
            {step === 1 && renderStep1()}
            {step === 2 && renderStep2()}
            {step === 3 && renderStep3()}
          </div>
        </div>

        {/* 右侧：任务状态列表 */}
        <div className="space-y-5">
          {/* 生效中 */}
          <div className="rounded-3xl bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] space-y-4">
            {renderAssignmentSection("生效中", activePage, "active", "bg-green-50 text-green-700") ?? (
              <div className="text-center py-6 text-sm text-slate-400">
                <ClipboardCheck size={24} className="mx-auto mb-2 text-slate-300" />
                <p>暂无生效中的厅管日常任务</p>
              </div>
            )}
          </div>

          {/* 待生效 */}
          {(scheduledPage.length > 0 || pages.scheduled > 0) && (
            <div className="rounded-3xl bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] space-y-4">
              {renderAssignmentSection("待生效", scheduledPage, "scheduled", "bg-amber-50 text-amber-700")}
            </div>
          )}

          {/* 已结束 */}
          {(endedPage.length > 0 || pages.ended > 0) && (
            <div className="rounded-3xl bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] space-y-4">
              {renderAssignmentSection("已结束", endedPage, "ended", "bg-slate-100 text-slate-500")}
            </div>
          )}
        </div>
      </div>

      {/* 模板预览抽屉 */}
      <TaskTemplateDrawer
        open={templateDrawerOpen}
        category="HALL_DAILY"
        currentOrgId={currentOrgId ?? managementOrgId}
        scopeOrgId={managementOrgId}
        template={templateDrawerTemplate}
        readOnly={!canManageTemplates}
        onClose={() => setTemplateDrawerOpen(false)}
        onSaved={async (savedTemplate) => {
          setTemplateDrawerOpen(false);
          await onReload();
          // 若新建的模板已发布，自动选中它
          if (savedTemplate?.id && savedTemplate.status === "published") {
            setSelectedTemplateId(savedTemplate.id);
          }
        }}
      />
    </>
  );
}
