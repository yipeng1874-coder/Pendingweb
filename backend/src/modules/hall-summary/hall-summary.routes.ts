import { Router } from "express";
import multer from "multer";
import * as xlsx from "xlsx";
import { authRequired } from "../../middleware/authRequired.js";
import { identityRequired } from "../../middleware/identityRequired.js";
import { permissionRequired } from "../../middleware/permissionRequired.js";
import { prisma } from "../../shared/prisma.js";
import { fail, ok } from "../../shared/response.js";

// ---------- 按运营账号分组统计类型 ----------
export type HallOperatorStat = {
  operator: string;         // 运营账号
  formalHallCount: number;  // 正式厅数
  trainingHallCount: number;// 训练厅数
  totalCount: number;       // 合计
};

// ---------- 必要列名 ----------
const REQUIRED_COLS = ["直播厅类型", "运营账号"];

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

// ---------- 路由 ----------
export const hallSummaryRoutes = Router();
hallSummaryRoutes.use(authRequired, identityRequired);

/** POST /hall-summary/upload – 上传 Excel，解析「厅个数」Sheet */
hallSummaryRoutes.post(
  "/hall-summary/upload",
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
      return fail(res, "FORBIDDEN", "无权上传厅个数汇总表", 403);
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
      return fail(res, "PARSE_ERROR", "Excel 文件解析失败，请确认文件格式正确", 400);
    }

    // 查找名为「厅个数」的 Sheet
    const targetSheetName = wb.SheetNames.find(
      (n) => n.trim() === "厅个数"
    );
    if (!targetSheetName) {
      return fail(res, "SHEET_NOT_FOUND", "Excel 中未找到「厅个数」工作表，请确认上传了正确的数据看板文件", 400);
    }

    const sheet = wb.Sheets[targetSheetName];
    // 第 0 行为表头，第 1 行起为数据
    const rows: Record<string, unknown>[] = xlsx.utils.sheet_to_json(sheet, {
      raw: false,
      defval: "",
    });

    if (rows.length === 0) {
      return fail(res, "EMPTY_SHEET", "表格无数据行", 400);
    }

    // 取第 0 行作为列名映射（pandas 读取时第 0 行即为表头）
    const headerRow = rows[0];
    const headerKeys = Object.keys(headerRow);

    // 检查必要列
    const missing = REQUIRED_COLS.filter(
      (col) => !headerKeys.some((k) => k.includes(col) || String(headerRow[k]).includes(col))
    );
    if (missing.length > 0) {
      return fail(res, "MISSING_COLUMNS", `表格缺少必要列：${missing.join("、")}`, 400);
    }

    // 找到「直播厅类型」和「运营账号」对应的列 key
    let typeColKey = "";
    let operatorColKey = "";
    for (const k of headerKeys) {
      const val = String(headerRow[k] ?? "");
      if (val.includes("直播厅类型")) typeColKey = k;
      if (val.includes("运营账号")) operatorColKey = k;
    }

    if (!typeColKey || !operatorColKey) {
      return fail(res, "COLUMN_MAP_ERROR", "无法识别「直播厅类型」或「运营账号」列", 400);
    }

    // 逐行统计（跳过第 0 行表头）
    const dataRows = rows.slice(1);
    let formalHallCount = 0;
    let trainingHallCount = 0;

    const operatorMap = new Map<string, HallOperatorStat>();

    for (const row of dataRows) {
      const hallType = String(row[typeColKey] ?? "").trim();
      const operator = String(row[operatorColKey] ?? "").trim() || "未知运营";

      const isFormal = hallType === "正式厅";
      const isTraining = hallType === "训练厅";

      if (!isFormal && !isTraining) continue; // 跳过非厅类型行

      if (isFormal) formalHallCount++;
      if (isTraining) trainingHallCount++;

      if (!operatorMap.has(operator)) {
        operatorMap.set(operator, {
          operator,
          formalHallCount: 0,
          trainingHallCount: 0,
          totalCount: 0,
        });
      }
      const op = operatorMap.get(operator)!;
      if (isFormal) op.formalHallCount++;
      if (isTraining) op.trainingHallCount++;
      op.totalCount++;
    }

    const totalHallCount = formalHallCount + trainingHallCount;
    const operatorStats: HallOperatorStat[] = Array.from(operatorMap.values()).sort(
      (a, b) => b.totalCount - a.totalCount
    );

    const uploader = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { nickname: true },
    });

    const record = await prisma.hallDailySummary.upsert({
      where: { baseOrgId_recordDate: { baseOrgId: baseOrg.id, recordDate } },
      create: {
        baseOrgId: baseOrg.id,
        baseOrgName: baseOrg.name,
        recordDate,
        uploadedBy: req.userId,
        uploaderName: uploader?.nickname ?? "未知",
        formalHallCount,
        trainingHallCount,
        totalHallCount,
        operatorStats,
        rawRowCount: dataRows.length,
      },
      update: {
        baseOrgName: baseOrg.name,
        uploadedBy: req.userId,
        uploaderName: uploader?.nickname ?? "未知",
        formalHallCount,
        trainingHallCount,
        totalHallCount,
        operatorStats,
        rawRowCount: dataRows.length,
      },
    });

    return ok(res, record);
  }
);

/** GET /hall-summary/latest?scopeOrgId=xxx */
hallSummaryRoutes.get(
  "/hall-summary/latest",
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

    const record = await prisma.hallDailySummary.findFirst({
      where: { baseOrgId: baseOrg.id },
      orderBy: { recordDate: "desc" },
    });

    return ok(res, record ?? null);
  }
);

/** GET /hall-summary/trend?scopeOrgId=xxx&days=7 */
hallSummaryRoutes.get(
  "/hall-summary/trend",
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

    // 按 recordDate desc + updatedAt desc 排序，并去重（避免同日多条）
    const allRaw = await prisma.hallDailySummary.findMany({
      where: { baseOrgId: baseOrg.id },
      orderBy: [{ recordDate: "desc" }, { updatedAt: "desc" }],
    });
    // 按 recordDate 去重，保留 updatedAt 最新的一条
    const seen = new Set<string>();
    const deduped: any[] = [];
    for (const r of allRaw) {
      if (seen.has(r.recordDate)) continue;
      seen.add(r.recordDate);
      deduped.push(r);
      if (deduped.length >= days) break;
    }
    const records = deduped.reverse(); // 升序

    const latest = records.length > 0 ? records[records.length - 1] : null;
    const prevDay = records.length > 1 ? records[records.length - 2] : null;

    return ok(res, {
      baseOrgId: baseOrg.id,
      baseOrgName: baseOrg.name,
      points: records.map((r) => ({
        recordDate: r.recordDate,
        formalHallCount: r.formalHallCount,
        trainingHallCount: r.trainingHallCount,
        totalHallCount: r.totalHallCount,
      })),
      latest: latest
        ? {
            id: latest.id,
            recordDate: latest.recordDate,
            uploadedBy: latest.uploadedBy,
            uploaderName: latest.uploaderName,
            formalHallCount: latest.formalHallCount,
            trainingHallCount: latest.trainingHallCount,
            totalHallCount: latest.totalHallCount,
            operatorStats: latest.operatorStats,
            rawRowCount: latest.rawRowCount,
            createdAt: latest.createdAt,
            updatedAt: latest.updatedAt,
          }
        : null,
      prevDay: prevDay
        ? {
            recordDate: prevDay.recordDate,
            operatorStats: prevDay.operatorStats,
          }
        : null,
    });
  }
);
