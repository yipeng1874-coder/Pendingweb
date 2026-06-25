import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { ChevronDown, ChevronRight, Users } from "lucide-react";

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

/** 从 team 向上找到它所属的 BASE org */
function findBaseOfTeam(orgs: OrgUnit[], team: OrgUnit): OrgUnit | null {
  let current: OrgUnit | null = team.parentId ? orgs.find((o) => o.id === team.parentId) ?? null : null;
  while (current && current.orgType !== "BASE") {
    current = current.parentId ? orgs.find((o) => o.id === current!.parentId) ?? null : null;
  }
  return current;
}

// ─── 团队选择器 Popover ───────────────────────────────────────────────────

interface TeamPickerProps {
  availableBaseOrgs: OrgUnit[];
  availableTeamOrgs: OrgUnit[];
  orgs: OrgUnit[];
  selectedScopeOrgId: string;
  selectedScopeOrg: OrgUnit | null;
  showTwoLevel: boolean;
  onSelectTeam: (teamId: string) => void;
}

function TeamPicker({
  availableBaseOrgs,
  availableTeamOrgs,
  orgs,
  selectedScopeOrgId,
  selectedScopeOrg,
  showTwoLevel,
  onSelectTeam,
}: TeamPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 默认展开当前选中团队所在基地
  const initialExpandedBase = useMemo(() => {
    if (!selectedScopeOrgId) return availableBaseOrgs[0]?.id ?? "";
    const team = availableTeamOrgs.find((t) => t.id === selectedScopeOrgId);
    if (!team) return availableBaseOrgs[0]?.id ?? "";
    return findBaseOfTeam(orgs, team)?.id ?? availableBaseOrgs[0]?.id ?? "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 只初始化一次

  const [expandedBaseIds, setExpandedBaseIds] = useState<Set<string>>(
    () => new Set(initialExpandedBase ? [initialExpandedBase] : [])
  );

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function toggleBase(baseId: string) {
    setExpandedBaseIds((prev) => {
      const next = new Set(prev);
      if (next.has(baseId)) next.delete(baseId);
      else next.add(baseId);
      return next;
    });
  }

  function handleSelect(teamId: string) {
    onSelectTeam(teamId);
    setOpen(false);
  }

  const label = selectedScopeOrg
    ? showTwoLevel
      ? (() => {
          const base = findBaseOfTeam(orgs, selectedScopeOrg);
          return base ? `${base.name} · ${selectedScopeOrg.name}` : selectedScopeOrg.name;
        })()
      : selectedScopeOrg.name
    : "请选择团队";

  return (
    <div ref={ref} className="relative">
      {/* 触发按钮 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-xl bg-slate-700/60 border border-slate-600/60 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700/90 transition-colors"
      >
        <span className="text-xs text-slate-400 whitespace-nowrap">切换团队</span>
        <span className="max-w-[160px] truncate text-white">{label}</span>
        <ChevronDown size={13} className={["text-slate-400 transition-transform", open ? "rotate-180" : ""].join(" ")} />
      </button>

      {/* 下拉面板 */}
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-56 rounded-2xl bg-slate-800 border border-slate-700/80 shadow-[0_8px_32px_rgba(15,23,42,0.3)] overflow-hidden">
          <div className="px-2 py-2 max-h-72 overflow-y-auto">
            {showTwoLevel ? (
              // 多基地：折叠树
              <ul className="space-y-0.5">
                {availableBaseOrgs.map((base) => {
                  const teamsInBase = availableTeamOrgs.filter((t) => findBaseOfTeam(orgs, t)?.id === base.id);
                  if (!teamsInBase.length) return null;
                  const isExpanded = expandedBaseIds.has(base.id);
                  const hasSelectedTeam = teamsInBase.some((t) => t.id === selectedScopeOrgId);

                  return (
                    <li key={base.id}>
                      {/* 基地行 */}
                      <button
                        type="button"
                        onClick={() => toggleBase(base.id)}
                        className={[
                          "w-full flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-left transition-all",
                          hasSelectedTeam
                            ? "bg-slate-700/80 text-white"
                            : "text-slate-400 hover:bg-slate-700/50 hover:text-slate-200",
                        ].join(" ")}
                      >
                        <span className="shrink-0 text-slate-400">
                          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </span>
                        <span className="text-xs font-semibold tracking-wide truncate flex-1">{base.name}</span>
                        <span className="text-xs text-slate-500 shrink-0">{teamsInBase.length}</span>
                      </button>

                      {/* 展开时渲染团队列表 */}
                      {isExpanded && (
                        <ul className="mt-0.5 ml-3.5 border-l border-slate-700/60 pl-2.5 space-y-0.5">
                          {teamsInBase.map((team) => (
                            <li key={team.id}>
                              <button
                                type="button"
                                onClick={() => handleSelect(team.id)}
                                className={[
                                  "w-full rounded-lg px-2.5 py-1.5 text-left text-xs transition-all",
                                  team.id === selectedScopeOrgId
                                    ? "bg-blue-500 text-white font-semibold"
                                    : "text-slate-300 hover:bg-slate-700/70 hover:text-white",
                                ].join(" ")}
                              >
                                <span className="block truncate">{team.name}</span>
                                <span className={["block truncate mt-0.5", team.id === selectedScopeOrgId ? "text-blue-200" : "text-slate-500"].join(" ")}>
                                  {team.orgCode}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              // 单基地：直接列出团队
              <ul className="space-y-0.5">
                {availableTeamOrgs.map((team) => (
                  <li key={team.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(team.id)}
                      className={[
                        "w-full rounded-xl px-2.5 py-2 text-left text-xs transition-all",
                        team.id === selectedScopeOrgId
                          ? "bg-blue-500 text-white font-semibold"
                          : "text-slate-300 hover:bg-slate-700/70 hover:text-white",
                      ].join(" ")}
                    >
                      <span className="block truncate">{team.name}</span>
                      <span className={["block truncate mt-0.5", team.id === selectedScopeOrgId ? "text-blue-200" : "text-slate-500"].join(" ")}>
                        {team.orgCode}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="px-3 py-1.5 border-t border-slate-700/60">
            <p className="text-xs text-slate-600 text-center">共 {availableTeamOrgs.length} 个团队</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 欢迎页快速进入面板（基地可折叠） ────────────────────────────────────

interface QuickEntryPanelProps {
  availableBaseOrgs: OrgUnit[];
  availableTeamOrgs: OrgUnit[];
  orgs: OrgUnit[];
  showTwoLevel: boolean;
  onSelectTeam: (teamId: string) => void;
}

function QuickEntryPanel({
  availableBaseOrgs,
  availableTeamOrgs,
  orgs,
  showTwoLevel,
  onSelectTeam,
}: QuickEntryPanelProps) {
  // 默认全部展开
  const [collapsedBaseIds, setCollapsedBaseIds] = useState<Set<string>>(() => new Set());

  function toggleBase(baseId: string) {
    setCollapsedBaseIds((prev) => {
      const next = new Set(prev);
      if (next.has(baseId)) next.delete(baseId);
      else next.add(baseId);
      return next;
    });
  }

  const teamCard = (org: OrgUnit) => (
    <button
      key={org.id}
      type="button"
      onClick={() => onSelectTeam(org.id)}
      className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 px-4 py-3 text-left transition-all duration-200 hover:border-indigo-300 hover:shadow-[0_4px_16px_rgba(99,102,241,0.12)]"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-500 to-blue-600 opacity-0 transition-opacity duration-200 group-hover:opacity-5" />
      <p className="text-sm font-medium text-slate-700 group-hover:text-indigo-700 transition-colors truncate">{org.name}</p>
      <p className="mt-0.5 text-xs text-slate-400 group-hover:text-indigo-400 transition-colors">{org.orgCode}</p>
    </button>
  );

  return (
    <div className="mt-8 w-full max-w-lg">
      <p className="text-xs font-medium text-slate-400 text-center mb-3 tracking-widest uppercase">快速进入</p>
      {showTwoLevel ? (
        // 多基地：按基地分组，基地行可折叠
        <div className="rounded-2xl border border-slate-100 overflow-hidden divide-y divide-slate-100">
          {availableBaseOrgs.map((base) => {
            const teamsInBase = availableTeamOrgs.filter((t) => findBaseOfTeam(orgs, t)?.id === base.id);
            if (!teamsInBase.length) return null;
            const isCollapsed = collapsedBaseIds.has(base.id);

            return (
              <div key={base.id}>
                {/* 基地标题行，可点击折叠 */}
                <button
                  type="button"
                  onClick={() => toggleBase(base.id)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                >
                  <span className="text-slate-400 shrink-0 transition-transform duration-200" style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>
                    <ChevronDown size={13} />
                  </span>
                  <span className="text-xs font-semibold text-slate-500 tracking-wide flex-1">{base.name}</span>
                  <span className="text-xs text-slate-400">{teamsInBase.length} 个团队</span>
                </button>
                {/* 团队卡片区域 */}
                {!isCollapsed && (
                  <div className="px-4 py-3 grid grid-cols-2 gap-2 sm:grid-cols-3 bg-white">
                    {teamsInBase.map(teamCard)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        // 单基地：平铺
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {availableTeamOrgs.slice(0, 6).map(teamCard)}
        </div>
      )}
    </div>
  );
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

  // 从可选团队中提取基地列表（去重，按 path 排序）
  const availableBaseOrgs = useMemo(() => {
    const baseMap = new Map<string, OrgUnit>();
    for (const team of availableTeamOrgs) {
      const base = findBaseOfTeam(orgs, team);
      if (base && !baseMap.has(base.id)) baseMap.set(base.id, base);
    }
    return Array.from(baseMap.values()).sort((a, b) => a.path.localeCompare(b.path));
  }, [availableTeamOrgs, orgs]);

  // 有多个基地时启用两级折叠树
  const showTwoLevel = availableBaseOrgs.length > 1;

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
    return hallDailyApi
      .listTemplates({ teamOrgId, status: "draft", neverPublished: true, limit, offset })
      .catch(() => [] as HallTaskTemplate[]);
  }, []);

  async function loadData(showLoading = true) {
    if (showLoading) setLoading(true);
    const shouldLoad = Boolean(selectedScopeOrgId);
    const [templateList, orgTree, scheduledRows, activeRows, endedRows, draftRows] = await Promise.all([
      shouldLoad
        ? hallDailyApi
            .listTemplates({ teamOrgId: selectedScopeOrgId, limit: 100 })
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
      .listAssignments({ teamOrgId: selectedScopeOrgId, status: "draft", limit: 1 })
      .then((rows) => {
        if (!cancelled) setAutoResumeDraftId(rows[0]?.id ?? "");
      })
      .catch(() => {
        if (!cancelled) setAutoResumeDraftId("");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedScopeOrgId]);

  // ─── 渲染 ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* 顶栏 */}
      <div className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-slate-800 to-slate-900 px-5 py-3.5 shadow-[0_6px_20px_rgba(15,23,42,0.15)]">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/20 border border-blue-500/30 shrink-0">
          <Users size={15} className="text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-white leading-tight">厅管任务管理中心</h2>
          {selectedScopeOrg && (
            <p className="text-xs text-slate-400 leading-snug truncate">
              当前：
              {showTwoLevel && (() => {
                const base = findBaseOfTeam(orgs, selectedScopeOrg);
                return base ? <span className="text-slate-300">{base.name} · </span> : null;
              })()}
              <span className="text-blue-300 font-medium">{selectedScopeOrg.name}</span>
            </p>
          )}
        </div>
        {/* 多团队时展示选择器 */}
        {availableTeamOrgs.length > 1 && (
          <TeamPicker
            availableBaseOrgs={availableBaseOrgs}
            availableTeamOrgs={availableTeamOrgs}
            orgs={orgs}
            selectedScopeOrgId={selectedScopeOrgId}
            selectedScopeOrg={selectedScopeOrg}
            showTwoLevel={showTwoLevel}
            onSelectTeam={setSelectedScopeOrgId}
          />
        )}
      </div>

      {/* 内容区 */}
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

            {/* 快速进入卡片 */}
            {availableTeamOrgs.length > 0 && (
              <QuickEntryPanel
                availableBaseOrgs={availableBaseOrgs}
                availableTeamOrgs={availableTeamOrgs}
                orgs={orgs}
                showTwoLevel={showTwoLevel}
                onSelectTeam={setSelectedScopeOrgId}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
