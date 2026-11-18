# 05. 模型配置、生图协议与密钥加密

`SangAIKit` 的配置中心（`AiSettings`）提供了面向多供应商端点、推理模型、多协议生图服务以及浏览器端零明文密钥存储的完整工程实现。

---

## 多端点与模型配置 (`models` 标签页)

1. **供应商预设模板**：支持一键创建 `OpenAI`、`DeepSeek`、`Agnes`、`本地 Ollama / vLLM` 或 `自定义兼容端点`。
2. **思考推理参数联动**：
   - 每个模型可独立配置是否支持思考（`thinkingAvailable`）、支持的推理强度档位（`supportedReasoningEfforts`）、默认是否开启思考（`defaultThinkingEnabled`）以及默认推理强度（`defaultReasoningEffort`）。
   - 宿主根据开关向 `createResponsesSender` 传入 `reasoningEffort`；普通模型关闭思考时发送 `reasoning: { effort: 'none' }`，模型 ID 以 `agnes` 开头时改为 `chat_template_kwargs: { enable_thinking: false }`。启用思考时使用选定的 `reasoning.effort`，不支持思考时不传该选项。连接测试使用相同协议和当前模型状态。
   - 共享模型选择默认只切换模型；宿主可通过 `selectModel` 的 `restoreThinkingDefaults` 和 `updateActiveModel` 的 `synchronizeThinking` 选项启用所需的思考默认值和联动策略。
3. **真实端点连接测试 (`testEndpointConnection`)**：
   - 点击端点卡片上的「测试连接」会向当前端点与模型发起真实的 Responses API 请求（固定发送 `system: "this is a test"` 与 `user: "Say OK"`，不挂载任何工具、不保存历史、30 秒超时）。
   - 仅当流式响应或完成响应返回非空文本且未发生非预期工具调用时判定为连接成功，并展示毫秒级响应延迟。
   - 空 API Key 不产生 `Authorization` 头；是否允许无凭据请求由服务端决定。非空 Key 仍通过 Bearer 发送。

---

## 多协议生图引擎 (`images` 标签页)

组件库在 `src/image-generation/` 中内置了三类主流生图协议适配器，并支持从预设库一键添加：

| 适配器标识 (`adapter`) | 适用服务与典型模型 | 支持特性与参数控制 |
| --- | --- | --- |
| `gpt-image` | OpenAI `gpt-image-1` / `gpt-image-1.5` / `gpt-image-2` | 支持文生图（`/images/generations`）与多参考图重绘（`/images/edits`），可配置画质（`low` / `medium` / `high` / `auto`）与尺寸比例 |
| `kolors` | 硅基流动 `Kwai-Kolors/Kolors` | 支持自定义采样步数（`steps`）、引导系数（`guidance_scale`）、分辨率与参考图输入 |
| `agnes` | Agnes 视觉生成网关 | 支持多画幅比例、质量档位与异步/同步图像生成响应解析 |

每个模型可设置 `maxReferenceImages`（参考图数量上限）：0 表示仅支持文生图，未设置时为 1；新建 GPT 预设默认为 5。Kolors 协议最多支持 1 张，Agnes 与 GPT 的实际上限应根据所接服务配置。

---

## 浏览器端 AES-256-GCM 密钥加密与备份

为了防止 API Key 以明文形式暴露在 `localStorage` 或 `IndexedDB` 中，`SangAIKit` 提供了双层加密体系：

1. **本机主密钥 (`EncryptionManager`)**：
   - 使用 Web Crypto API 生成 `AES-GCM`（256-bit）主密钥，并以 `extractable: false` 存入 IndexedDB，任何页面脚本均无法直接导出原始密钥字节。
   - 每次保存 `AiConfig` 时，所有端点中的非空 `apiKey` 都会使用随机 96-bit IV 加密为 `{ iv, ciphertext }` 结构存储。
2. **一次性加密备份与跨端迁移 (`createKeyBackupCodec`)**：
   - 在首次创建或轮换密钥的瞬间，组件可导出使用用户口令（至少 12 位）通过 `PBKDF2`（600,000 次迭代，SHA-256）派生的密钥包裹（Wrap）后的备份 JSON 文件。
   - 用户可在另一台设备或浏览器中导入该备份文件并输入口令，无缝恢复同一把主密钥并解锁既有加密配置。
3. **无损密钥轮换 (`rotate`) vs 重置 (`reset`)**：
   - 当本机主密钥正常可用（`status === 'ready'`）时，点击「更换密钥」会自动用新主密钥重加密所有已保存的 API Key，无需用户重新输入。
   - 当主密钥丢失或与当前配置不匹配（`status === 'locked'`）且无备份时，执行「重新生成」会安全清空无法解密的旧密文并生成新主密钥。
