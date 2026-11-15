# SangAIKit

SangAIKit 是面向 React 应用的通用 AI 助手组件与能力包，包含浮窗、配置中心、会话列表、图片画廊、模型选择、SKILL、字体管理、生图协议、密钥管理和用量面板。宿主应用通过适配器接入自己的工作区与业务工具。

## 运行演示

需要 Bun、Node.js（Vite 7 要求 20.19+ 或 22.12+）及现代浏览器。

```bash
bun install
bun run dev
```

演示支持会话新建、切换、重命名和删除、窗口拖动及缩放、多端点模型、图片附件、SKILL、生图、工具步骤、用量、浅色和深色。默认模型使用模拟回复和模拟工具，不访问远端；会话文本保存在浏览器 localStorage，图片保存在 IndexedDB。选择真实模型并配置兼容 Responses API 的端点后，可调用真实模型及配置的生图服务，可能产生费用。

演示将配置和 AES-GCM 加密后的 API Key 保存在 IndexedDB，须主动创建或导入主密钥；创建后可以下载口令保护的备份。主密钥不可导出，但运行时解密后的密钥仍可能被页面脚本读取，不能抵御设备或页面上的所有攻击。真实请求受跨域限制；公开生产环境建议把密钥和模型调用放在后端。

## 当前边界

| 已共享 | 仍由宿主实现 |
| --- | --- |
| 助手浮窗、配置中心、历史和图片画廊、SKILL、字体和生图设置 | 本地抠图等宿主专用设置面板 |
| Responses 流、思考、工具轮次、原生历史、用量和图片附件 | 应用专属工具的定义、权限、确认及执行 |
| Kolors、Agnes、GPT Image 生图协议、图片存储和密钥管理 | 将图片或工具结果应用到宿主工作区 |
| 可选 `useAssistant` 通用会话控制器和浏览器加密存储 | 宿主业务操作的撤销/重做及原生文件存储 |

`useAssistant` 通过 `AssistantRunner` 接收文本、思考、工具状态和原生历史；工具可能有副作用，因此通用控制器在本轮出现工具或图片附件时禁用重新生成。需要事务回滚的应用应自行提供可验证的重做实现。演示使用 `attachment://` 资源引用保存图片历史，发送视觉请求时才加载，文本模型不读取图片；若接入方直接传入 data URL，则历史会包含该数据。

工作区读写、业务工具和原生文件权限由接入方明确实现。组件的宿主接口目前仍处于开发阶段，尚未承诺稳定的发布 API。

## 宿主接入

项目当前导出 TypeScript/TSX 源码，适合 Vite 等支持编译依赖源码的 React 构建工具；需要 React 19、React DOM 19 和 OpenAI SDK 7。浮窗和配置中心自动引入已编译并限定组件作用域的样式，宿主不需要安装 Tailwind。若修改组件中使用的工具类，组件项目维护者需运行 `bun run build:styles` 并将更新后的 `generated/sang-ai-utilities.css` 一并提交；普通接入方无需执行此命令。

同级目录本地开发时，在宿主的 `package.json` 加入：

```json
"@sangyuxiaowu/sang-ai-kit": "file:../SangAIKit"
```

然后在宿主执行 `bun install`。

本地链接存在多份 React 时，Vite 宿主需设置 `resolve.dedupe: ['react', 'react-dom']`。本地路径要求每台开发机和 CI 有相同目录结构，不能独立克隆宿主后直接安装。链接或复制行为由安装器决定，修改组件后若未更新请重新安装依赖。

`AiAssistant` 接收 `AssistantController`、浮窗控制、模型信息，以及 Markdown、设置、用量、模型控件等插槽。`AiSettings` 接收配置与校验操作，生图、SKILL、字体、抠图和密钥面板按宿主能力注入；未提供的能力不显示。`useFloatingPanel` 接收位置存储接口；`useAssistant` 和 `createResponsesSender` 提供通用会话与 Responses 适配。可直接从演示适配器开始：`demo/main.tsx` 管理配置与界面，`demo/useDemoAssistant.ts` 注册工作区、SKILL 和生图工具。

宿主可通过 `createResponsesSender({ tools: [...] })` 注册函数工具；每个工具提供 JSON Schema 与 `execute`，并负责在执行前做参数校验、权限控制与必要的用户确认。工具执行状态可通过 `onTool` 回传界面，生图结果应通过会话图片存储保存，不能把付费或有副作用的工具默认当作可回滚操作。

例如，使用自己的后端代理时，可先实现会话存储和发送适配器：

```tsx
import { useAssistant, type AssistantRunner, type AssistantSnapshot, type AssistantStorage } from '@sangyuxiaowu/sang-ai-kit';

const storage: AssistantStorage = {
	async load() {
		const value = localStorage.getItem('my-app-ai-sessions');
		return value ? JSON.parse(value) as AssistantSnapshot : null;
	},
	async save(snapshot) {
		localStorage.setItem('my-app-ai-sessions', JSON.stringify(snapshot));
	}
};

const runner: AssistantRunner = async (messages, events) => {
	const response = await fetch('/api/ai', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ messages }),
		signal: events.signal
	});
	if (!response.ok) throw new Error('AI 请求失败');
	events.onText(await response.text());
};

// 在 React 组件内：
// const assistant = useAssistant(runner, storage);
```

将 `assistant`、`useFloatingPanel` 的返回值、当前模型、文案和各插槽传给 `AiAssistant`。对接服务端 SSE、工具、图片或 Responses 原生历史时，分别调用 `events.onText`、`onTool`、`loadImage` / `saveImage` 和 `onHistory`；示例仅展示普通文本，完整用法参考演示。上例会将消息明文写入 localStorage，不适合敏感数据；图片需要另行提供 `AssistantStorage.images`，可使用 `createIndexedDbImageStore`。

浮窗与配置中心通过各自的 `theme="light"`、`"dark"` 或 `"system"` 切换基础主题。宿主可在祖先元素提供 `--sang-ai-accent`；部分原有状态颜色和宿主注入面板仍未统一为主题变量。

## Git 引用

本机开发不需要 Git。若希望其他开发者或 CI 不依赖相邻目录，可将此目录提交并推送为独立 GitHub 仓库，然后在宿主安装固定提交或标签：

```bash
bun add 'git+https://github.com/sangyuxiaowu/SangAIKit.git#<commit-or-tag>'
```

地址仅为预期仓库地址，目前未创建或推送；私有仓库需要自行配置 Git 身份认证。固定提交或标签并提交宿主锁文件，不要在依赖地址中写入令牌。也可在后续发布到 npm 后按版本引用。

## 验证

```bash
bun run test
bun run test:integration
bun run typecheck
bun run build:styles
bun run build
```

许可：Apache-2.0。完整条款见 [LICENSE](LICENSE)。