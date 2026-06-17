import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Users } from "lucide-react";

import type { Identity, OrgUnit } from "../../../types";
import { fetchOrgTree } from "../../../services/organization";
import { hallDailyApi, type HallTaskAssignment, type HallTaskTemplate } from "../../../services/task";
import { useIdentityStore } from "../../../stores/identityStore";
import { HallDailyTaskWizard } from "./components/HallDailyTaskWizard";

// ─── 工具函数 ─────────────────────────────────────────────────────────────

function isOrgWithinScope(org: OrgUnit, scopePath?: string) {
  if (!scopePath) return true;
  return org.path === scopePath || org.path.startsWith(`${scopePath}/`);
}

function findTeamByOrgId(orgs: OrgUnit[], orgId?: string): OrgUnit | null {
  if (!orgId) return null;
  let current = orgs.find((o) => o.id === orgId) ?? null;
  while (current && current.orgType !== "TEAM") {
    current = current.parentId ? orgs.find((o) => o.id === current?.parentId) ?? null : null;
  }
  return current;
}

function getAvailableTeamOrgs(orgs: OrgUnit[], identity?: Identity) {
  return orgs
    .filter((org) => org.status === "active" && org.orgType === "TEAM" && isOrgWithinScope(org, identity?.scopePath))
    .sort((a, b) => a.path.localeCompare(b.path));
}

// ─── 页面组件 ─────────────────────────────────────────────────────────────

export function HallDailyIssuePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const permissions = useIdentityStore((state) => state.permissions);
  const currentIdentity = useIdentityStore((state) => state.currentIdentity);

  const canManageTemplates = permissions.includes("*") || permissions.includes("task:template:manage");
  const initialAssignmentId = searchParams.get("assignmentId") ?? "";
  const initialScopeOrgId = searchParams.get("scopeOrgId") ?? "";

  // 厅管日常任务仅允许 TEAM_ADMIN 及以上管理身份操作
  const canManageHallDaily = ["DEV_ADMIN", "HQ_ADMIN", "BASE_ADMIN", "TEAM_ADMIN"].includes(
    currentIdentity?.roleCode ?? ""
  );

  const [templates, setTemplates] = useState<HallTaskTemplate[]>([]);
  const [orgs, setOrgs] = useState<OrgUnit[]>([]);
  const [scheduledAssignments, setScheduledAssignments] = useState<HallTaskAssignment[]>([]);
  const [activeAssignments, setActiveAssignments] = useState<HallTaskAssignment[]>([]);
  const [endedAssignments, setEndedAssignments] = useState<HallTaskAssignment[]>([]);
  const [draftTemplatesPage, setDraftTemplatesPage] = useState<HallTaskTemplate[]>([]);
  const [selectedScopeOrgId, setSelectedScopeOrgId] = useState(initialScopeOrgId);
  const [autoResumeDraftId, setAutoResumeDraftId] = useState("");
  const [loading, setLoading] = useState(true);

  const availableTeamOrgs = useMemo(
    () => getAvailableTeamOrgs(orgs, currentIdentity),
    [orgs, currentIdentity]
  );
  const selectedScopeOrg = useMemo(
    () => orgs.find((o) => o.id === selectedScopeOrgId) ?? null,
    [orgs, selectedScopeOrgId]
  );

  const resolvedInitialAssignmentId = useMemo(() => {
    if (initialAssignmentId && initialScopeOrgId && selectedScopeOrgId === initialScopeOrgId) {
      return initialAssignmentId;
    }
    return autoResumeDraftId;
  }, [autoResumeDraftId, initialAssignmentId, initialScopeOrgId, selectedScopeOrgId]);

  const loadAssignmentsByStatus = useCallback(
    async (teamOrgId: string, status: "scheduled" | "active" | "ended", offset = 0, limit = 3) => {
      return hallDailyApi
        .listAssignments({ teamOrgId, status, offset, limit })
        .catch(() => [] as HallTaskAssignment[]);
    },
    []
  );

  const loadDraftTemplatesPage = useCallback(async (teamOrgId: string, offset = 0, limit = 3) => {
    const rows = await hallDailyApi
      .listTemplates({ teamOrgId, limit, offset })
      .catch(() => [] as HallTaskTemplate[]);
    return rows.filter((t) => t.status === "draft" && (t._count?.assignments ?? 0) === 0);
  }, []);

  async function loadData(showLoading = true) {
    if (showLoading) setLoading(true);
    const shouldLoad = Boolean(selectedScopeOrgId);
    const [templateList, orgTree, scheduledRows, activeRows, endedRows, draftRows] = await Promise.all([
      shouldLoad
        ? hallDailyApi
            .listTemplates({
              teamOrgId: selectedScopeOrgId,
              ...(canManageTemplates ? {} : { status: "published" }),
            })
            .catch(() => [] as HallTaskTemplate[])
        : Promise.resolve([] as HallTaskTemplate[]),
      fetchOrgTree().catch(() => [] as OrgUnit[]),
      shouldLoad ? loadAssignmentsByStatus(selectedScopeOrgId, "scheduled") : Promise.resolve([] as HallTaskAssignment[]),
      shouldLoad ? loadAssignmentsByStatus(selectedScopeOrgId, "active") : Promise.resolve([] as HallTaskAssignment[]),
      shouldLoad ? loadAssignmentsByStatus(selectedScopeOrgId, "ended") : Promise.resolve([] as HallTaskAssignment[]),
      shouldLoad ? loadDraftTemplatesPage(selectedScopeOrgId) : Promise.resolve([] as HallTaskTemplate[]),
    ]);
    setTemplates(templateList);
    setOrgs(orgTree);
    setScheduledAssignments(scheduledRows);
    setActiveAssignments(activeRows);
    setEndedAssignments(endedRows);
    setDraftTemplatesPage(draftRows);
    setLoading(false);
  }

  // 当 selectedScopeOrgId 或权限变化时重新加载
  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageTemplates, initialAssignmentId, selectedScopeOrgId]);

  // 自动选择团队
  useEffect(() => {
    const validIds = new Set(availableTeamOrgs.map((o) => o.id));
    if (selectedScopeOrgId && validIds.has(selectedScopeOrgId)) return;

    const fallbackCandidates = [
      initialScopeOrgId,
      findTeamByOrgId(orgs, currentIdentity?.orgId)?.id ?? "",
      availableTeamOrgs.length === 1 ? availableTeamOrgs[0].id : "",
    ].filter((v): v is string => Boolean(v));

    const next = fallbackCandidates.find((v) => validIds.has(v)) ?? "";
    if (next !== selectedScopeOrgId) setSelectedScopeOrgId(next);
  }, [availableTeamOrgs, currentIdentity?.orgId, initialScopeOrgId, orgs, selectedScopeOrgId]);

  // 自动查找草稿
  useEffect(() => {
    if (!selectedScopeOrgId) {
      setAutoResumeDraftId("");
      return;
    }
    let cancelled = false;
    hallDailyApi
      .listAssignments({ teamOrgId: selectedScopeOrgId })
      .then((rows) => {
        if (!cancelled) setAutoResumeDraftId(rows.find((a) => a.status === "draft")?.id ?? "");
      })
      .catch(() => {
        if (!cancelled) setAutoResumeDraftId("");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedScopeOrgId]);

  return (
    <div className="space-y-6">
      {/* 顶栏：团队管理空间切换器 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-slate-800 to-slate-900 px-5 py-4 shadow-[0_6px_20px_rgba(15,23,42,0.15)]">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/20 border border-blue-500/30 shrink-0">
            <Users size={17} className="text-blue-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white leading-tight">厅管任务管理中心</h2>
            <p className="text-xs text-slate-400 leading-snug">
              当前团队：
              {selectedScopeOrg ? (
                <span className="text-blue-300 font-medium">{selectedScopeOrg.name}</span>
              ) : (
                <span className="text-amber-400">
                  {availableTeamOrgs.length ? "请选择团队" : "暂无可管理团队"}
                </span>
              )}
            </p>
          </div>
        </div>
        {availableTeamOrgs.length > 1 && (
          <div className="flex items-center gap-2 rounded-xl bg-slate-700/60 border border-slate-600/60 px-3 py-1.5">
            <span className="text-xs text-slate-400 whitespace-nowrap">切换团队</span>
            <select
              value={selectedScopeOrgId}
              onChange={(e) => setSelectedScopeOrgId(e.target.value)}
              className="bg-transparent text-sm font-medium text-white outline-none cursor-pointer"
            >
              <option value="" className="text-slate-900 bg-white">请选择团队</option>
              {availableTeamOrgs.map((org) => (
                <option key={org.id} value={org.id} className="text-slate-900 bg-white">
                  {org.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {loading ? (
        <div className="rounded-3xl bg-white py-16 text-center text-sm text-slate-400 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          厅管日常任务配置加载中...
        </div>
      ) : !canManageHallDaily ? (
        <div className="rounded-3xl border border-amber-100 bg-amber-50 px-6 py-16 text-center text-sm text-amber-700">
          厅管日常任务仅允许团队管理员及以上身份维护，请先切换身份。
        </div>
      ) : selectedScopeOrgId ? (
        <HallDailyTaskWizard
          key={selectedScopeOrgId}
          templates={templates}
          draftTemplatesPage={draftTemplatesPage}
          orgs={orgs}
          currentOrgId={currentIdentity?.orgId}
          managementOrgId={selectedScopeOrgId}
          managementOrgName={selectedScopeOrg?.name}
          canManageTemplates={canManageTemplates}
          initialAssignmentId={resolvedInitialAssignmentId}
          scheduledAssignments={scheduledAssignments}
          activeAssignments={activeAssignments}
          endedAssignments={endedAssignments}
          loadAssignmentsByStatus={loadAssignmentsByStatus}
          loadDraftTemplatesPage={loadDraftTemplatesPage}
          onReload={() => loadData(false)}
          onIssued={() => navigate(`/tasks/issue/hall-daily?scopeOrgId=${selectedScopeOrgId}`)}
        />
      ) : (
        /* 空状态：欢迎页 */
        <div className="relative overflow-hidden rounded-3xl bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-indigo-50 opacity-60" />
          <div className="pointer-events-none absolute -bottom-10 -left-10 h-48 w-48 rounded-full bg-blue-50 opacity-40" />

          <div className="relative flex flex-col items-center px-8 py-16">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 shadow-[0_8px_24px_rgba(99,102,241,0.3)] select-none">
              <svg className="h-7 w-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>

            <h3 className="mt-5 text-xl font-bold text-slate-900 tracking-tight">厅管日常任务协同中心</h3>
            <p className="mt-2 text-sm text-slate-400 text-center max-w-sm leading-relaxed">
              赋能每一个团队，每日追踪厅管执行，保障现场高质量运营
            </p>

            <div className="mt-8 grid grid-cols-3 gap-4 w-full max-w-md">
              {[
                { label: "按厅精准", desc: "任务直达各厅管理" },
                { label: "每日循环", desc: "自动次日重置结算" },
                { label: "团队闭环", desc: "团队层级统一管控" },
              ].map((item) => (
                <div key={item.label} className="flex flex-col items-center rounded-2xl bg-slate-50 px-3 py-4">
                  <span className="text-sm font-semibold text-slate-700">{item.label}</span>
                  <span className="mt-1 text-xs text-slate-400 text-center leading-snug">{item.desc}</span>
                </div>
              ))}
            </div>

            {availableTeamOrgs.length > 0 && (
              <div className="mt-8 w-full max-w-md">
                <p className="text-xs font-medium text-slate-400 text-center mb-3 tracking-widest uppercase">快速进入</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {availableTeamOrgs.slice(0, 6).map((org) => (
                    <button
                      key={org.id}
                      type="button"
                      onClick={() => setSelectedScopeOrgId(org.id)}
                      className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 px-4 py-3 text-left transition-all duration-200 hover:border-indigo-300 hover:shadow-[0_4px_16px_rgba(99,102,241,0.12)]"
                    >
                      <div className="absolute inset-0 bg-gradient-to-br from-indigo-500 to-blue-600 opacity-0 transition-opacity duration-200 group-hover:opacity-5" />
                      <p className="text-sm font-medium text-slate-700 group-hover:text-indigo-700 transition-colors truncate">{org.name}</p>
                      <p className="mt-0.5 text-xs text-slate-400 group-hover:text-indigo-400 transition-colors">{org.orgCode}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
