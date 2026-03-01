# OpenStatus 自托管定制化设计方案

> 日期：2026-03-02
> 目标群体：极客、Homelab 玩家、个人开发者
> 原则：不考虑跟进上游更新，只维护。可以大胆删减。

---

## 1. 总体目标

将 OpenStatus 从 SaaS 商业监控平台定制为轻量级自托管监控工具：
- 去除 workspace 多用户功能
- 去除所有付费墙
- 去除 TinyBird 依赖，用 SQLite 替代
- 去除 Upstash/QStash/GCP/Sentry/Vercel/OpenPanel/PagerDuty/Unkey/Stripe
- 去除文档站、官网、商业宣传资料
- 认证支持 GitHub、Google、自定义 OIDC Provider

---

## 2. 应用保留与删除

### 保留的应用

| 应用 | 用途 | 改造程度 |
|------|------|----------|
| `apps/dashboard` | 主控制台 UI | **大改** — 去付费墙、简化用户模型、替换 TinyBird 查询 |
| `apps/server` | Hono API 服务器 | **大改** — 去云服务依赖、新增时序数据写入、接管通知调度 |
| `apps/checker` | Go 监控检查器 | **中改** — 基于 Private Location 模式改造，改数据上报通道 |
| `apps/status-page` | 公开状态页 | **小改** — 去付费限制 |
| `apps/screenshot-service` | 截图服务 | 基本保留 |
| `apps/private-location` | 私有位置检查器 | 基本保留（成为主要 checker 模式） |
| `apps/ssh-server` | SSH 服务 | 基本保留 |

### 删除的应用

| 应用 | 原因 |
|------|------|
| `apps/web` | 官网/落地页，商业宣传材料 |
| `apps/docs` | 文档站 |
| `apps/workflows` | QStash/GCP 调度工作流（被 checker 内置调度替代） |
| `apps/railway-proxy` | Railway 特定代理 |

### 删除的顶层文件

- `CONTRIBUTING.MD` — 开源贡献指南
- `COOLIFY_DEPLOYMENT.md`, `COOLIFY_ENVIRONMENT_GUIDE.md`, `COOLIFY_SETUP.md` — 可保留但需更新
- `coolify-deployment.yaml` — Coolify 部署配置
- `DOCKER.md` — 需要更新
- `SECURITY.md` — 可删除
- `README.md` — 需要重写
- `ralph/` — 删除（如果是非核心工具）
- `infra/` — 审查后决定
- `.koyebignore` — 删除（Koyeb 部署相关）
- `.stacked.toml` — 删除（Stacked 工具相关）

---

## 3. 云服务依赖剥离

### 删除的云服务及替代方案

| 云服务 | 当前用途 | 处理方式 |
|--------|----------|----------|
| **TinyBird** | 时序数据存储与分析 | **用 SQLite 表替代**，在 Turso/libSQL 中新建时序数据表 |
| **Upstash Redis** | 缓存 | **删除**，暂不替代（后续按需加进程内缓存） |
| **QStash** | 消息队列/任务调度 | **删除**，由 checker 内置调度替代 |
| **GCP Cloud Tasks** | 任务调度（alerting） | **删除**，alerting 逻辑迁移到 server 内部 |
| **Sentry** | 错误追踪 | **删除**所有 Sentry 配置和依赖 |
| **Vercel API** | 自定义域名管理、Blob 存储 | **删除**域名 API，Blob 改为本地文件存储 |
| **OpenPanel** | 产品分析 | **删除**所有分析追踪代码 |
| **PagerDuty** | 告警通知 | **删除**通知提供者 |
| **Unkey** | API Key 管理（已基本未使用） | **删除**环境变量引用 |
| **Stripe** | 支付/订阅 | **删除**所有计费逻辑 |
| **Axiom** | 日志 | **删除**（checker 中的 OTLP 上报） |

### 删除的 packages

| Package | 原因 |
|---------|------|
| `packages/tinybird` | TinyBird 客户端 |
| `packages/upstash` | Upstash Redis/QStash 客户端 |
| `packages/analytics` | OpenPanel 分析 |

### 保留的 packages

| Package | 用途 |
|---------|------|
| `packages/api` | tRPC API 路由（需大量清理） |
| `packages/db` | Drizzle ORM 数据库层（需新增时序表、简化 schema） |
| `packages/notifications/*` | 通知渠道（去掉 PagerDuty） |
| `packages/ui` | UI 组件库 |
| `packages/react` | React 组件 |
| `packages/icons` | 图标 |
| `packages/emails` | 邮件模板 |
| `packages/assertions` | 监控断言逻辑 |
| `packages/error` | 错误处理 |
| `packages/header-analysis` | HTTP 头分析 |
| `packages/regions` | 区域定义 |
| `packages/tracker` | 追踪器组件 |
| `packages/tsconfig` | TypeScript 配置 |
| `packages/utils` | 工具函数 |
| `packages/theme-store` | 主题存储 |
| `packages/proto` | Protobuf 定义（ConnectRPC） |
| `packages/status-fetcher` | 状态数据获取 |

---

## 4. SQLite 时序数据方案

在 `packages/db` 中新增监控结果表，替代 TinyBird：

```sql
-- HTTP 检查结果
CREATE TABLE monitor_result (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id INTEGER NOT NULL REFERENCES monitor(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  status_code INTEGER,              -- HTTP status code
  latency INTEGER NOT NULL,         -- 总延迟 ms
  timing_dns INTEGER,               -- DNS 查询 ms
  timing_connection INTEGER,        -- 建立连接 ms
  timing_tls INTEGER,               -- TLS 握手 ms
  timing_ttfb INTEGER,              -- 首字节时间 ms
  timing_transfer INTEGER,          -- 传输 ms
  error TEXT,                       -- 错误信息
  trigger TEXT DEFAULT 'cron',      -- cron/api/manual
  created_at INTEGER NOT NULL       -- Unix timestamp ms
);

CREATE INDEX idx_monitor_result_lookup
  ON monitor_result(monitor_id, created_at DESC);
CREATE INDEX idx_monitor_result_workspace
  ON monitor_result(workspace_id, created_at DESC);

-- TCP 检查结果
CREATE TABLE tcp_result (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id INTEGER NOT NULL REFERENCES monitor(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  latency INTEGER NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_tcp_result_lookup
  ON tcp_result(monitor_id, created_at DESC);

-- DNS 检查结果
CREATE TABLE dns_result (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id INTEGER NOT NULL REFERENCES monitor(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  latency INTEGER NOT NULL,
  record_type TEXT NOT NULL,
  record_value TEXT,
  error TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_dns_result_lookup
  ON dns_result(monitor_id, created_at DESC);
```

### 查询接口

替代 TinyBird 的 tRPC 路由，提供：

- `getMonitorMetrics(monitorId, period)` — 指定时间段内的延迟/可用性数据
- `getMonitorUptime(monitorId, period)` — 可用性百分比
- `getMonitorLatencyPercentiles(monitorId, period)` — p50/p95/p99 延迟
- `getMonitorStatusChanges(monitorId, period)` — 状态变更历史

### 数据保留策略

- 配置环境变量 `DATA_RETENTION_DAYS`（默认 90 天）
- 定期清理过期数据（Server 内置 cron job 或启动时清理）

---

## 5. 用户模型与付费墙

### Workspace 简化

**保留 workspace 表但简化为单用户：**

- 每个用户注册时自动创建一个 workspace（已有此逻辑）
- 去掉 `usersToWorkspaces` 多对多关系 → 改为 workspace 直接关联 user
- 去掉 `invitation` 表和邀请功能
- 去掉 role（owner/admin/member）概念
- 去掉 workspace 切换 UI
- 保留 workspace 的 `id`、`slug`、`name`（资源归属不变，改动量最小）

**workspace 表字段删除：**
- `stripeId` — Stripe 客户 ID
- `subscriptionId` — 订阅 ID
- `plan` — 计划类型（free/starter/team）
- `endsAt` — 订阅结束时间
- `paidUntil` — 付费截止时间
- `limits` — JSON 限制配置

### 付费墙去除

**删除的代码/文件：**
- `packages/api/src/router/stripe/` — 整个 Stripe 路由目录
- `packages/db/src/schema/plan/` — 计划配置和 schema
- `apps/dashboard/src/app/(dashboard)/settings/billing/` — 计费设置页
- `apps/dashboard/src/components/forms/settings/form-members.tsx` — 成员管理
- 所有 `ctx.workspace.limits` 检查 — 直接删除或替换为无限制

**去除的限制：**
- Monitor 数量限制 → 无限制
- Status page 数量限制 → 无限制
- Notification channel 数量限制 → 无限制
- Periodicity 限制 → 所有频率可用（30s/1m/5m/10m/30m/1h）
- Region 限制 → 所有区域可用
- Page component 限制 → 无限制
- Member 限制 → 不适用（单用户）
- 付费功能开关（password-protection, custom-domain, screenshots 等）→ 全部开启

---

## 6. 认证改造

### 保留

- **GitHub OAuth** — `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`
- **Google OAuth** — `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`

### 新增：自定义 OIDC Provider

通过环境变量配置，支持 PocketID、Authentik、Keycloak 等：

```env
# 自定义 OIDC Provider（可选）
OIDC_ISSUER=https://pocketid.example.com
OIDC_CLIENT_ID=openstatus
OIDC_CLIENT_SECRET=your-secret
OIDC_DISPLAY_NAME=PocketID
```

在 `apps/dashboard/src/lib/auth/providers.ts` 中新增：

```typescript
import OIDCProvider from "next-auth/providers/oidc";

const providers = [
  GitHubProvider,
  GoogleProvider,
  // 如果配置了 OIDC 环境变量则添加
  ...(process.env.OIDC_ISSUER ? [
    OIDCProvider({
      id: "custom-oidc",
      name: process.env.OIDC_DISPLAY_NAME || "SSO",
      issuer: process.env.OIDC_ISSUER,
      clientId: process.env.OIDC_CLIENT_ID!,
      clientSecret: process.env.OIDC_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
    })
  ] : []),
];
```

### 删除

- **Resend Magic Link**（开发模式登录）— 用 OIDC 或直接用 GitHub/Google 替代

---

## 7. Checker 架构改造

### 当前架构

```
                    QStash/GCP Cloud Tasks (外部调度)
                              │
                              ▼
                    Checker Server 模式 (无状态 HTTP API)
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
              TinyBird              GCP Cloud Tasks
           (时序数据写入)         (状态更新 → Workflows)
                                        │
                                        ▼
                                   Workflows App
                                  (通知调度/alerting)
```

### 改造后架构

```
                    Checker (Private Location 模式, 内置调度器)
                              │
                    每 10 分钟从 Server 拉取 monitor 列表
                    按 periodicity 执行 HTTP/TCP/DNS 检查
                              │
                              ▼
                    Server API (ConnectRPC / REST)
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
                SQLite              通知调度器
           (时序数据写入)      (从 Workflows 迁移过来)
                                        │
                              ┌────┬────┼────┬────┐
                              ▼    ▼    ▼    ▼    ▼
                           Slack Discord Email ntfy Webhook ...
```

### 改造要点

1. **Checker 端**：
   - 去掉 `pkg/tinybird/client.go` 中对 TinyBird 的直接写入
   - 去掉 `checker/update.go` 中对 GCP Cloud Tasks 的调用
   - 所有数据通过 ConnectRPC 上报给 Server（Private Location 已有此通道）

2. **Server 端**：
   - 新增时序数据写入端点（接收 checker 上报的检查结果 → 写入 SQLite）
   - 从 `apps/workflows/src/checker/alerting.ts` 迁移通知调度逻辑
   - 当收到状态变化事件时，直接调用通知 provider

3. **数据流**：
   - Checker 执行检查 → ConnectRPC → Server 接收
   - Server 写入 SQLite + 检测状态变化 + 触发通知

---

## 8. 通知系统

### 保留的通知渠道（12 个）

| 渠道 | 类型 | 依赖 |
|------|------|------|
| Slack | Webhook | 无外部依赖 |
| Discord | Webhook | 无外部依赖 |
| Telegram | Bot API | 无外部依赖 |
| Email | Resend API | RESEND_API_KEY |
| Webhook | Generic HTTP | 无外部依赖 |
| OpsGenie | API | 无外部依赖 |
| Grafana OnCall | Webhook | 无外部依赖 |
| SMS (Twilio) | Twilio API | TWILIO_* 环境变量 |
| WhatsApp (Twilio) | Twilio API | TWILIO_* 环境变量 |
| ntfy | Push | 无外部依赖 |
| Google Chat | Webhook | 无外部依赖 |

### 删除

| 渠道 | 原因 |
|------|------|
| PagerDuty | 用户要求删除 |

### 通知调度迁移

从 `apps/workflows/src/checker/alerting.ts` 迁移到 `apps/server`：

- `triggerNotifications()` 函数 → 迁移到 Server 内部
- `providerToFunction` 映射 → 保留
- 重试逻辑（3 次指数退避）→ 保留
- SMS 配额检查 → 删除（无付费限制）
- 通知触发记录 → 保留（防重复发送）

---

## 9. 实施阶段规划

### Phase 1: 清理删除（低风险）

1. 删除不需要的应用：`apps/web`, `apps/docs`, `apps/workflows`, `apps/railway-proxy`
2. 删除不需要的 packages：`packages/tinybird`, `packages/upstash`, `packages/analytics`
3. 删除 Sentry 配置（所有 `sentry.*.config.ts`）
4. 删除 PagerDuty 通知 provider
5. 删除商业化文件（README, CONTRIBUTING, SECURITY 等）
6. 清理 `pnpm-workspace.yaml`、`turbo.json` 中的引用
7. 清理 docker-compose 中的引用

### Phase 2: 付费墙去除

1. 删除 Stripe 路由 (`packages/api/src/router/stripe/`)
2. 删除 plan schema (`packages/db/src/schema/plan/`)
3. 移除所有 `ctx.workspace.limits` 检查
4. 简化 workspace schema（删除计费字段）
5. 删除 billing 设置页面
6. 删除 members 管理 UI
7. 删除邀请系统

### Phase 3: 时序数据替代

1. 在 `packages/db` 中创建 `monitor_result`、`tcp_result`、`dns_result` 表
2. 创建 Drizzle migration
3. 实现时序数据查询接口（替代 TinyBird 的 tRPC 路由）
4. 更新 Dashboard 中的图表组件使用新查询接口
5. 更新 status-page 中的数据获取逻辑

### Phase 4: Checker 改造

1. 改造 Go checker：去掉 TinyBird 写入、去掉 GCP Cloud Tasks
2. 确保 Private Location 模式数据正确上报到 Server
3. Server 端新增时序数据接收和写入端点
4. 迁移通知调度逻辑从 Workflows 到 Server
5. 实现数据保留策略（定期清理过期数据）

### Phase 5: 认证改造

1. 添加自定义 OIDC Provider 支持
2. 删除 Resend Magic Link
3. 更新登录 UI（显示配置的 Provider）
4. 更新环境变量模板

### Phase 6: 其他清理

1. 去除 OpenPanel 分析追踪代码（散布在多个文件中）
2. 去除 Vercel 域名管理 API 代码
3. 去除 Vercel Blob 存储，改为本地文件存储
4. 去除 Unkey 环境变量引用
5. 更新 docker-compose.yaml（简化服务定义）
6. 更新 .env.example（只保留必要环境变量）
7. 重写 README.md

---

## 10. 最终环境变量

```env
# === 数据库 ===
DATABASE_URL=file:///data/openstatus.db
DATABASE_AUTH_TOKEN=               # Turso auth token（本地部署可选）

# === 认证 ===
AUTH_SECRET=your-random-secret
AUTH_GITHUB_ID=                    # GitHub OAuth（可选）
AUTH_GITHUB_SECRET=
AUTH_GOOGLE_ID=                    # Google OAuth（可选）
AUTH_GOOGLE_SECRET=

# === 自定义 OIDC（可选）===
OIDC_ISSUER=
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
OIDC_DISPLAY_NAME=

# === 邮件（通知用）===
RESEND_API_KEY=                    # 发送通知邮件

# === Checker ===
CRON_SECRET=your-cron-secret       # Checker 与 Server 通信密钥

# === 数据保留 ===
DATA_RETENTION_DAYS=90             # 监控数据保留天数

# === 可选通知渠道 ===
# Twilio（SMS/WhatsApp）
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
```

---

## 11. 风险与注意事项

1. **TinyBird → SQLite 性能**：SQLite 处理大量时序数据可能不如 TinyBird 高效。需要合理的索引和数据保留策略。对于个人/小团队使用场景，这应该不是问题。

2. **Checker 改造复杂度**：Go 代码改造需要确保 ConnectRPC 协议的兼容性。Private Location 模式已有完整的数据上报通道，应该相对平滑。

3. **通知调度迁移**：从独立 Workflows 应用迁移到 Server 内部，需要确保通知不丢失、不重复。

4. **数据库迁移**：现有部署如果有数据，需要提供 migration 脚本。

5. **OIDC 兼容性**：不同 OIDC Provider（PocketID、Authentik、Keycloak）可能有细微差异，需要测试。
