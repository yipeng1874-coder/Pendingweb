import { Router } from "express";
import multer from "multer";
import * as xlsx from "xlsx";
import { authRequired } from "../../middleware/authRequired.js";
import { identityRequired } from "../../middleware/identityRequired.js";
import { permissionRequired } from "../../middleware/permissionRequired.js";
import { prisma } from "../../shared/prisma.js";
import { fail, ok } from "../../shared/response.js";

// ---------- 工具函数 ----------

/** 将 Excel 序列号或字符串日期统一解析为 Date | null */
function parseExcelDate(val: unknown): Date | null {
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === "number") {
    // Excel 以 1900-01-01 = 1 起算，并错误地把 1900-02-29 当作存在
    const d = new Date((val - 25567) * 86400 * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === "string") {
    const cleaned = val.replace(/\//g, "-").trim();
    const d = new Date(cleaned);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function isWithinDays(date: Date, days: number, today: Date): boolean {
  const diffMs = today.getTime() - date.getTime();
  const diffDays = diffMs / 86400000;
  return diffDays >= 0 && diffDays <= days;
}

/** 解析 BASE 级别作用域（与 report.routes.ts 保持一致） */
async function resolveBaseScopeOrg(scopeOrgId: string | undefined, identity: any) {
  const roleCode = identity?.roleCode;
  const scopePath = identity?.scopePath;
  const identityOrgId = identity?.orgId;

  if (roleCode === "HQ_ADMIN" || roleCode === "DEV_ADMIN") {
    if (!scopeOrgId) throw new Error("BASE_SCOPE_REQUIRED");
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

// ---------- multer（内存存储，不写磁盘） ----------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter(_req, file, cb) {
    const allowed = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "application/octet-stream",
    ];
    // 也兼容文件名后缀
    const ext = file.originalname.split(".").pop()?.toLowerCase();
    if (allowed.includes(file.mimetype) || ext === "xlsx" || ext === "xls") {
      cb(null, true);
    } else {
      cb(new Error("ONLY_EXCEL_ALLOWED"));
    }
  },
});

// ---------- 必要列名 ----------

const REQUIRED_COLS = ["主播昵称", "所属基地", "所属运营", "主播类型"];

// 入职/加入日期列候选（兼容多种表头命名）
const JOIN_DATE_COL_CANDIDATES = ["入职日期", "加入时间", "入职时间", "加入日期"];

export type OperatorStat = {
  name: string;
  totalCount: number;
  onlineCount: number;
  offlineCount: number;
  within7Days: number;
  within30Days: number;
};

// ---------- 路由 ----------

export const anchorSummaryRoutes = Router();
anchorSummaryRoutes.use(authRequired, identityRequired);

/** 上传接口：POST /anchor-summary/upload */
anchorSummaryRoutes.post(
  "/anchor-summary/upload",
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

    // 鉴权角色校验：TEAM_ADMIN / HALL_MANAGER 不允许上传
    const roleCode = req.identity?.roleCode;
    if (roleCode === "TEAM_ADMIN" || roleCode === "HALL_MANAGER") {
      return fail(res, "FORBIDDEN", "无权上传主播汇总表", 403);
    }

    // 解析作用域基地
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

    // 解析 Excel
    let wb: xlsx.WorkBook;
    try {
      wb = xlsx.read(req.file.buffer, { type: "buffer", cellDates: true });
    } catch {
      return fail(res, "PARSE_ERROR", "Excel 文件解析失败，请确认文件格式正确", 400);
    }

    const sheetName = wb.SheetNames[0];
    if (!sheetName) return fail(res, "EMPTY_FILE", "Excel 文件为空", 400);

    const sheet = wb.Sheets[sheetName];
    const rows: Record<string, unknown>[] = xlsx.utils.sheet_to_json(sheet, {
      raw: false,
      defval: "",
    });

    if (rows.length === 0) {
      return fail(res, "EMPTY_SHEET", "表格无数据行", 400);
    }

    // 校验列头
    const headers = Object.keys(rows[0]);
    const missing = REQUIRED_COLS.filter((col) => !headers.includes(col));
    if (missing.length > 0) {
      return fail(res, "MISSING_COLUMNS", `表格缺少必要列：${missing.join("、")}`, 400);
    }

    // 找入职日期列
    const joinDateCol = JOIN_DATE_COL_CANDIDATES.find((c) => headers.includes(c)) ?? null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let totalCount = 0;
    let onlineCount = 0;
    let offlineCount = 0;
    let within7Days = 0;
    let within30Days = 0;

    const operatorMap = new Map<string, OperatorStat>();

    for (const row of rows) {
      const operatorName = String(row["所属运营"] ?? "").trim() || "未知运营";
      // 直接用"主播类型"字段判断线上/线下
      const anchorType = String(row["主播类型"] ?? "").trim();
      const isOnline = anchorType === "线上";

      // 解析入职/加入日期
      const rawDateVal = joinDateCol ? row[joinDateCol] : undefined;
      let joinDate: Date | null = null;
      if (rawDateVal instanceof Date) {
        joinDate = rawDateVal;
      } else {
        joinDate = parseExcelDate(rawDateVal);
      }

      totalCount++;
      if (isOnline) onlineCount++;
      else offlineCount++;

      if (joinDate) {
        if (isWithinDays(joinDate, 7, today)) within7Days++;
        if (isWithinDays(joinDate, 30, today)) within30Days++;
      }

      // 运营分组
      if (!operatorMap.has(operatorName)) {
        operatorMap.set(operatorName, {
          name: operatorName,
          totalCount: 0,
          onlineCount: 0,
          offlineCount: 0,
          within7Days: 0,
          within30Days: 0,
        });
      }
      const opStat = operatorMap.get(operatorName)!;
      opStat.totalCount++;
      if (isOnline) opStat.onlineCount++;
      else opStat.offlineCount++;
      if (joinDate) {
        if (isWithinDays(joinDate, 7, today)) opStat.within7Days++;
        if (isWithinDays(joinDate, 30, today)) opStat.within30Days++;
      }
    }

    const operatorStats: OperatorStat[] = Array.from(operatorMap.values()).sort((a, b) =>
      b.totalCount - a.totalCount
    );

    // 获取上传者昵称
    const uploader = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { nickname: true },
    });

    const uploadDate = today.toISOString().slice(0, 10);

    // upsert
    const record = await prisma.anchorDailySummary.upsert({
      where: { baseOrgId: baseOrg.id },
      create: {
        baseOrgId: baseOrg.id,
        baseOrgName: baseOrg.name,
        uploadDate,
        uploadedBy: req.userId,
        uploaderName: uploader?.nickname ?? "未知",
        totalCount,
        onlineCount,
        offlineCount,
        within7Days,
        within30Days,
        operatorStats,
        rawRowCount: rows.length,
      },
      update: {
        baseOrgName: baseOrg.name,
        uploadDate,
        uploadedBy: req.userId,
        uploaderName: uploader?.nickname ?? "未知",
        totalCount,
        onlineCount,
        offlineCount,
        within7Days,
        within30Days,
        operatorStats,
        rawRowCount: rows.length,
      },
    });

    return ok(res, record);
  }
);

/** 查询接口：GET /anchor-summary/latest?scopeOrgId=xxx */
anchorSummaryRoutes.get(
  "/anchor-summary/latest",
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

    const record = await prisma.anchorDailySummary.findUnique({
      where: { baseOrgId: baseOrg.id },
    });

    return ok(res, record ?? null);
  }
);
