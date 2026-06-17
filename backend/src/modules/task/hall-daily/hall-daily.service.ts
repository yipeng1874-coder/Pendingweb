import { prisma } from "../../../shared/prisma.js";

// ─── 权限常量 ─────────────────────────────────────────────────────────────────
// 允许维护厅管日常任务的角色（团队自治：TEAM_ADMIN 为核心，上级可选定团队后操作）
const HALL_DAILY_ALLOWED_ROLE_CODES = new Set([
  "DEV_ADMIN",
  "HQ_ADMIN",
  "BASE_ADMIN",
  "TEAM_ADMIN",
]);

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function ensureHallDailyRole(roleCode?: string) {
  if (!roleCode || !HALL_DAILY_ALLOWED_ROLE_CODES.has(roleCode)) {
    throw new Error("HALL_DAILY_ROLE_FORBIDDEN");
  }
}

function ensureTeamScopeSelected(scopeOrgId?: string) {
  if (!scopeOrgId) throw new Error("HALL_DAILY_TEAM_SCOPE_REQUIRED");
}

function isPathWithinScope(scopePath?: string, targetPath?: string | null) {
  if (!targetPath) return false;
  if (!scopePath) return true;
  return (
    targetPath === scopePath ||
    targetPath.startsWith(`${scopePath}/`) ||
    scopePath.startsWith(`${targetPath}/`)
  );
}

async function resolveTeamOrg(teamOrgId: string, scopePath?: string, roleCode?: string) {
  const org = await prisma.orgUnit.findFirst({
    where: { id: teamOrgId, status: "active" },
    select: { id: true, path: true, orgType: true, name: true },
  });
  if (!org) throw new Error("HALL_DAILY_TEAM_ORG_NOT_FOUND");
  if (org.orgType !== "TEAM") throw new Error("HALL_DAILY_TEAM_ORG_REQUIRED");
  if (roleCode !== "DEV_ADMIN" && !isPathWithinScope(scopePath, org.path)) {
    throw new Error("HALL_DAILY_FORBIDDEN");
  }
  return org;
}

const ABSOLUTE_PROTOCOL_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const RELATIVE_LINK_RE = /^(\/|\.\/|\.\.\/|#|\?)/;
const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:"]);

function normalizeHallTaskLinkUrl(linkUrl?: string | null) {
  const value = typeof linkUrl === "string" ? linkUrl.trim() : "";
  if (!value || RELATIVE_LINK_RE.test(value)) return null;
  const candidate = ABSOLUTE_PROTOCOL_RE.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (!ALLOWED_LINK_PROTOCOLS.has(url.protocol) || !url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeHallTaskItems(
  items: Array<{
    sortOrder: number;
    itemType: string;
    title: string;
    isRequired?: boolean;
    linkUrl?: string | null;
    options?: Array<{ sortOrder: number; label: string }>;
  }>
) {
  return items.map((item, index) => {
    const normalizedLinkUrl = item.itemType === "LINK" ? normalizeHallTaskLinkUrl(item.linkUrl) : null;
    if (item.itemType === "LINK") {
      if (!item.linkUrl?.trim()) throw new Error("HALL_TASK_LINK_URL_REQUIRED");
      if (!normalizedLinkUrl) throw new Error("HALL_TASK_LINK_URL_INVALID");
    }
    return {
      sortOrder: item.sortOrder ?? index,
      itemType: item.itemType,
      title: typeof item.title === "string" ? item.title.trim() : "",
      isRequired: item.isRequired ?? true,
      linkUrl: normalizedLinkUrl,
      options: item.options?.map((opt, oi) => ({ sortOrder: opt.sortOrder ?? oi, label: opt.label })) ?? [],
    };
  });
}

const TEMPLATE_INCLUDE = {
  items: {
    include: { options: { orderBy: { sortOrder: "asc" as const } } },
    orderBy: { sortOrder: "asc" as const },
  },
};

// ─── 模板服务 ─────────────────────────────────────────────────────────────────

export const HallDailyTemplateService = {
  async list(params: {
    teamOrgId?: string;
    status?: string;
    scopePath?: string;
    roleCode?: string;
    limit?: number;
    offset?: number;
  }) {
    const { teamOrgId, status, scopePath, roleCode, limit, offset } = params;
    ensureHallDailyRole(roleCode);
    ensureTeamScopeSelected(teamOrgId);

    // 验证团队组织权限
    await resolveTeamOrg(teamOrgId!, scopePath, roleCode);

    const where: any = { teamOrgId };
    if (status) where.status = status;

    return prisma.hallTaskTemplate.findMany({
      where,
      include: {
        ...TEMPLATE_INCLUDE,
        _count: { select: { assignments: true } },
      },
      orderBy: { createdAt: "desc" },
      ...(offset && offset > 0 ? { skip: offset } : {}),
      ...(limit && limit > 0 ? { take: limit } : {}),
    });
  },

  async getById(id: string, scopePath?: string, roleCode?: string, teamOrgId?: string) {
    ensureHallDailyRole(roleCode);
    const template = await prisma.hallTaskTemplate.findUnique({
      where: { id },
      include: TEMPLATE_INCLUDE,
    });
    if (!template) throw new Error("HALL_TASK_TEMPLATE_NOT_FOUND");
    if (teamOrgId && template.teamOrgId !== teamOrgId) throw new Error("HALL_TASK_TEMPLATE_NOT_FOUND");
    await resolveTeamOrg(template.teamOrgId, scopePath, roleCode);
    return template;
  },

  async create(data: {
    title: string;
    description?: string;
    teamOrgId: string;
    createdBy: string;
    scopePath?: string;
    roleCode?: string;
    items: Array<{
      sortOrder: number;
      itemType: string;
      title: string;
      isRequired?: boolean;
      linkUrl?: string;
      options?: Array<{ sortOrder: number; label: string }>;
    }>;
  }) {
    ensureHallDailyRole(data.roleCode);
    ensureTeamScopeSelected(data.teamOrgId);
    await resolveTeamOrg(data.teamOrgId, data.scopePath, data.roleCode);

    const normalizedItems = normalizeHallTaskItems(data.items);

    return prisma.hallTaskTemplate.create({
      data: {
        title: data.title,
        description: data.description,
        teamOrgId: data.teamOrgId,
        createdBy: data.createdBy,
        version: 1,
        status: "draft",
        items: {
          create: normalizedItems.map((item) => ({
            sortOrder: item.sortOrder,
            itemType: item.itemType as any,
            title: item.title,
            isRequired: item.isRequired,
            linkUrl: item.linkUrl,
            options: item.options.length
              ? { create: item.options.map((opt) => ({ sortOrder: opt.sortOrder, label: opt.label })) }
              : undefined,
          })),
        },
      },
      include: { items: { include: { options: true }, orderBy: { sortOrder: "asc" } } },
    });
  },

  async update(
    id: string,
    data: {
      title?: string;
      description?: string;
      items?: Array<{
        sortOrder: number;
        itemType: string;
        title: string;
        isRequired?: boolean;
        linkUrl?: string;
        options?: Array<{ sortOrder: number; label: string }>;
      }>;
    },
    scopePath?: string,
    roleCode?: string,
    teamOrgId?: string
  ) {
    ensureHallDailyRole(roleCode);
    return prisma.$transaction(async (tx) => {
      const template = await tx.hallTaskTemplate.findUnique({ where: { id } });
      if (!template) throw new Error("HALL_TASK_TEMPLATE_NOT_FOUND");
      if (teamOrgId && template.teamOrgId !== teamOrgId) throw new Error("HALL_TASK_TEMPLATE_NOT_FOUND");
      await resolveTeamOrg(template.teamOrgId, scopePath, roleCode);

      // 有生效/已发布任务时禁止修改
      const blockedCount = await tx.hallTaskAssignment.count({
        where: { templateId: id, status: { in: ["active", "scheduled"] } },
      });
      if (blockedCount > 0) throw new Error("HALL_TASK_TEMPLATE_IN_USE");

      if (data.items !== undefined) {
        const normalizedItems = normalizeHallTaskItems(data.items);
        const oldItems = await tx.hallTaskItem.findMany({ where: { templateId: id }, select: { id: true } });
        for (const item of oldItems) {
          await tx.hallTaskItemOption.deleteMany({ where: { taskItemId: item.id } });
        }
        await tx.hallTaskItem.deleteMany({ where: { templateId: id } });
        for (const item of normalizedItems) {
          const created = await tx.hallTaskItem.create({
            data: {
              templateId: id,
              sortOrder: item.sortOrder,
              itemType: item.itemType as any,
              title: item.title,
              isRequired: item.isRequired,
              linkUrl: item.linkUrl,
            },
          });
          if (item.options.length) {
            await tx.hallTaskItemOption.createMany({
              data: item.options.map((opt) => ({ taskItemId: created.id, sortOrder: opt.sortOrder, label: opt.label })),
            });
          }
        }
      }

      return tx.hallTaskTemplate.update({
        where: { id },
        data: { title: data.title, description: data.description },
        include: { items: { include: { options: true }, orderBy: { sortOrder: "asc" } } },
      });
    });
  },

  async remove(id: string, scopePath?: string, roleCode?: string, teamOrgId?: string) {
    ensureHallDailyRole(roleCode);
    return prisma.$transaction(async (tx) => {
      const template = await tx.hallTaskTemplate.findUnique({
        where: { id },
        include: { items: { select: { id: true } }, assignments: { select: { id: true, status: true } } },
      });
      if (!template) throw new Error("HALL_TASK_TEMPLATE_NOT_FOUND");
      if (teamOrgId && template.teamOrgId !== teamOrgId) throw new Error("HALL_TASK_TEMPLATE_NOT_FOUND");
      await resolveTeamOrg(template.teamOrgId, scopePath, roleCode);

      const hasActive = template.assignments.some((a: any) => ["active", "scheduled", "ended"].includes(a.status));
      if (hasActive) throw new Error("HALL_TASK_TEMPLATE_HAS_ASSIGNMENTS");

      const draftIds = template.assignments.map((a: any) => a.id);
      if (draftIds.length > 0) {
        await tx.hallTaskAssignmentTarget.deleteMany({ where: { assignmentId: { in: draftIds } } });
        await tx.hallTaskAssignment.deleteMany({ where: { id: { in: draftIds } } });
      }
      const itemIds = template.items.map((i: any) => i.id);
      if (itemIds.length > 0) {
        await tx.hallTaskItemOption.deleteMany({ where: { taskItemId: { in: itemIds } } });
      }
      await tx.hallTaskItem.deleteMany({ where: { templateId: id } });
      await tx.hallTaskTemplate.delete({ where: { id } });

      return { deleted: true, id };
    });
  },

  async copy(id: string, operatorUserId: string, scopePath?: string, roleCode?: string, teamOrgId?: string) {
    ensureHallDailyRole(roleCode);
    const source = await prisma.hallTaskTemplate.findUnique({
      where: { id },
      include: { items: { include: { options: true }, orderBy: { sortOrder: "asc" } } },
    });
    if (!source) throw new Error("HALL_TASK_TEMPLATE_NOT_FOUND");
    if (teamOrgId && source.teamOrgId !== teamOrgId) throw new Error("HALL_TASK_TEMPLATE_NOT_FOUND");
    await resolveTeamOrg(source.teamOrgId, scopePath, roleCode);

    const normalizedItems = normalizeHallTaskItems(
      source.items.map((item: any) => ({
        sortOrder: item.sortOrder,
        itemType: item.itemType,
        title: item.title,
        isRequired: item.isRequired,
        linkUrl: item.linkUrl,
        options: item.options?.map((opt: any) => ({ sortOrder: opt.sortOrder, label: opt.label })) ?? [],
      }))
    );

    return prisma.hallTaskTemplate.create({
      data: {
        title: source.title + "（副本）",
        description: source.description,
        teamOrgId: source.teamOrgId,
        createdBy: operatorUserId,
        version: 1,
        status: "draft",
        items: {
          create: normalizedItems.map((item) => ({
            sortOrder: item.sortOrder,
            itemType: item.itemType as any,
            title: item.title,
            isRequired: item.isRequired,
            linkUrl: item.linkUrl,
            options: item.options.length
              ? { create: item.options.map((opt) => ({ sortOrder: opt.sortOrder, label: opt.label })) }
              : undefined,
          })),
        },
      },
      include: { items: { include: { options: true }, orderBy: { sortOrder: "asc" } } },
    });
  },

  async publish(id: string, scopePath?: string, roleCode?: string, teamOrgId?: string) {
    ensureHallDailyRole(roleCode);
    return prisma.$transaction(async (tx) => {
      const template = await tx.hallTaskTemplate.findUnique({
        where: { id },
        include: { items: { select: { id: true } } },
      });
      if (!template) throw new Error("HALL_TASK_TEMPLATE_NOT_FOUND");
      if (teamOrgId && template.teamOrgId !== teamOrgId) throw new Error("HALL_TASK_TEMPLATE_NOT_FOUND");
      await resolveTeamOrg(template.teamOrgId, scopePath, roleCode);
      if (template.status === "archived") throw new Error("HALL_TASK_TEMPLATE_ARCHIVED");
      if (template.items.length === 0) throw new Error("HALL_TASK_TEMPLATE_NO_ITEMS");

      return tx.hallTaskTemplate.update({
        where: { id },
        data: { status: "published" },
        include: { items: { include: { options: true }, orderBy: { sortOrder: "asc" } } },
      });
    });
  },

  async archive(id: string, scopePath?: string, roleCode?: string, teamOrgId?: string) {
    ensureHallDailyRole(roleCode);
    const template = await prisma.hallTaskTemplate.findUnique({ where: { id } });
    if (!template) throw new Error("HALL_TASK_TEMPLATE_NOT_FOUND");
    if (teamOrgId && template.teamOrgId !== teamOrgId) throw new Error("HALL_TASK_TEMPLATE_NOT_FOUND");
    await resolveTeamOrg(template.teamOrgId, scopePath, roleCode);

    return prisma.hallTaskTemplate.update({
      where: { id },
      data: { status: "archived" },
      include: { items: { include: { options: true }, orderBy: { sortOrder: "asc" } } },
    });
  },
};

// ─── 发布服务 ─────────────────────────────────────────────────────────────────

export const HallDailyAssignmentService = {
  async list(params: {
    teamOrgId?: string;
    status?: string;
    scopePath?: string;
    roleCode?: string;
    limit?: number;
    offset?: number;
  }) {
    const { teamOrgId, status, scopePath, roleCode, limit, offset } = params;
    ensureHallDailyRole(roleCode);
    ensureTeamScopeSelected(teamOrgId);
    await resolveTeamOrg(teamOrgId!, scopePath, roleCode);

    const where: any = { teamOrgId };
    if (status) where.status = status;

    return prisma.hallTaskAssignment.findMany({
      where,
      include: {
        template: { select: { id: true, title: true, status: true } },
        targets: { include: { hallOrg: { select: { id: true, name: true } } } },
        _count: { select: { records: true } },
      },
      orderBy: { createdAt: "desc" },
      ...(offset && offset > 0 ? { skip: offset } : {}),
      ...(limit && limit > 0 ? { take: limit } : {}),
    });
  },

  // 保存草稿（创建或更新）
  async saveDraft(data: {
    assignmentId?: string;
    templateId: string;
    teamOrgId: string;
    hallOrgIds: string[];
    effectMode?: "immediate" | "next_midnight";
    createdBy: string;
    scopePath?: string;
    roleCode?: string;
  }) {
    ensureHallDailyRole(data.roleCode);
    ensureTeamScopeSelected(data.teamOrgId);
    await resolveTeamOrg(data.teamOrgId, data.scopePath, data.roleCode);

    const template = await prisma.hallTaskTemplate.findUnique({ where: { id: data.templateId } });
    if (!template) throw new Error("HALL_TASK_TEMPLATE_NOT_FOUND");
    if (template.teamOrgId !== data.teamOrgId) throw new Error("HALL_TASK_TEMPLATE_TEAM_MISMATCH");
    if (template.status === "archived") throw new Error("HALL_TASK_TEMPLATE_ARCHIVED");

    // 验证目标厅都属于该团队
    if (data.hallOrgIds.length > 0) {
      const halls = await prisma.orgUnit.findMany({
        where: { id: { in: data.hallOrgIds }, orgType: "HALL", status: "active" },
        select: { id: true, path: true },
      });
      const teamOrg = await prisma.orgUnit.findUnique({ where: { id: data.teamOrgId }, select: { path: true } });
      const invalidHalls = halls.filter((h) => !h.path.startsWith(`${teamOrg!.path}/`));
      if (invalidHalls.length > 0) throw new Error("HALL_DAILY_HALL_NOT_IN_TEAM");
    }

    return prisma.$transaction(async (tx) => {
      let assignmentId = data.assignmentId;
      if (assignmentId) {
        const existing = await tx.hallTaskAssignment.findUnique({ where: { id: assignmentId } });
        if (!existing) throw new Error("HALL_TASK_ASSIGNMENT_NOT_FOUND");
        if (existing.teamOrgId !== data.teamOrgId) throw new Error("HALL_TASK_ASSIGNMENT_NOT_FOUND");
        if (existing.status !== "draft") throw new Error("HALL_TASK_ASSIGNMENT_NOT_DRAFT");
        await tx.hallTaskAssignment.update({
          where: { id: assignmentId },
          data: { templateId: data.templateId, effectMode: data.effectMode ?? "immediate" },
        });
      } else {
        const created = await tx.hallTaskAssignment.create({
          data: {
            templateId: data.templateId,
            teamOrgId: data.teamOrgId,
            status: "draft",
            effectMode: data.effectMode ?? "immediate",
            createdBy: data.createdBy,
            createdByOrgId: data.teamOrgId,
          },
        });
        assignmentId = created.id;
      }

      // 覆盖目标厅
      await tx.hallTaskAssignmentTarget.deleteMany({ where: { assignmentId } });
      if (data.hallOrgIds.length > 0) {
        await tx.hallTaskAssignmentTarget.createMany({
          data: data.hallOrgIds.map((hallOrgId) => ({ assignmentId: assignmentId!, hallOrgId })),
        });
      }

      return tx.hallTaskAssignment.findUnique({
        where: { id: assignmentId },
        include: {
          template: { select: { id: true, title: true, status: true } },
          targets: { include: { hallOrg: { select: { id: true, name: true } } } },
        },
      });
    });
  },

  // 发布预览
  async getPublishPreview(id: string, scopePath?: string, roleCode?: string, teamOrgId?: string) {
    ensureHallDailyRole(roleCode);
    const assignment = await prisma.hallTaskAssignment.findUnique({
      where: { id },
      include: {
        template: { select: { id: true, title: true } },
        targets: { include: { hallOrg: { select: { id: true, name: true } } } },
      },
    });
    if (!assignment) throw new Error("HALL_TASK_ASSIGNMENT_NOT_FOUND");
    if (teamOrgId && assignment.teamOrgId !== teamOrgId) throw new Error("HALL_TASK_ASSIGNMENT_NOT_FOUND");
    await resolveTeamOrg(assignment.teamOrgId, scopePath, roleCode);
    if (assignment.status !== "draft") throw new Error("HALL_TASK_ASSIGNMENT_NOT_DRAFT");

    // 检查目标厅是否已有生效任务
    const activeAssignments = await prisma.hallTaskAssignment.findMany({
      where: {
        teamOrgId: assignment.teamOrgId,
        status: { in: ["active", "scheduled"] },
        id: { not: id },
      },
      include: {
        template: { select: { title: true } },
        targets: { select: { hallOrgId: true } },
      },
    });

    const targetHallIds = new Set(assignment.targets.map((t: any) => t.hallOrgId));
    const overlapping = activeAssignments
      .filter((a: any) => a.targets.some((t: any) => targetHallIds.has(t.hallOrgId)))
      .map((a: any) => ({ id: a.id, title: a.template.title, status: a.status }));

    return {
      assignmentId: assignment.id,
      templateId: assignment.templateId,
      templateTitle: (assignment as any).template.title,
      effectMode: assignment.effectMode,
      targetOrgCount: assignment.targets.length,
      targetOrgs: assignment.targets.map((t: any) => ({ id: t.hallOrg.id, name: t.hallOrg.name })),
      overlappingAssignments: overlapping,
    };
  },

  // 正式发布
  async publish(id: string, effectMode: "immediate" | "next_midnight", scopePath?: string, roleCode?: string, teamOrgId?: string) {
    ensureHallDailyRole(roleCode);
    return prisma.$transaction(async (tx) => {
      const assignment = await tx.hallTaskAssignment.findUnique({
        where: { id },
        include: { targets: true, template: true },
      });
      if (!assignment) throw new Error("HALL_TASK_ASSIGNMENT_NOT_FOUND");
      if (teamOrgId && assignment.teamOrgId !== teamOrgId) throw new Error("HALL_TASK_ASSIGNMENT_NOT_FOUND");
      await resolveTeamOrg(assignment.teamOrgId, scopePath, roleCode);
      if (assignment.status !== "draft") throw new Error("HALL_TASK_ASSIGNMENT_NOT_DRAFT");
      if (assignment.targets.length === 0) throw new Error("HALL_TASK_ASSIGNMENT_TARGETS_REQUIRED");
      if ((assignment as any).template.status !== "published") throw new Error("HALL_TASK_TEMPLATE_NOT_PUBLISHED");

      const now = new Date();
      const nextMidnight = new Date(now);
      nextMidnight.setDate(nextMidnight.getDate() + 1);
      nextMidnight.setHours(0, 0, 0, 0);

      const nextStatus = effectMode === "next_midnight" ? "scheduled" : "active";
      const effectiveAt = effectMode === "next_midnight" ? nextMidnight : now;

      // 结束同团队下其他生效中的厅管日常任务
      await tx.hallTaskAssignment.updateMany({
        where: {
          teamOrgId: assignment.teamOrgId,
          status: "active",
          id: { not: id },
        },
        data: { status: "ended", endedAt: now },
      });

      // 如果新任务是次日生效，检查是否有其他待生效任务
      if (nextStatus === "scheduled") {
        const existingScheduled = await tx.hallTaskAssignment.findFirst({
          where: { teamOrgId: assignment.teamOrgId, status: "scheduled", id: { not: id } },
        });
        if (existingScheduled) throw new Error("HALL_TASK_ASSIGNMENT_SCHEDULED_EXISTS");
      }

      return tx.hallTaskAssignment.update({
        where: { id },
        data: {
          status: nextStatus,
          effectMode,
          effectiveAt,
          publishedAt: now,
        },
        include: {
          template: { select: { id: true, title: true } },
          targets: { include: { hallOrg: { select: { id: true, name: true } } } },
        },
      });
    });
  },

  async close(id: string, scopePath?: string, roleCode?: string, teamOrgId?: string) {
    ensureHallDailyRole(roleCode);
    const assignment = await prisma.hallTaskAssignment.findUnique({ where: { id } });
    if (!assignment) throw new Error("HALL_TASK_ASSIGNMENT_NOT_FOUND");
    if (teamOrgId && assignment.teamOrgId !== teamOrgId) throw new Error("HALL_TASK_ASSIGNMENT_NOT_FOUND");
    await resolveTeamOrg(assignment.teamOrgId, scopePath, roleCode);
    if (!["active", "scheduled"].includes(assignment.status)) throw new Error("HALL_TASK_ASSIGNMENT_CANNOT_CLOSE");

    return prisma.hallTaskAssignment.update({
      where: { id },
      data: { status: "ended", endedAt: new Date() },
      include: {
        template: { select: { id: true, title: true } },
        targets: { include: { hallOrg: { select: { id: true, name: true } } } },
      },
    });
  },

  async delete(id: string, scopePath?: string, roleCode?: string, teamOrgId?: string) {
    ensureHallDailyRole(roleCode);
    return prisma.$transaction(async (tx) => {
      const assignment = await tx.hallTaskAssignment.findUnique({ where: { id } });
      if (!assignment) throw new Error("HALL_TASK_ASSIGNMENT_NOT_FOUND");
      if (teamOrgId && assignment.teamOrgId !== teamOrgId) throw new Error("HALL_TASK_ASSIGNMENT_NOT_FOUND");
      await resolveTeamOrg(assignment.teamOrgId, scopePath, roleCode);
      if (assignment.status !== "draft") throw new Error("HALL_TASK_ASSIGNMENT_NOT_DRAFT");

      await tx.hallTaskAssignmentTarget.deleteMany({ where: { assignmentId: id } });
      await tx.hallTaskAssignment.delete({ where: { id } });
      return { deleted: true, id };
    });
  },
};
