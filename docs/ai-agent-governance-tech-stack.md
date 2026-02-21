# AI Agent 治理平台：技术栈与架构草案

## 1. 产品目标与核心输出

你的产品本质上是一个 **Agent Runtime Guardrail Layer（运行时治理层）**，夹在 SaaS 的 Agent Workflow 与执行系统之间，输出统一决策：

- `ALLOW`：允许继续执行。
- `DENY`：阻断执行。
- `ESCALATE`：触发人工审核后再继续。

这意味着平台必须同时具备：

1. 高吞吐事件接入能力（来自 Salesforce / ServiceNow / Workday 等）。
2. 低延迟策略判定能力（同步返回 allow/deny/escalate）。
3. 可追溯审计能力（事后解释“为什么允许/拒绝”）。
4. 安全与合规能力（尤其是身份、权限、PII、跨境数据）。

---

## 2. 推荐的总体架构（分层）

```text
[SaaS Agent/Workflow]
      |
      v
[Connector Layer] --标准化--> [Policy Decision Plane] --决策--> allow/deny/escalate
      |                               |
      |                               +--> [Risk Scoring + Detection Engines]
      |                               +--> [Rules/Policy Engine]
      |
      +--> [Event Bus + Data Platform] --> [Audit, Analytics, Model Training]
                                      
[Human Review Console] <--> [Case Management + Evidence Store]
[Admin Console] <--> [Policy Authoring, Tenant, RBAC, Billing]
```

---

## 3. 建议 Tech Stack（按模块）

## 3.1 API Gateway 与接入层（Connector Layer）

**职责**：对接各 SaaS 平台 API/Webhook、鉴权、限流、签名校验、协议适配。

- **API Gateway**：Kong / Apigee / AWS API Gateway
  - 需要支持：OAuth2、JWT、mTLS、Rate Limit、WAF。
- **Connector 服务**（每个 SaaS 一组 adapter）：
  - 语言建议：**TypeScript (NestJS)** 或 **Go (Gin/Fiber)**。
  - 连接器模式：
    - Salesforce Connector（Flow/Apex/Platform Events）
    - ServiceNow Connector（Business Rules/Flow Designer）
    - Workday Connector（REST/SOAP + event polling）
- **异步缓冲**：Kafka / Pulsar（避免下游抖动导致 SaaS 请求超时）

> 早期建议：先做 1~2 个主力 Connector（如 Salesforce + ServiceNow），把“标准化事件模型”打透再扩展。

## 3.2 标准化事件模型（Canonical Event Schema）

为了跨 SaaS 做统一治理，必须定义平台内部统一事件对象，例如：

- `tenant_id`
- `source_system`（salesforce / servicenow / workday）
- `agent_id` / `workflow_id` / `step_id`
- `action_type`（read, write, approve, transfer, delete...）
- `resource_type` / `resource_id`
- `context`（用户角色、地理位置、时间、历史行为）
- `payload_hash`（原始数据哈希，避免明文滥用）
- `requested_at` / `deadline_ms`

建议用 **JSON Schema + OpenAPI + AsyncAPI** 统一描述。

## 3.3 策略决策平面（Policy Decision Plane）

这是核心能力，要求低延迟（P95 < 200ms，视业务可放宽）。

- **Policy Engine（规则引擎）**：
  - 首选：**OPA (Open Policy Agent) + Rego**。
  - 优势：声明式策略、可版本化、易审计、生态成熟。
- **Risk Scoring 服务**：
  - 实时特征 + 模型评分（0~1）
  - 评分区间映射：
    - 低风险 `ALLOW`
    - 中风险 `ESCALATE`
    - 高风险 `DENY`
- **Decision API**：
  - 输入：标准化事件
  - 输出：`decision`, `risk_score`, `reasons[]`, `policy_version`, `trace_id`

### 决策设计建议

采用“双轨判定”：

1. **硬规则优先**（合规硬约束：如越权访问、敏感操作黑名单）
2. **风险模型补充**（识别异常模式，给出升级审核建议）

## 3.4 数据与存储层

按“在线决策”和“离线分析”分离：

- **OLTP（在线）**：PostgreSQL
  - 租户、策略版本、审批工单、系统配置。
- **审计日志存储（不可篡改）**：
  - Elasticsearch/OpenSearch（检索）+ 对象存储（S3/GCS）归档。
- **特征与分析**：
  - ClickHouse / BigQuery / Snowflake（三选一）
  - 用于风险画像、策略命中率、误杀率分析。
- **缓存**：Redis
  - 缓存热点策略和租户配置，降低判定延迟。

## 3.5 人工审核与运营后台

你的 `ESCALATE` 能力是商业价值关键，建议单独做 Case Management：

- **前端**：React + Next.js + Tailwind
- **工作流**：Temporal / Camunda（审批流、SLA、重试）
- **核心功能**：
  - 工单队列（按风险等级、租户、系统来源）
  - 证据面板（事件上下文、模型解释、历史决策）
  - 一键批注与回写（approve/reject + reason）

## 3.6 可观测性与审计

- **日志**：OpenTelemetry + Loki / ELK
- **指标**：Prometheus + Grafana
- **追踪**：Jaeger / Tempo
- **审计报表**：
  - 决策分布（allow/deny/escalate）
  - 误报率/漏报率
  - 平均处理时长（含人工审核）
  - 按 SaaS/租户/策略版本分组

## 3.7 安全与合规（必须前置）

- **身份与权限**：OIDC/SAML SSO + RBAC + ABAC
- **密钥管理**：KMS + Secret Manager（Vault / AWS Secrets Manager）
- **数据保护**：字段级加密、Tokenization、脱敏
- **合规对齐**：SOC2、ISO27001、GDPR/CCPA（视目标市场）
- **隔离策略**：强租户隔离（逻辑隔离起步，关键客户可物理隔离）

---

## 4. 平台 API 设计建议

建议至少定义三类 API：

1. **Decision API（同步）**
   - `POST /v1/decide`
   - 用于实时 Gate，返回 allow/deny/escalate。
2. **Event Ingest API（异步）**
   - `POST /v1/events`
   - 用于补充上下文和离线分析。
3. **Case API（人工审核）**
   - `POST /v1/cases/{id}/resolve`
   - 回写审核结论给上游系统。

返回体建议包含：

- `decision`
- `confidence`
- `reason_codes`
- `human_review_required`
- `policy_version`
- `ttl_ms`（上游可缓存决策）

---

## 5. MVP 到规模化的落地路线图

## Phase 1（0~3个月）

- Connector：Salesforce + ServiceNow
- 决策：规则引擎（OPA）为主，不上复杂模型
- 数据：PostgreSQL + Redis + OpenSearch
- 输出：allow/deny/escalate + 基础审核台

目标：先证明“可阻断高风险行为 + 不显著拖慢业务流程”。

## Phase 2（3~9个月）

- 引入风险评分模型（异常检测）
- 建立策略模拟（Policy Simulation）和回放（Replay）
- 增加 Workday Connector
- 增加多租户计费能力（按调用量/审核量）

## Phase 3（9个月+）

- 引入图谱风控（Agent-User-Resource 关系图）
- 自适应策略推荐（Policy Copilot）
- 支持私有化部署（金融/政企客户）

---

## 6. 推荐首选技术组合（一个可执行版本）

如果你想快速开工，可以用这套：

- **后端**：TypeScript + NestJS
- **规则引擎**：OPA
- **消息队列**：Kafka
- **数据库**：PostgreSQL + Redis
- **日志检索**：OpenSearch
- **前端**：Next.js
- **工作流引擎**：Temporal
- **部署**：Kubernetes + Helm
- **可观测性**：OpenTelemetry + Prometheus + Grafana

这套的优点是：招聘容易、生态成熟、从 MVP 到企业级扩展路径清晰。

---

## 7. 关键成功指标（建议你立项就跟踪）

- 决策延迟：P95 / P99
- 业务阻断准确性：True Positive / False Positive
- 人审负载：`ESCALATE` 占比、平均处理时长
- 客户价值：风险事件减少率、审计通过率、合规工时下降
- 系统稳定性：SLO（可用性 99.9%+）

---

## 8. 一句话定位（对外叙事可用）

> 我们是 SaaS AI Agents 的实时治理中枢，在不牺牲自动化效率的前提下，为企业提供可控、可审计、可合规的 Agent 执行保障。
