# 01. 组件概览与架构边界

`SangAIKit` 是面向现代 React 19 应用的通用 AI 助手组件与工程能力包。它将复杂的 AI 交互界面與底层协议封装为可插拔的模块化套件，涵盖**可拖拽缩放浮窗、多标签配置中心、会话管理与分叉、多模态图片画廊、模型与思考强度控制、SKILL 规则库、本地与开源字体管理、多协议生图适配、浏览器端 AES-256-GCM 密钥加密**以及**实时 Token 用量监控**。

宿主应用只需通过轻量级适配器接入自身的工作区上下文与业务工具，即可获得完整的生产级 AI 协作体验。

---

## 核心模块矩阵

| 模块 / 导出项 | 职责定位 | 关键能力 |
| --- | --- | --- |
| `AiAssistant` | 悬浮主面板与对话工作台 | 拖拽移动、八方向及键盘缩放、最小化实时状态轮播、流式 Markdown、思考过程折叠、工具执行卡片、图片附件上传与预览 |
| `AiSettings` | 全功能配置中心弹窗 | 多端点与模型管理、连接测试、生图模型、系统提示词、SKILL 规则、快捷短语、字体管理、密钥加密与宿主自定义扩展页（如智能抠图） |
| `SessionList` | 历史会话与图片画廊 | 会话搜索、重命名、删除确认；图片画廊支持按「AI 生图 / 过程预览 / 参考附件」分类筛选、批量删除、大图预览及一键置入宿主工作区 |
| `ModelControls` | 底部模型与思考控制器 | 输入框内联快速切换活动模型、开关思考推理（Reasoning）并调节推理强度（`minimal` / `low` / `medium` / `high` / `xhigh` / `max`） |
| `TokenUsageBar` | 上下文与 Token 用量环 | 实时估算系统提示词、历史上下文与当前输入的 Token 占比，悬浮展示输入/输出/缓存/推理 Token 明细与生成速率 |
| `SkillSettings` | SKILL 规则引擎管理 | 管理常驻摘要与按需读取的 Markdown 领域技能规则，支持预设库一键添加、克隆、JSON 导入导出与 Token 估算 |
| `ImageModelSettings` | 多协议生图模型管理 | 内置 Kolors（硅基流动）、Agnes、GPT Image（OpenAI）三类适配器预设，自动识别尺寸比例、步数、引导系数与画质参数 |
| `FontSettings` | 本地与开源字体管理 | 调用 Local Font Access API 扫描本机已安装中/西文字体，结合内置 Google Fonts（OFL 开源商用字体）向 AI 暴露排版资源 |
| `EncryptionKeySettings` | 本机主密钥生命周期管理 | 基于 Web Crypto API 的不可导出 `CryptoKey` 管理，支持创建、无损轮换（自动重加密 API Key）、重置以及口令保护的 JSON 备份导入/导出 |

---

## 共享能力与宿主职责边界

为了兼顾开箱即用与宿主业务解耦，`SangAIKit` 明确划分了组件库内置职责与宿主实现职责：

| 已由 SangAIKit 共享实现 | 仍由宿主应用按需实现 |
| --- | --- |
| 助手浮窗、配置中心、历史会话列表、图片画廊、SKILL、字体与生图设置 UI | 本地 ONNX 智能抠图等宿主专用设置面板（通过 `renderBackgroundRemoval` 插槽注入） |
| OpenAI Responses API 流式解析、思考摘要流、多轮工具循环、原生历史维护、用量汇总与图片附件暂存 | 宿主业务专属工具（如读取/修改画布、查询数据库）的 Schema 定义、权限校验与确认执行 |
| Kolors、Agnes、GPT Image 生图协议请求、IndexedDB 图片存储与 AES-GCM 密钥管理 | 将画廊中的生成图片或工具执行结果实际写回宿主工作区（通过 `assistant.insertImage` 回调） |
| `useAssistant` 通用会话状态机与 `createBrowserAiStore` 浏览器加密配置存储 | 宿主业务状态的事务回滚、撤销/重做（Undo/Redo）以及桌面端原生文件系统存储 |

---

## 安全与副作用设计原则

1. **工具副作用保护**：`useAssistant` 通过 `AssistantRunner` 接收文本、思考、工具状态与 Responses 原生历史。由于工具调用或图片生成可能产生外部副作用或计费，通用控制器在当前轮次包含工具调用或图片附件时会自动禁用「重新生成（Redo）」，仅允许纯文本回复的安全重做。
2. **按需水合视觉附件**：演示与推荐存储使用 `attachment://<imageId>` 引用保存图片历史，仅在向支持视觉（`supportsVision: true`）的模型发送请求时才从 `ImageStore` 读取并转为 Data URL，避免撑爆本地存储与纯文本模型上下文。
3. **本机加密与生产代理建议**：`createBrowserAiStore` 使用 AES-256-GCM 加密 API Key 并存储于 IndexedDB，主密钥设置为 `extractable: false`。但浏览器端解密后发起直连请求时仍可能受页面脚本或跨域限制影响，公开生产环境推荐通过后端代理转发模型请求。
