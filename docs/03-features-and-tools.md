# 03. 功能开关与工具调用链

`SangAIKit` 提供了一套声明式的宿主功能开关（`AiFeatures`）与可扩展的多轮工具执行引擎（`runToolLoop` + `createBuiltInTools`）。宿主可以在运行时动态裁剪功能模块，所有开关变更均会立即反映在助手界面、配置中心标签页与下一次请求的指令及工具列表中。

---

## 宿主功能开关 (`AiFeatures`)

`AiFeatures` 由宿主接入时统一传入 `AiAssistant`、`AiSettings` 以及 `createResponsesSender` 的 `builtIn` 选项中：

| 属性名 | 默认值 | 控制范围与联动规则 |
| --- | --- | --- |
| `imageGeneration` | `true` | 控制配置中心「生图模型」与「系统提示词 -> 生图工具附加提示词」的显隐；仅当开启且存在**已启用并绑定有效端点**的生图模型时，才会向大模型注册 `generate_image` 工具并注入生图规范提示词。 |
| `skills` | `true` | 控制配置中心「SKILL」标签页显隐；仅当开启且已配置至少 1 条技能规则时，向大模型注册 `skill` 工具并在系统提示词中附带技能摘要目录。 |
| `quickSnippets` | `true` | 控制配置中心「快捷短语」标签页及对话空白状态下的快捷提问胶囊展示。 |
| `fontManagement` | `true` | 控制配置中心「其他设置 -> 字体资源与排版管理」板块及 `list_fonts` 工具的注册。关闭时不会注册字体工具，且自动屏蔽 `onlineFonts`。 |
| `onlineFonts` | `true` | 从属于 `fontManagement`。开启时允许 `list_fonts` 返回内置 Google Fonts 开源商用字体目录并在设置页展示精选在线字体。 |

> **非破坏性切换**：关闭任何功能开关**不会删除**用户已保存的生图模型、SKILL 规则、快捷短语或已选本地字体配置；重新开启后原配置立即恢复生效。

---

## 内置工具链 (`createBuiltInTools`)

`createResponsesSender` 会在每轮请求前自动调用 `createBuiltInTools` 生成独立的内置工具实例，宿主也可手动调用并将其与自定义工具合并：

1. **`list_fonts`**：查询可用字体资源（包含 Google Fonts 开源字体与用户在字体管理中添加的本地系统字体及用途备注）。
2. **`skill`**：按技能名称按需读取某项 SKILL 的完整 Markdown 规则全文，避免在每轮对话中全量塞入所有长篇规范以节省 Token。
3. **`generate_image`**：调用已启用的生图模型（支持 `kolors`、`agnes`、`gpt-image`），支持文本生图与参考图重绘（引用会话中的 `attachment://` 图片 ID），生成结果自动写入 `saveImage` 并关联至工具事件卡片。

---

## 注册宿主自定义业务工具

宿主可通过 `createResponsesSender({ tools: [...] })` 注入任意数量的业务工具：

```ts
const tools: ResponsesTool[] = [
  {
    name: 'read_workspace',
    description: '读取当前工作区画布尺寸、活动图层与设计元数据。',
    parameters: {
      type: 'object',
      properties: {
        includeLayers: { type: 'boolean', description: '是否包含图层明细' }
      }
    },
    execute: async (args, signal) => {
      return {
        canvas: '1920x1080',
        activeLayer: '主视觉标题',
        layersCount: 4
      };
    }
  }
];
```

### 多模态工具结果

文档编辑器等宿主可让自己的工具渲染页面预览，再返回 `ResponsesToolContent`；页面选择、权限、渲染和保存均由宿主负责：

```ts
import type { ResponsesTool, ResponsesToolContent } from 'sang-ai-kit';

// 在 AssistantRunner 中，events 属于当前会话；renderPagePreview 由宿主实现。
const previewTool: ResponsesTool = {
  name: 'preview_page',
  description: '返回当前文档页面的排版预览。',
  parameters: { type: 'object', properties: {} },
  execute: async (_args, signal) => {
    const blob = await renderPagePreview(signal);
    const image = await events.saveImage(blob, 'page-1.webp');
    return {
      type: 'responses_tool_content',
      content: [
        { type: 'input_text', text: '第 1 页排版预览' },
        { type: 'input_image', image_url: `attachment://${image.id}`, detail: 'high' }
      ]
    } satisfies ResponsesToolContent;
  }
};
```

将工具传入 `createResponsesSender({ tools: [previewTool], loadImage: events.loadImage, supportsVision, ... })`，并将 `events.onHistory` 和 `events.onTool` 接入发送器。发送器将内容转换为原生 `function_call_output.output` 数组，不会把图片序列化成 JSON 字符串；普通工具结果仍按 JSON 文本处理。`content` 必须为非空的 `input_text` / `input_image` 数组，图片只接受本地 PNG、JPEG、WebP data URL 或 `attachment://<id>` 引用，`detail` 可为 `auto`、`low`、`high`、`original`。不接受外部图片 URL。

推荐使用当前会话图片存储及 `attachment://` 引用：历史保留引用，视觉请求发送时才通过 `loadImage` 读取图片；引用缺失或格式无效会产生工具错误。`supportsVision: false` 时请求副本中的图片替换为明确提示，不读取图片且不修改历史。直接返回 data URL 时历史包含图片数据，但工具事件摘要会隐藏图片 Base64；`onRequest` 仍能看到实际请求体，宿主应自行脱敏。

---

## 轮次限制与失败预算

- **`maxToolRounds`（默认 `24`）**：单次用户提问允许大模型连续调用工具的最大轮次。达到上限时停止继续调用工具并标记当前回复为 `continuable: true`，界面显示「本轮已暂停，已完成的修改已保留」及「继续」按钮。
- **`maxImageFailures`（默认 `3`）**：单次请求内生图工具允许累计失败的最大次数，超出后阻止继续发起生图请求以防止异常循环扣费。
- **`0` 表示无上限**：两项限制均支持设为 `0`（无限制），即使在无限制模式下，用户依然可以随时点击停止按钮中断请求。

---

## 网络请求检查器 (`onRequest`)

`createResponsesSender` 支持传入 `onRequest?: (snapshot: ResponsesRequestSnapshot) => void` 回调，在每次向远端发起 `POST /responses` 前同步报告：
- 最终拼接的请求 URL（`endpoint`）
- 完整 JSON 请求体（包含合并了 SKILL 摘要与生图规范后的 `instructions`、实际生效的 `tools` Schema 列表、`reasoning` 参数及 `input` 消息序列）
- 演示工作区中的 `DemoRequestInspector` 会自动对图片 Data URL 的 Base64 载荷进行字节脱敏展示，便于开发者调试提示词与工具注册状态。
