import { Router } from "express";
import { authRequired } from "../../middleware/authRequired.js";
import { identityRequired } from "../../middleware/identityRequired.js";
import { permissionRequired } from "../../middleware/permissionRequired.js";
import { prisma } from "../../shared/prisma.js";
import { fail, ok } from "../../shared/response.js";

async function resolveBaseScopeOrg(scopeOrgId: string | undefined, identity: any) {
  const roleCode = identity?.roleCode;
  const scopePath = identity?.scopePath;
  const identityOrgId = identity?.orgId;

  if (roleCode === "HQ_ADMIN" || roleCode === "DEV_ADMIN") {
    if (!scopeOrgId) {
      const where: any = { status: "active", orgType: "BASE" };
      if (roleCode !== "DEV_ADMIN" && scopePath) {
        where.path = { startsWith: scopePath };
      }
      const fallback = await prisma.orgUnit.findFirst({ where, orderBy: { depth: "asc" } });
      if (fallback) return fallback as any;
      throw new Error("BASE_SCOPE_REQUIRED");
    }
    const org = await prisma.orgUnit.findFirst({
      where: { id: scopeOrgId, status: "active", orgType: "BASE" },
      select: { id: true, name: true, path: true, orgType: true },
    });
    if (!org) throw new Error("SCOPE_ORG_NOT_FOUND");
    if (roleCode !== "DEV_ADMIN" && scopePath && !(org.path === scopePath || org.path.startsWith(`${scopePath}/`))) {
      throw new Error("SCOPE_ORG_FORBIDDEN");
    }
    return org;
  }

  if (!identityOrgId) throw new Error("SCOPE_ORG_NOT_FOUND");
  const org = await prisma.orgUnit.findFirst({
    where: { id: identityOrgId, status: "active" },
    select: { id: true, name: true, path: true, orgType: true },
  });
  if (!org) throw new Error("SCOPE_ORG_NOT_FOUND");

  const base = await prisma.orgUnit.findFirst({
    where: { status: "active", orgType: "BASE", path: { in: org.path.split("/").filter(Boolean).map((_, i, a) => `/${a.slice(0, i + 1).join("/")}`) } },
    orderBy: { depth: "desc" },
    select: { id: true, name: true, path: true, orgType: true },
  });
  if (!base) throw new Error("BASE_SCOPE_REQUIRED");
  return base;
}

export const liveRoomCapacityRoutes = Router();
liveRoomCapacityRoutes.use(authRequired, identityRequired);

/** POST /live-room-capacity/upsert — 覆盖式写入 */
liveRoomCapacityRoutes.post(
  "/live-room-capacity/upsert",
  permissionRequired("task:report:view"),
  async (req: any, res: any) => {
    const roleCode = req.identity?.roleCode;
    if (roleCode === "TEAM_ADMIN" || roleCode === "HALL_MANAGER") {
      return fail(res, "FORBIDDEN", "无权录入直播间空余数据", 403);
    }

    let baseOrg: { id: string; name: string };
    try {
      baseOrg = await resolveBaseScopeOrg(req.query.scopeOrgId as string | undefined, req.identity);
    } catch (e: any) {
      return fail(res, e.message, "基地鉴权失败", 403);
    }

    const { totalCount, liveRoomUsed, officeUsed } = req.body ?? {};
    if (totalCount == null || liveRoomUsed == null || officeUsed == null) {
      return fail(res, "MISSING_PARAMS", "请填写总数量、直播间已使用、办公室已使用", 400);
    }
    if (!Number.isInteger(totalCount) || totalCount < 0) return fail(res, "INVALID_PARAM", "总数量需为非负整数", 400);
    if (!Number.isInteger(liveRoomUsed) || liveRoomUsed < 0) return fail(res, "INVALID_PARAM", "直播间已使用需为非负整数", 400);
    if (!Number.isInteger(officeUsed) || officeUsed < 0) return fail(res, "INVALID_PARAM", "办公室已使用需为非负整数", 400);

    const uploader = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { nickname: true },
    });

    const record = await prisma.liveRoomCapacity.upsert({
      where: { baseOrgId: baseOrg.id },
      create: {
        baseOrgId: baseOrg.id,
        baseOrgName: baseOrg.name,
        totalCount,
        liveRoomUsed,
        officeUsed,
        updatedBy: req.userId,
        updaterName: uploader?.nickname ?? "未知",
      },
      update: {
        baseOrgName: baseOrg.name,
        totalCount,
        liveRoomUsed,
        officeUsed,
        updatedBy: req.userId,
        updaterName: uploader?.nickname ?? "未知",
      },
    });

    return ok(res, record);
  }
);

/** GET /live-room-capacity/latest?scopeOrgId=xxx */
liveRoomCapacityRoutes.get(
  "/live-room-capacity/latest",
  permissionRequired("task:report:view"),
  async (req: any, res: any) => {
    let baseOrg: { id: string; name: string };
    try {
      baseOrg = await resolveBaseScopeOrg(req.query.scopeOrgId as string | undefined, req.identity);
    } catch {
      return fail(res, "SCOPE_ERROR", "基地鉴权失败", 403);
    }

    const record = await prisma.liveRoomCapacity.findFirst({
      where: { baseOrgId: baseOrg.id },
    });

    return ok(res, record ?? null);
  }
);
