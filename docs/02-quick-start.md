# 02. 快速开始与宿主接入

本章节介绍如何在 React 19 + Vite 宿主项目中接入 `SangAIKit`，并配置浮窗状态、配置存储、流式会话控制器与各 UI 插槽。

---

## 环境要求与安装

- **运行环境**：Node.js（Vite 要求 `20.19+` 或 `22.12+`）、Bun 及现代浏览器
- **核心对等依赖**：`react@^19.0.0`、`react-dom@^19.0.0`、`openai`、`lucide-react`

### 1. 同级目录本地开发接入

在宿主项目的 `package.json` 中添加本地文件引用：

```json
{
  "dependencies": {
    "sang-ai-kit": "file:../SangAIKit"
  }
}
```

当本地链接存在多份 React 实例时，请在宿主的 `vite.config.ts` 中配置 `resolve.dedupe`：

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom']
  }
});
```

> **样式免配置**：`AiAssistant` 与 `AiSettings` 会自动引入已编译并限定在 `:where(.cf-ai-panel, .sang-ai-settings, .sang-ai-portal)` 作用域下的工具类样式，宿主项目**无需安装或配置 Tailwind CSS**。

---

## 最小化后端代理接入示例

若宿主使用自有后端接口转发模型请求，只需实现 `AssistantStorage` 与 `AssistantRunner` 即可驱动 `useAssistant`：

```tsx
import {
  AiAssistant,
  useAssistant,
  useFloatingPanel,
  type AssistantRunner,
  type AssistantSnapshot,
  type AssistantStorage
} from 'sang-ai-kit';

const storage: AssistantStorage = {
  async load() {
    const raw = localStorage.getItem('my-app-ai-sessions');
    return raw ? (JSON.parse(raw) as AssistantSnapshot) : null;
  },
  async save(snapshot) {
    localStorage.setItem('my-app-ai-sessions', JSON.stringify(snapshot));
  }
};

const runner: AssistantRunner = async (messages, events) => {
  const response = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal: events.signal
  });
  if (!response.ok) throw new Error('AI 服务请求失败');
  events.onText(await response.text());
};
```

---

## 完整客户端功能接入架构

在完整接入模式下，推荐组合使用以下核心原语：

1. **`createBrowserAiStore`**：在 IndexedDB 中持久化 `AiConfig`，并对所有端点的 `apiKey` 进行 AES-256-GCM 透明加解密。
2. **`createIndexedDbImageStore`**：按 `sessionId` 与 `imageId` 存储用户上传附件与 AI 生成图像。
3. **`createResponsesSender`**：构建兼容 OpenAI Responses API 的流式发送器，自动装配内置工具（`generate_image`、`skill`、`list_fonts`）并驱动多轮工具调用。
4. **`useFloatingPanel`**：接管浮窗的位置记忆、拖拽边界吸附、指针缩放与键盘方向键微调（`ArrowKeys` + `Shift`）。

```tsx
<AiAssistant
  assistant={assistant}
  floating={floating}
  language={language}
  theme={theme}
  open={open}
  onOpenChange={setOpen}
  title="AI 助手"
  emptyTitle="智能助手已就绪"
  emptyDescription="与助手交流想法，探索工作区中的内容。"
  contextTitle="主画布 · 1920×1080"
  contextMeta="已选中 2 个图层"
  quickSnippets={config.quickSnippets ?? []}
  features={features}
  onFork={handleForkConversation}
  imageInsertAction={{
    visible: true,
    enabled: true,
    label: '置入工作区',
    successLabel: '已置入'
  }}
  active={{ endpoint: active.endpoint, model: active.model }}
  imageToolsEnabled={features.imageGeneration && availableImageModels(config).length > 0}
  loadImage={loadDemoImage}
  createImageUpload={createImageUpload}
  imageModelForTool={resolveImageModelForTool}
  sumUsage={sumUsage}
  renderMarkdown={renderSanitizedMarkdown}
  renderUsage={(prompt, english) => (
    <TokenUsageBar
      usage={sessionUsageSummary(activeSession, active.model, active.endpoint.endpoint, config.systemPrompt, prompt)}
      model={active.model}
      busy={assistant.busy}
      english={english}
    />
  )}
  renderModelControls={(disabled, english) => (
    <ModelControls
      config={config}
      configure={saveConfig}
      resolveSelection={resolveSelection}
      selectModel={selectModel}
      updateActiveModel={updateActiveModel}
      disabled={disabled}
      english={english}
    />
  )}
  renderSettings={(close, initialSecurity) => (
    <AiSettings
      config={config}
      features={features}
      onSave={saveConfig}
      onBack={close}
      english={language === 'en'}
      theme={theme}
      store={configStore}
      onKeyChanged={reloadConfig}
      initialSecurity={initialSecurity}
      showTurnLimits={showTurnLimits}
      supportsVision={active.model.supportsVision}
      createEndpoint={createEndpoint}
      createModel={createModel}
      normalizeConfig={normalizeConfig}
      resolveSelection={resolveSelection}
      defaults={defaults}
      renderImageModels={(draft, onChange, eng) => <ImageModelSettings config={draft} onChange={onChange} english={eng} />}
      renderSkills={(skills, onChange, eng) => <SkillSettings skills={skills} onChange={onChange} english={eng} />}
      renderFonts={(fonts, onChange, eng, enabled) => (
        <FontSettings fonts={fonts} onChange={onChange} english={eng} showLocalFonts={enabled.localFonts} showOnlineFonts={enabled.onlineFonts} />
      )}
      renderEncryption={(manager, callbacks, eng) => (
        <EncryptionKeySettings manager={manager} english={eng} {...callbacks} {...keyBackup} saveBackup={saveBackup} />
      )}
    />
  )}
/>
```
