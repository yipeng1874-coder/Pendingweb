import { Router } from "express";
import multer from "multer";
import * as xlsx from "xlsx";
import { authRequired } from "../../middleware/authRequired.js";
import { identityRequired } from "../../middleware/identityRequired.js";
import { permissionRequired } from "../../middleware/permissionRequired.js";
import { prisma } from "../../shared/prisma.js";
import { fail, ok } from "../../shared/response.js";

// ---------- 工具函数 ----------

/** 解析 BASE 级别作用域 */
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

/** 本地日期字符串运算 */
function addDays(dateStr: string, delta: number): string {
  const dt = new Date(dateStr + "T00:00:00");
  dt.setDate(dt.getDate() + delta);
  const y = dt.getFullYear(), m = dt.getMonth() + 1, d = dt.getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseDateStr(val: unknown): string | null {
  if (typeof val === "string") {
    const parts = val.trim().split(/[\/\-]/);
    if (parts.length === 3) {
      const n1 = parseInt(parts[0]), n2 = parseInt(parts[1]), n3 = parseInt(parts[2]);
      let y: number, m: number, d: number;

      if (n1 > 31) {
        // YYYY-MM-DD 或 YYYY/M/D
        y = n1; m = n2; d = n3;
      } else if (n3 > 31) {
        // M/D/YYYY 或 D/M/YYYY
        if (n1 > 12) {
          // D/M/YYYY（日超过12，不可能是月份）
          y = n3; m = n2; d = n1;
        } else {
          // M/D/YYYY（第一段是月份）
          y = n3; m = n1; d = n2;
        }
      } else {
        // M/D/YY 或 YY/M/D：所有值都 ≤31，默认按 M/D/YY 处理
        // n3 是 2 位年份，n1 是月，n2 是日
        y = n3; m = n1; d = n2;
      }

      // 2 位年份补齐为 20xx
      if (y < 100) y += 2000;

      if (y >= 2000 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
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

// ---------- multer ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ---------- 路由 ----------
export const dataOverviewRoutes = Router();
dataOverviewRoutes.use(authRequired, identityRequired);

/** POST /data-overview/upload —— 一次上传处理所有 Sheet */
dataOverviewRoutes.post(
  "/data-overview/upload",
  permissionRequired("task:report:view"),
  (req: any, res: any, next: any) => {
    upload.single("file")(req, res, (err: any) => {
      if (err) return fail(res, "UPLOAD_ERROR", "上传失败", 500);
      next();
    });
  },
  async (req: any, res: any) => {
    if (!req.file) return fail(res, "NO_FILE", "请选择 Excel 文件", 400);
    if (["TEAM_ADMIN", "HALL_MANAGER"].includes(req.identity?.roleCode)) {
      return fail(res, "FORBIDDEN", "无权上传", 403);
    }

    let baseOrg: { id: string; name: string };
    try { baseOrg = await resolveBaseScopeOrg(req.query.scopeOrgId, req.identity); } catch (e: any) {
      const errMsgMap: Record<string, string> = { BASE_SCOPE_REQUIRED: "请先选择基地", SCOPE_ORG_NOT_FOUND: "基地不存在", SCOPE_ORG_FORBIDDEN: "无权访问该基地" };
      return fail(res, e.message, errMsgMap[e.message] ?? "鉴权失败", 403);
    }

    const recordDate = (req.body?.recordDate ?? req.query?.recordDate ?? "").toString().trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(recordDate)) {
      return fail(res, "INVALID_RECORD_DATE", "请提供有效的归属日期（YYYY-MM-DD）", 400);
    }

    let wb: xlsx.WorkBook;
    try { wb = xlsx.read(req.file.buffer, { type: "buffer", cellDates: true }); }
    catch { return fail(res, "PARSE_ERROR", "Excel 解析失败", 400); }

    const uploader = await prisma.user.findUnique({ where: { id: req.userId }, select: { nickname: true } });
    const result: any = { recordDate, baseOrgId: baseOrg.id };

    // ═══════ 处理「厅个数」Sheet ═══════
    const hallSheetName = wb.SheetNames.find(n => n.trim() === "厅个数");
    if (hallSheetName) {
      const rows = xlsx.utils.sheet_to_json(wb.Sheets[hallSheetName], { raw: false, defval: "" }) as any[];
      if (rows.length === 0) { result.hall = { formalHallCount: 0, trainingHallCount: 0 }; }
      else {
      // 找到「直播厅类型」和「运营账号」列（遍历前 3 行，键名/值均检查，兼容不同表头格式）
      let typeCol = "", opCol = "";
      for (let i = 0; i < Math.min(3, rows.length) && (!typeCol || !opCol); i++) {
        for (const k of Object.keys(rows[i] ?? {})) {
          const v = String((rows[i] ?? {})[k] ?? "");
          if (!typeCol && (k.includes("直播厅类型") || v.includes("直播厅类型"))) typeCol = k;
          if (!opCol && (k.includes("运营账号") || v.includes("运营账号"))) opCol = k;
        }
      }

      let formalCount = 0, trainingCount = 0;
      const opMap = new Map<string, any>();

      // 遍历所有行：该列值为「正式厅」或「训练厅」的才是真数据行，其余自动跳过
      for (let i = 0; i < rows.length; i++) {
        const hallType = String((rows[i] ?? {})[typeCol] ?? "").trim();
        if (hallType !== "正式厅" && hallType !== "训练厅") continue;
        const op = String((rows[i] ?? {})[opCol] ?? "").trim() || "未知运营";

        if (hallType === "正式厅") formalCount++;
        else trainingCount++;

        if (!opMap.has(op)) opMap.set(op, { operator: op, formalHallCount: 0, trainingHallCount: 0, totalCount: 0 });
        const os = opMap.get(op)!;
        if (hallType === "正式厅") os.formalHallCount++;
        else os.trainingHallCount++;
        os.totalCount++;
      }

      const opStats = Array.from(opMap.values()).sort((a, b) => b.totalCount - a.totalCount);
      await prisma.hallDailySummary.upsert({
        where: { baseOrgId_recordDate: { baseOrgId: baseOrg.id, recordDate } },
        create: { baseOrgId: baseOrg.id, baseOrgName: baseOrg.name, recordDate, uploadedBy: req.userId, uploaderName: uploader?.nickname ?? "未知", formalHallCount: formalCount, trainingHallCount: trainingCount, totalHallCount: formalCount + trainingCount, operatorStats: opStats, rawRowCount: rows.length - 1 },
        update: { baseOrgName: baseOrg.name, formalHallCount: formalCount, trainingHallCount: trainingCount, totalHallCount: formalCount + trainingCount, operatorStats: opStats, rawRowCount: rows.length - 1 },
      });
      result.hall = { formalHallCount: formalCount, trainingHallCount: trainingCount };
      }
    }

    // ═══════ 处理「主播流失」Sheet ═══════
    const lossSheetName = wb.SheetNames.find(n => n.trim() === "主播流失");
    if (lossSheetName) {
      const rows = xlsx.utils.sheet_to_json(wb.Sheets[lossSheetName], { raw: false, defval: "" }) as any[];

      if (rows.length === 0) { result.loss = { lossWithin30Days: 0, lossYesterday: 0 }; }
      else {
      // 找到「流失时间」和「所属运营」列（遍历前 3 行，键名/值均检查）
      let lossCol = "";
      let operatorCol = "";
      for (let i = 0; i < Math.min(3, rows.length) && (!lossCol || !operatorCol); i++) {
        for (const k of Object.keys(rows[i] ?? {})) {
          const v = String((rows[i] ?? {})[k] ?? "");
          if (!lossCol && (k === "流失时间" || v.includes("流失时间"))) lossCol = k;
          if (!operatorCol && (k.includes("所属运营") || v.includes("所属运营"))) operatorCol = k;
        }
      }

      const targetDateStr = recordDate;
      const days30Ago = addDays(recordDate, -30);

      let within30 = 0, yesterday = 0, total = 0;
      const dailyMap = new Map<string, number>(); // date -> count
      // 每日 + 运营 分组: { date: { operator: count } }
      const dailyOperatorMap = new Map<string, Record<string, number>>();

      for (let i = 0; i < rows.length; i++) {
        const ds = parseDateStr((rows[i] ?? {})[lossCol]);
        if (!ds) continue;
        total++;
        dailyMap.set(ds, (dailyMap.get(ds) || 0) + 1);
        if (ds >= days30Ago && ds <= recordDate) within30++;
        if (ds === targetDateStr) yesterday++;

        if (operatorCol) {
          const op = String((rows[i] ?? {})[operatorCol] ?? "").trim() || "未知运营";
          if (!dailyOperatorMap.has(ds)) dailyOperatorMap.set(ds, {});
          const inner = dailyOperatorMap.get(ds)!;
          inner[op] = (inner[op] || 0) + 1;
        }
      }
      const lossDetail: Record<string, number> = Object.fromEntries(dailyMap);
      // 转 JSON-friendly 格式
      const lossOperatorDetail: Record<string, Record<string, number>> = {};
      for (const [date, ops] of dailyOperatorMap) lossOperatorDetail[date] = ops;

      await prisma.anchorLossDailySummary.upsert({
        where: { baseOrgId: baseOrg.id },
        create: { baseOrgId: baseOrg.id, baseOrgName: baseOrg.name, recordDate, uploadedBy: req.userId, uploaderName: uploader?.nickname ?? "未知", lossWithin30Days: within30, lossYesterday: yesterday, totalLossCount: total, lossDetail, lossOperatorDetail, rawRowCount: rows.length - 1 },
        update: { baseOrgName: baseOrg.name, recordDate, uploadedBy: req.userId, uploaderName: uploader?.nickname ?? "未知", lossWithin30Days: within30, lossYesterday: yesterday, totalLossCount: total, lossDetail, lossOperatorDetail, rawRowCount: rows.length - 1 },
      });
      result.loss = { lossWithin30Days: within30, lossYesterday: yesterday, dailyCount: dailyMap.size };
      } // 闭合 else 分支
    }

    return ok(res, result);
  }
);
