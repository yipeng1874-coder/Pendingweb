# 数据库迁移变更文档：broadcast 与 workflow 迁移至 MySQL

**变更时间**：2026-06-26  
**变更类型**：后端架构升级（数据持久化层替换）  
**影响模块**：厅内直达任务（Broadcast）、流转式任务（Workflow）  
**前端/接口影响**：**零改动**，接口行为完全不变  

---

## 1. 变更背景

本次变更将「厅内直达任务」和「流转式任务」的数据持久化层，从 **JSON 文件读写** 完整迁移到 **MySQL（Prisma）**。

**变更前（旧方案）**：

- 厅内直达数据存储于 `backend/data/broadcast-tasks.json`
- 流转式任务数据存储于 `backend/data/workflow-tasks.json`
- 使用 `fs.readFile` / `fs.writeFile` 同步操作文件
- 不支持并发安全，不支持事务，数据量大时 IO 开销增大

**变更后（新方案）**：

- 全部数据写入 MySQL，通过 Prisma ORM 操作
- 支持事务（`prisma.$transaction`）
- 支持 upsert 幂等写入
- 过期处理改为数据库 `updateMany`，避免全量加载

---

## 2. 数据库变更清单

### 2.1 新增数据表（8 张）

#### 厅内直达（Broadcast）

| 表名 | 说明 |
|------|------|
| `broadcast_tasks` | 厅内直达任务主表 |
| `broadcast_questions` | 任务题目表 |
| `broadcast_anchor_records` | 主播参与记录（每任务每主播一条） |
| `broadcast_anchor_answers` | 主播答案（每记录每题目一条） |

#### 流转式任务（Workflow）

| 表名 | 说明 |
|------|------|
| `workflow_tasks` | 流转任务主表 |
| `workflow_steps` | 任务节点表 |
| `workflow_questions` | 节点题目表 |
| `workflow_answers` | 节点答案（每节点每题目一条） |

### 2.2 新增 Enum（6 个）

| Enum | 值 |
|------|-----|
| `BroadcastTaskStatus` | `active` / `ended` |
| `BroadcastAnchorStatus` | `pending` / `in_progress` / `submitted` / `overdue` |
| `BroadcastQuestionType` | `QA` / `FILL_BLANK` / `SINGLE_CHOICE` / `MULTI_CHOICE` / `LINK` / `ATTACHMENT` |
| `WorkflowTaskStatus` | `in_progress` / `completed` / `ended` |
| `WorkflowStepStatus` | `pending` / `active` / `completed` |
| `WorkflowQuestionType` | `QA` / `FILL_BLANK` / `SINGLE_CHOICE` / `MULTI_CHOICE` / `LINK` / `ATTACHMENT` |

### 2.3 关键约束说明

- `broadcast_anchor_records`：唯一约束 `(task_id, anchor_user_id)`，每任务每主播只有一条记录
- `broadcast_anchor_answers`：唯一约束 `(record_id, question_id)`，支持 upsert 覆盖
- `workflow_answers`：唯一约束 `(step_id, question_id)`，支持 upsert 覆盖
- 所有子表通过 `onDelete: Cascade` 级联删除，主表删除时子表自动清理

---

## 3. 代码变更清单

### 3.1 修改的文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `backend/prisma/schema.prisma` | 新增内容 | 追加 8 张表定义 + 6 个 enum |
| `backend/src/modules/task/collaboration/broadcast.store.ts` | 完整改写 | JSON 文件操作 → Prisma 数据库操作 |
| `backend/src/modules/task/collaboration/workflow.store.ts` | 完整改写 | JSON 文件操作 → Prisma 数据库操作 |

### 3.2 删除的文件

| 文件 | 原因 |
|------|------|
| `backend/data/broadcast-tasks.json` | 数据已迁移至 MySQL，不再需要 |
| `backend/data/workflow-tasks.json` | 数据已迁移至 MySQL，不再需要 |

### 3.3 未改动的文件（接口层零改动）

- `backend/src/modules/task/collaboration/broadcast.routes.ts` — **未改动**
- `backend/src/modules/task/collaboration/workflow.routes.ts` — **未改动**
- 所有前端页面、服务层（`workflowTask.ts`、`broadcastTask.ts` 等）— **未改动**
- Nginx 配置、PM2 配置 — **无需改动**

---

## 4. 关键业务逻辑变更

### 4.1 过期检查机制

**变更前**：每次查询时，遍历全量 JSON 文件，逐条判断是否过期，过期则修改对象状态后写回文件。

**变更后**：查询前调用 `applyExpire()` / `applyWorkflowExpire()`，使用 `updateMany` 批量更新到期记录，一次数据库操作完成，不再全量加载。

```typescript
// broadcast：到期任务批量 ended，对应主播记录批量 overdue
await prisma.$transaction([
  prisma.broadcastTask.updateMany({ where: { status: "active", dueAt: { lt: now } }, data: { status: "ended" } }),
  prisma.broadcastAnchorRecord.updateMany({ where: { taskId: { in: ids }, status: { in: ["pending", "in_progress"] } }, data: { status: "overdue" } }),
]);

// workflow：到期任务批量 ended
await prisma.workflowTask.updateMany({ where: { status: "in_progress", dueAt: { lt: now } }, data: { status: "ended" } });
```

### 4.2 答案保存机制

**变更前**：全量覆盖任务 JSON 对象中的 `answers` 数组。

**变更后**：使用 `upsert` by 唯一键，天然支持幂等写入（覆盖已有答案 / 新增未填答案）。

```typescript
await prisma.broadcastAnchorAnswer.upsert({
  where: { recordId_questionId: { recordId, questionId } },
  create: { ... },
  update: { ... },
});
```

### 4.3 流转节点自动流转

**变更前**：在内存中修改 JSON 对象中下一节点的 `status`，然后整体写回文件。

**变更后**：使用 `prisma.$transaction` 保证「节点完成 + 任务状态更新」的原子性，防止写一半失败的情况。

### 4.4 broadcast 新增接口（存储层）

本次改写同时新增了以下存储层函数（原 JSON 方案中未实现）：

| 函数 | 说明 |
|------|------|
| `listBroadcastTasksByIssuerPaged()` | 分页查询发布者的任务列表（不含 answers，节省带宽） |
| `getBroadcastTaskAnchorAnswers()` | 懒加载：获取单个任务所有主播的完整答案 |

---

## 5. 存量数据迁移说明

本次上线前，已在开发环境执行了存量数据迁移脚本，将原 JSON 文件中的全部数据导入 MySQL。

**迁移状态**：

- 厅内直达任务：已迁移（含 questions、anchorRecords、answers）
- 流转式任务：已迁移（含 steps、questions、answers）

**生产环境操作**：

> 生产环境的 JSON 文件如有存量数据，需要在 `prisma db push` 后、重启服务前，执行数据迁移脚本（参见下方部署步骤）。

---

## 6. 生产环境上线步骤

### 6.1 前置准备

1. **备份数据库**（必做）：

```bash
# 执行项目根目录自动备份脚本
db-backup.bat
```

2. 确认 `.env` 中 `DATABASE_URL` 指向正确的生产数据库。

### 6.2 拉取代码

```bash
cd C:\deploy\source
git pull
```

### 6.3 推送 Schema 变更到生产数据库

> **重要**：本次变更包含新增表，必须执行此步骤，否则后端启动会报错。

```bash
cd backend
npx prisma db push
```

执行成功后会看到类似输出：
```
Your database is now in sync with your Prisma schema.
✓ Generated Prisma Client
```

> **注意**：`prisma db push` 会自动重新生成 Prisma Client，无需额外执行 `prisma generate`。

### 6.4 处理生产环境存量 JSON 数据（如有）

如果生产数据库的 `backend/data/broadcast-tasks.json` 或 `backend/data/workflow-tasks.json` 中有需要保留的数据，在重启服务之前需先联系开发者获取迁移脚本并执行。

如果这两个 JSON 文件为空（或已确认不需要保留），可直接跳过此步。

### 6.5 构建后端

```bash
cd C:\deploy\source
npm run build -w backend
```

### 6.6 重启后端服务

```bash
pm2 restart anchor-todo-api
```

查看启动日志，确认无报错：

```bash
pm2 logs anchor-todo-api --lines 50
```

### 6.7 前端处理

本次变更**前端无改动**，无需重新构建 PC / H5，无需 reload Nginx。

### 6.8 验证

| 检查项 | 预期结果 |
|--------|---------|
| `GET /api/health` | 正常 200 |
| 发布厅内直达任务 | 成功，数据写入 `broadcast_tasks` |
| 主播提交厅内直达答案 | 成功，数据写入 `broadcast_anchor_answers` |
| 发布流转任务 | 成功，数据写入 `workflow_tasks` |
| 提交节点答案 | 成功，节点自动流转，数据写入 `workflow_answers` |
| 旧存量任务（迁移后）可正常查询 | 查询结果与迁移前一致 |

---

## 7. 回滚方案

如需紧急回滚：

1. 恢复上线前的数据库备份（`db-restore.bat`）
2. 恢复旧版本的 `workflow.store.ts` 和 `broadcast.store.ts`（回滚 Git 版本）
3. 确保 `backend/data/broadcast-tasks.json` 和 `workflow-tasks.json` 文件存在
4. 重新构建后端并重启 PM2

> 回滚后新表（`broadcast_*`、`workflow_*`）会保留在数据库，但不影响业务，旧方案不读写这些表。

---

## 8. 本次变更的测试重点

每次更新后建议重点回归以下场景：

### 厅内直达

- [ ] 厅管创建厅内直达任务，主播列表正常载入
- [ ] 主播端能看到分配给自己的任务
- [ ] 主播逐题填写答案，状态从 `pending` → `in_progress` 正确变化
- [ ] 所有必填题完成后，状态自动变为 `submitted`
- [ ] 厅管看板可以看到任务整体进度与每位主播的答案详情
- [ ] 到期的任务状态自动变为 `ended`，主播状态变为 `overdue`

### 流转式任务

- [ ] 管理员创建流转任务，节点列表保存正确
- [ ] 执行人待办页面能看到分配给自己的节点
- [ ] 提交节点后，下一节点自动从 `pending` 变为 `active`
- [ ] 最后一个节点完成后，任务状态变为 `completed`
- [ ] 看板页面可以看到各节点完成状态与答案详情
- [ ] 到期的进行中任务状态自动变为 `ended`

---

## 9. 附：文件路径变更对比

| 原路径 | 变更后 |
|--------|--------|
| `backend/data/broadcast-tasks.json` | **已删除**，数据迁入 MySQL |
| `backend/data/workflow-tasks.json` | **已删除**，数据迁入 MySQL |
| `backend/prisma/schema.prisma` | 追加 8 张表 + 6 个 enum |
| `backend/src/modules/task/collaboration/broadcast.store.ts` | 完整改写（接口签名不变） |
| `backend/src/modules/task/collaboration/workflow.store.ts` | 完整改写（接口签名不变） |

---

*文档生成时间：2026-06-26*  
*变更版本：broadcast + workflow 数据库迁移 V1*
