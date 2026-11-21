# 08. 宿主启动会话、统一工具、占位符与工具栏插槽

本章介绍 SangAIKit 的四项宿主深度集成能力：宿主主动启动新会话、宿主业务工具与内置工具统一按会话选择、用户消息 `{{占位符}}` 替换与发送时快照回溯，以及输入框上方工具栏插槽与输入框控制。

---

## 一、宿主启动新会话（`startSession` / `newSession`）

宿主可通过 `assistant.newSession(options)` 或 `assistant.startSession?.(options)` 主动创建新会话，传入本次会话专属的系统提示词、是否对用户展示系统提示词、首条用户提示词以及本会话的可用工具集。

```ts
await assistant.newSession({
  title: '小说创作：寒雾古城',
  systemPrompt: '你是一位擅长东方悬疑长篇小说的共创编辑……',
  showSystemPrompt: true, // true 时在消息流顶部显示可折叠系统提示词卡片
  initialPrompt: '请结合{{故事介绍}}与{{卷纲}}，围绕{{角色:张三}}设计第一章开篇。',
  autoSend: true, // 默认 true：创建会话后立即发送首条提示词
  enabledTools: ['query_novel_outline', 'query_character_sheet', 'list_fonts']
});
```

### 随时调整本会话可用工具与右上角面板开关

在会话进行中的任意时刻，宿主都可以调用 `assistant.setSessionTools(toolNames, sessionId?)` 更新该会话的工具列表。

如果向 `<AiAssistant>` 传入了 `availableTools`，默认会在标题栏右上角以**下拉浮窗**（适当宽度，不挤压对话区域，支持点击外部或按 `Esc` 关闭）展示带搜索与树形分组复选框的工具面板。若宿主计划自行在输入框上方的 `renderComposerToolbar` 工具栏插槽中实现工具选择，可单独关闭右上角自带工具设置：

```tsx
// 方式 1：通过组件 Prop 关闭（优先级最高）
<AiAssistant showHeaderToolPicker={false} availableTools={availableTools} ... />

// 方式 2：通过全局 features 开关关闭
<AiAssistant features={{ ...features, sessionToolPicker: false }} availableTools={availableTools} ... />
```

宿主也可以直接复用导出的 `<SessionToolTree />` 组件（或子路径 `sang-ai-kit/session-tool-tree`）将带搜索的树形分组工具选择器嵌入到自己的工具栏弹层中。

```ts
// 动态调整当前会话的工具列表
await assistant.setSessionTools?.(['query_novel_outline', 'generate_image']);
```

---

## 二、业务工具与内置工具统一接入（`createToolRegistry` / `listAvailableTools`）

SangAIKit 提供轻量的工具注册表 `createToolRegistry()` 和工具描述汇总函数 `listAvailableTools()`，用于把宿主业务工具与 SangAIKit 内置工具（`remove_background`、`list_fonts`、`skill`、`list_image_models`、`generate_image`）统一管理，并按会话 `enabledTools` 过滤后下发给模型。

注册工具时支持额外声明两个面向 UI 的字段（支持字符串或 `{ zh, en }` 双语对象）：

- `group`：树形分组名称（例如 `'编辑工具'`、`'设定与大纲'`）
- `uiDescription`：面向用户的工具简介（例如 `'读取指定章节内容'`），与发给大模型工具签名的 `description` 完全隔离，不会覆盖 LLM Schema。

同时可通过 `builtInOverrides`（或通用的 `toolOverrides` / `applyToolMetadataOverrides`）按不同宿主项目自行调整内置工具的分组、名称、UI 介绍与默认勾选状态：

```ts
import {
  createToolRegistry,
  listAvailableTools,
  createResponsesSender
} from 'sang-ai-kit';

const registry = createToolRegistry();
registry.registerMany([
  {
    name: 'read_chapter_content',
    label: { zh: '读取指定章节', en: 'Read chapter content' },
    group: { zh: '编辑工具', en: 'Editing Tools' },
    uiDescription: { zh: '读取指定章节内容', en: 'Read the text of a specified chapter' },
    // 下方 description 仅用于大模型工具调用签名
    description: 'Fetch raw chapter text by 1-based chapterNumber from host manuscript store.',
    parameters: {
      type: 'object',
      properties: { chapterNumber: { type: 'number' } },
      required: ['chapterNumber']
    },
    execute: async args => readChapter(Number(args.chapterNumber))
  }
]);

// 合并业务工具与内置工具，并为内置工具按项目重新分组和赋值 UI 介绍
const availableTools = listAvailableTools({
  config,
  features,
  hostTools: registry.list(),
  builtInOverrides: {
    skill: {
      group: '创作规范',
      uiDescription: '读取项目内配置的文风与写作规范'
    },
    list_fonts: {
      group: '排版工具',
      uiDescription: '查询可用字体列表'
    },
    generate_image: {
      group: '视觉与插画',
      uiDescription: '根据剧情描述生成场景插画'
    }
  }
});

// 发送请求时按当前会话的 enabledTools 过滤业务工具和内置工具
const sender = createResponsesSender({
  baseURL,
  apiKey,
  model,
  instructions: session.systemPrompt ?? config.systemPrompt,
  tools: registry.list(),
  builtIn: { config, features, loadImage, saveImage },
  enabledTools: session.enabledTools
});
```

当某项内置工具（如 `generate_image` 或 `skill`）未包含在当前会话的 `enabledTools` 中时，其对应的内置工具提示词（`imageToolPrompt`、`<available_skills>`）也会自动裁剪，避免向模型泄露未启用的能力说明。

---

## 三、用户消息与系统提示词占位符及快照（`placeholders`）

在小说写作、文档审校等强上下文场景中，**用户输入**与**系统提示词（`systemPrompt` / `instructions`）**均支持插入 `{{故事介绍}}`、`{{卷纲}}`、`{{角色:张三}}` 等占位符。

### 工作流与数据模型

1. **启用开关**：同时受 `features.placeholders`（默认 `true`）与 `PlaceholderConfig.enabled` 控制。
2. **发送前单遍替换**：发送消息或启动会话时，SangAIKit 按宿主提供的 `items` 和 `resolve(key, context)` 单遍非递归解析所有占位符（`context.target` 会标明 `'user'` 或 `'system'`；解析结果内部如含 `{{...}}` 不会二次展开）。
3. **三份持久化记录**：
   - 用户消息（`ChatEntry`）保存 `rawContent`（原文）、`sentContent`（实际发送文本）与 `placeholders`（发送时赋值快照）。
   - 会话系统提示词（`AssistantSession`）同样保存 `systemPrompt`（原文）、`sentSystemPrompt`（实际发送系统提示词）与 `systemPromptPlaceholders`（当时赋值快照）。
4. **UI 展示与快照回溯**：无论在用户消息气泡中，还是在 `showSystemPrompt: true` 展开的系统提示词卡片中，界面都会保留可读的 `{{占位符}}` 可点击标签；即使宿主后续修改了角色设定或故事背景，点击历史标签依然展示**当时的真实内容快照**，并支持展开查看实际发送全文。重新生成（Regenerate）时也会保留当时的快照。

```ts
const assistant = useAssistant(runner, storage, {
  features,
  placeholders: {
    enabled: features.placeholders,
    items: [
      { key: '故事介绍', label: '故事介绍', group: '设定' },
      { key: '卷纲', label: '当前卷纲', group: '大纲' },
      { key: '角色:张三', label: '角色：张三', group: '角色' }
    ],
    resolve: async key => fetchLatestContextByKey(key)
  }
});
```

在自定义 `runner` 中：
- 用户消息使用 `getEntryModelContent(entry)`（或在 `ChatMessage` 上传递 `sentContent`）获取替换后的内容。
- 系统提示词使用 `getSessionSystemPrompt(events.session, fallback)` 获取替换后的 `sentSystemPrompt`；若直接调用 `createResponsesSender`，也可传入 `placeholders` 参数自动替换 `instructions` 中的占位符。

---

## 四、输入框上方工具栏插槽（`renderComposerToolbar` & `composerRef`）

`<AiAssistant>` 在输入框正上方提供 `renderComposerToolbar(composer: ComposerController)` 插槽，同时支持传入 `composerRef` 供宿主在任意位置操控输入框。

### `ComposerController` 能力一览

| 方法 / 属性 | 说明 |
| --- | --- |
| `value` | 当前输入框文本 |
| `setValue(next)` | 直接覆盖输入框内容 |
| `insertText(text, { focus? })` | 在当前光标/选区位置插入文本并保持光标定位 |
| `insertPlaceholder(key, { focus? })` | 在光标处插入 `{{key}}` 占位符 |
| `appendText(text, { separator?, focus? })` | 追加文本到末尾 |
| `clear()` | 清空输入内容 |
| `focus()` / `getSelection()` / `setSelection(start, end?)` | 聚焦与读写选区位置 |
| `submit(overridePrompt?)` | 触发发送 |
| `disabled` / `language` / `session` | 当前输入态、语言与活动会话信息 |

```tsx
<AiAssistant
  assistant={assistant}
  availableTools={availableTools}
  composerRef={composerRef}
  renderComposerToolbar={composer => (
    <>
      <select
        defaultValue=""
        disabled={composer.disabled}
        onChange={e => {
          if (!e.target.value) return;
          composer.setValue(e.target.value);
          composer.focus();
          e.target.value = '';
        }}
      >
        <option value="">快捷提示词…</option>
        <option value="围绕{{角色:张三}}续写冲突场景">续写冲突场景</option>
      </select>

      <select
        defaultValue=""
        disabled={composer.disabled}
        onChange={e => {
          if (!e.target.value) return;
          composer.insertPlaceholder(e.target.value);
          e.target.value = '';
        }}
      >
        <option value="">插入占位符…</option>
        <option value="故事介绍">{'{{故事介绍}}'}</option>
        <option value="卷纲">{'{{卷纲}}'}</option>
        <option value="角色:张三">{'{{角色:张三}}'}</option>
      </select>
    </>
  )}
  {...otherProps}
/>
```
