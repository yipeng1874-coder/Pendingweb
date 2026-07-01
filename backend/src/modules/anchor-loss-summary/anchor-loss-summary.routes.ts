import { Router } from "express";
import multer from "multer";
import * as xlsx from "xlsx";
import { authRequired } from "../../middleware/authRequired.js";
import { identityRequired } from "../../middleware/identityRequired.js";
import { permissionRequired } from "../../middleware/permissionRequired.js";
import { prisma } from "../../shared/prisma.js";
import { fail, ok } from "../../shared/response.js";

// ---------- multer ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const allowed = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "application/octet-stream",
    ];
    const ext = file.originalname.split(".").pop()?.toLowerCase();
    if (allowed.includes(file.mimetype) || ext === "xlsx" || ext === "xls") {
      cb(null, true);
    } else {
      cb(new Error("ONLY_EXCEL_ALLOWED"));
    }
  },
});

// ---------- 解析 BASE 级别作用域 ----------
async function resolveBaseScopeOrg(scopeOrgId: string | undefined, identity: any) {
  const roleCode = identity?.roleCode;
  const scopePath = identity?.scopePath;
  const identityOrgId = identity?.orgId;

  if (roleCode === "HQ_ADMIN" || roleCode === "DEV_ADMIN") {
    if (!scopeOrgId) {
      // 对 DEV_ADMIN 自动取第一个 BASE；对 HQ_ADMIN 取 scopePath 下的第一个 BASE
      const where: any = { status: "active", orgType: "BASE" };
      if (roleCode !== "DEV_ADMIN" && scopePath) {
        where.path = { startsWith: scopePath };
      }
      const fallback = await prisma.orgUnit.findFirst({ where, orderBy: { depth: "asc" } });
      if (fallback) {
        return fallback as { id: string; name: string; path: string; orgType: string };
      }
      throw new Error("BASE_SCOPE_REQUIRED");
    }
    const org = await prisma.orgUnit.findFirst({
      where: { id: scopeOrgId, status: "active", orgType: "BASE" },
      select: { id: true, name: true, path: true, orgType: true },
    });
    if (!org) throw new Error("SCOPE_ORG_NOT_FOUND");
    if (
      roleCode !== "DEV_ADMIN" &&
      scopePath &&
      !(org.path === scopePath || org.path.startsWith(`${scopePath}/`))
    ) {
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
    where: {
      status: "active",
      orgType: "BASE",
      path: {
        in: org.path
          .split("/")
          .filter(Boolean)
          .map((_, index, parts) => `/${parts.slice(0, index + 1).join("/")}`),
      },
    },
    orderBy: { depth: "desc" },
    select: { id: true, name: true, path: true, orgType: true },
  });
  if (!base) throw new Error("BASE_SCOPE_REQUIRED");
  return base;
}

/** 将 Excel 日期转为本地日期字符串 yyyy-MM-dd */
function parseDateStr(val: unknown): string | null {
  if (typeof val === "string") {
    const parts = val.trim().split(/[\/\-]/);
    if (parts.length === 3) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const d = parseInt(parts[2], 10);
      if (y && m && d) {
        return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      }
    }
  }
  if (typeof val === "number") {
    const date = new Date((val - 25567) * 86400 * 1000);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }
  return null;
}

/** 计算 yyyy-MM-dd 的前 N 天 */
function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

// ---------- 必要列 ----------
const REQUIRED_COLS = ["流失时间"];

// ---------- 路由 ----------
export const anchorLossSummaryRoutes = Router();
anchorLossSummaryRoutes.use(authRequired, identityRequired);

/** POST /anchor-loss-summary/upload */
anchorLossSummaryRoutes.post(
  "/anchor-loss-summary/upload",
  permissionRequired("task:report:view"),
  (req: any, res: any, next: any) => {
    upload.single("file")(req, res, (err: any) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE")
          return fail(res, "FILE_TOO_LARGE", "文件不得超过 10MB", 400);
        if (err.message === "ONLY_EXCEL_ALLOWED")
          return fail(res, "MIME_NOT_ALLOWED", "只支持上传 xlsx / xls 格式文件", 400);
        return fail(res, "UPLOAD_ERROR", "上传失败", 500);
      }
      next();
    });
  },
  async (req: any, res: any) => {
    if (!req.file) return fail(res, "NO_FILE", "请选择要上传的 Excel 文件", 400);

    const roleCode = req.identity?.roleCode;
    if (roleCode === "TEAM_ADMIN" || roleCode === "HALL_MANAGER") {
      return fail(res, "FORBIDDEN", "无权上传", 403);
    }

    let baseOrg: { id: string; name: string };
    try {
      baseOrg = await resolveBaseScopeOrg(req.query.scopeOrgId as string | undefined, req.identity);
    } catch (e: any) {
      const msgMap: Record<string, string> = {
        BASE_SCOPE_REQUIRED: "请先选择基地",
        SCOPE_ORG_NOT_FOUND: "基地不存在",
        SCOPE_ORG_FORBIDDEN: "无权访问该基地",
      };
      return fail(res, e.message, msgMap[e.message] ?? "鉴权失败", 403);
    }

    const recordDate = (req.body?.recordDate ?? req.query?.recordDate ?? "").toString().trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(recordDate)) {
      return fail(res, "INVALID_RECORD_DATE", "请提供有效的归属日期（YYYY-MM-DD）", 400);
    }

    // 解析 Excel
    let wb: xlsx.WorkBook;
    try {
      wb = xlsx.read(req.file.buffer, { type: "buffer", cellDates: true });
    } catch {
      return fail(res, "PARSE_ERROR", "Excel 文件解析失败", 400);
    }

    const targetSheetName = wb.SheetNames.find((n) => n.trim() === "主播流失");
    if (!targetSheetName) {
      return fail(res, "SHEET_NOT_FOUND", "Excel 中未找到「主播流失」工作表", 400);
    }

    const sheet = wb.Sheets[targetSheetName];
    const rows: Record<string, unknown>[] = xlsx.utils.sheet_to_json(sheet, {
      raw: false,
      defval: "",
    });

    if (rows.length === 0) return fail(res, "EMPTY_SHEET", "表格无数据行", 400);

    const headerRow = rows[0];
    const headerKeys = Object.keys(headerRow);

    // 找「流失时间」列和「所属运营」列
    let lossTimeColKey = "";
    let operatorCol = "";
    for (const k of headerKeys) {
      if (k.includes("流失时间")) lossTimeColKey = k;
      if (k.includes("所属运营")) operatorCol = k;
    }
    if (!lossTimeColKey) {
      return fail(res, "MISSING_COLUMNS", "表格缺少「流失时间」列", 400);
    }

    // 30 天窗口 & 昨天（使用本地日期字符串比较，避免时区偏移）
    const days30Ago = addDays(recordDate, -30);
    // "昨日流失" = 流失时间 = recordDate 本身
    const targetDateStr = recordDate;

    const dataRows = rows.slice(1); // 跳过表头行
    let lossWithin30Days = 0;
    let lossYesterday = 0;
    let totalLossCount = 0;

    for (const row of dataRows) {
      const lossDateStr = parseDateStr(row[lossTimeColKey]);
      if (!lossDateStr) continue;
      totalLossCount++;

      if (lossDateStr >= days30Ago && lossDateStr <= recordDate) {
        lossWithin30Days++;
      }
      if (lossDateStr === targetDateStr) {
        lossYesterday++;
      }
    }

    console.log("[anchor-loss] recordDate:", recordDate, "days30Ago:", days30Ago, "target:", targetDateStr, "30d:", lossWithin30Days, "yesterday:", lossYesterday);

    const uploader = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { nickname: true },
    });

    // 每日 + 每日运营明细
    const dailyMap = new Map<string, number>();
    const dailyOpMap = new Map<string, Record<string, number>>();
    for (const row of dataRows) {
      const ds = parseDateStr(row[lossTimeColKey]);
      if (!ds) continue;
      const op = String(row[operatorCol] ?? "").trim() || "未知运营";
      dailyMap.set(ds, (dailyMap.get(ds) || 0) + 1);
      if (!dailyOpMap.has(ds)) dailyOpMap.set(ds, {});
      dailyOpMap.get(ds)![op] = (dailyOpMap.get(ds)![op] || 0) + 1;
    }
    const lossDetail = Object.fromEntries(dailyMap);
    const lossOperatorDetail: Record<string, Record<string, number>> = {};
    for (const [d, ops] of dailyOpMap) lossOperatorDetail[d] = ops;

    const record = await prisma.anchorLossDailySummary.upsert({
      where: { baseOrgId: baseOrg.id },
      create: {
        baseOrgId: baseOrg.id,
        baseOrgName: baseOrg.name,
        recordDate,
        uploadedBy: req.userId,
        uploaderName: uploader?.nickname ?? "未知",
        lossWithin30Days,
        lossYesterday,
        totalLossCount,
        lossDetail,
        lossOperatorDetail,
        rawRowCount: dataRows.length,
      },
      update: {
        baseOrgName: baseOrg.name,
        recordDate,
        uploadedBy: req.userId,
        uploaderName: uploader?.nickname ?? "未知",
        lossWithin30Days,
        lossYesterday,
        totalLossCount,
        lossDetail,
        lossOperatorDetail,
        rawRowCount: dataRows.length,
      },
    });

    return ok(res, record);
  }
);

/** GET /anchor-loss-summary/latest?scopeOrgId=xxx */
anchorLossSummaryRoutes.get(
  "/anchor-loss-summary/latest",
  permissionRequired("task:report:view"),
  async (req: any, res: any) => {
    let baseOrg: { id: string; name: string };
    try {
      baseOrg = await resolveBaseScopeOrg(req.query.scopeOrgId as string | undefined, req.identity);
    } catch (e: any) {
      const msgMap: Record<string, string> = {
        BASE_SCOPE_REQUIRED: "请先选择基地",
        SCOPE_ORG_NOT_FOUND: "基地不存在",
        SCOPE_ORG_FORBIDDEN: "无权访问该基地",
      };
      return fail(res, e.message, msgMap[e.message] ?? "鉴权失败", 403);
    }
    const record = await prisma.anchorLossDailySummary.findFirst({
      where: { baseOrgId: baseOrg.id },
      orderBy: { recordDate: "desc" },
    });
    return ok(res, record ?? null);
  }
);

/** GET /anchor-loss-summary/trend?scopeOrgId=xxx&days=7 */
anchorLossSummaryRoutes.get(
  "/anchor-loss-summary/trend",
  permissionRequired("task:report:view"),
  async (req: any, res: any) => {
    let baseOrg: { id: string; name: string };
    try {
      baseOrg = await resolveBaseScopeOrg(req.query.scopeOrgId as string | undefined, req.identity);
    } catch (e: any) {
      const msgMap: Record<string, string> = {
        BASE_SCOPE_REQUIRED: "请先选择基地",
        SCOPE_ORG_NOT_FOUND: "基地不存在",
        SCOPE_ORG_FORBIDDEN: "无权访问该基地",
      };
      return fail(res, e.message, msgMap[e.message] ?? "鉴权失败", 403);
    }

    const rawDays = parseInt(req.query.days as string, 10);
    const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(rawDays, 90) : 7;

    // 单条记录（每基地只有一条）
    const record = await prisma.anchorLossDailySummary.findUnique({
      where: { baseOrgId: baseOrg.id },
    });

    if (!record) return ok(res, { baseOrgId: baseOrg.id, baseOrgName: baseOrg.name, points: [], latest: null });

    // 从 lossDetail 提取最近 N 天的数据点（本地日期运算，避免 UTC 偏移）
    const lossDetail = (record.lossDetail as Record<string, number>) || {};
    const points = [];
    const [y0, m0, d0] = record.recordDate.split("-").map(Number);
    for (let i = days - 1; i >= 0; i--) {
      const dt = new Date(y0, m0 - 1, d0 - i);
      const ds = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      points.push({
        recordDate: ds,
        lossWithin30Days: 0,
        lossYesterday: lossDetail[ds] || 0,
        lossDetail: {},
        lossOperatorDetail: {},
      });
    }

    return ok(res, {
      baseOrgId: baseOrg.id,
      baseOrgName: baseOrg.name,
      points,
      latest: {
        id: record.id,
        recordDate: record.recordDate,
        lossWithin30Days: record.lossWithin30Days,
        lossYesterday: record.lossYesterday,
        totalLossCount: record.totalLossCount,
        lossDetail: (record.lossDetail as Record<string, number>) || {},
        lossOperatorDetail: (record.lossOperatorDetail as Record<string, Record<string, number>>) || {},
      },
    });
  }
);
