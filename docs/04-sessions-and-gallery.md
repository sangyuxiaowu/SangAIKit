# 04. 会话管理、分叉与图片画廊

`SangAIKit` 内置了完整的会话历史管理、按序穿插的思考/工具活动流（Activity Stream）、无损对话分叉（Fork）以及多维度图片画廊（Image Gallery）。

---

## 会话存储与图片解耦协议 (`AssistantStorage`)

`useAssistant(runner, storage)` 采用结构与二进制分离的存储架构：

1. **会话快照 (`AssistantSnapshot`)**：保存会话元数据、消息条目（`entries`）、每次请求耗时与 Token 记录（`requests`）以及 Responses API 原生上下文项（`responseItems`）。
2. **图片仓库 (`ImageStore`)**：通过 `createIndexedDbImageStore(dbName)` 将上传附件与 AI 生成图片的 `Blob` 独立存储在 IndexedDB 中，消息内仅保留轻量级元数据 `{ id, name, type, size }`。
3. **活动顺序保证 (`activity`)**：在同一轮回复中，模型可能交替产生多段「思考推理 (`reasoning`)」、「工具调用 (`tool`)」与「文本输出 (`text`)」。`useAssistant` 严格按照流式事件与 `responseItems` 的先后顺序记录 `entry.activity`，重开会话时完整还原穿插时间线。

---

## 对话分叉 (`onFork`) 与安全重做 (`regenerate`)

### 1. 从任意助手回复分叉会话
当宿主向 `AiAssistant` 传入 `onFork` 回调时，每条已完成的 AI 回复底部都会展示分叉按钮（`<GitFork />`）：
- 点击后组件触发 `onFork({ sessionId, entryId, responseItemCount })`。
- 宿主负责截断该条回复之后的 `entries` 与 `responseItems`，将该节点前引用的所有图片复制到新会话 ID 下，并创建名为 `原会话标题 (分叉)` 的独立分支会话。

### 2. 重新生成（Redo）
- 重新生成按钮默认仅出现在**最后一条已完成的 AI 回复**上；宿主可通过 `assistant.canRegenerate` 控制显示。
- 通用控制器重新发送最近一条用户消息，复用其图片附件，并截断该轮的会话上下文；历史会话也可重新生成。旧会话缺少原生历史截断标记时，会根据消息重建上下文，无法完整恢复原生工具和思考记录。
- 原回复中的图片引用保留在会话画廊中，重新生成不会删除已生成的图片。
- 已执行的外部操作不会自动撤销，重做可能再次调用工具或产生费用。需要回滚外部状态的宿主应自行实现相应控制；自动重试仍不会重复执行包含工具的轮次。

---

## 历史会话与图片画廊 (`SessionList`)

点击助手右上角的「历史对话」按钮可进入双视图管理面板：

### 1. 历史对话视图
- 支持按标题关键词实时检索会话、内联重命名会话标题、查看每个会话的更新时间与消息条数，以及带确认拦截的会话删除（自动清理关联的 IndexedDB 图片）。

### 2. 图片画廊视图 (Image Gallery)
画廊自动聚合所有会话中的图片资源，并提供四大分类标签：
- **全部 (`all`)**：展示所有会话中的图片并汇总占用体积。
- **AI 生图 (`generated`)**：由 `generate_image` 工具生成的作品，自动提取并展示生图 `prompt` 提示词。
- **过程预览 (`preview`)**：由宿主通过 `classifyGalleryImage` 归类为过程渲染图或画布快照的图像。
- **参考附件 (`attachment`)**：用户在输入框上传或粘贴的参考图。

### 3. 画廊图片置入宿主工作区 (`imageInsertAction`)
宿主可通过以下两个属性打通「AI 画廊 -> 宿主画布」的闭环：
- **`assistant.insertImage(item)`**：接收 `{ sessionId, imageId, name, category, prompt }`，由宿主读取图片 `Blob` 并渲染到工作区文档中。
- **`imageInsertAction`**：精细控制画廊卡片上的置入按钮行为：
  - `visible`：是否显示置入按钮
  - `enabled`：当前是否允许置入（设为 `false` 时按钮禁用并展示 `disabledReason` 悬停提示）
  - `label` / `successLabel`：自定义按钮文案（如「置入画布」/「已置入」）
  - `isVisible(item)`：按单张图片粒度控制是否可置入（默认排除 `preview` 类别，宿主可自定义放开）
