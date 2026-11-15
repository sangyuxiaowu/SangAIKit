import type { ResponsesRequestSnapshot } from '../src';

const IMAGE_DATA_URL = /^data:image\/[^;]+;base64,/i;

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (!IMAGE_DATA_URL.test(value)) return value;
    const payload = value.slice(value.indexOf(',') + 1);
    return `[image payload redacted: about ${Math.floor(payload.length * 3 / 4)} bytes]`;
  }
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item)]));
}

export function redactRequestSnapshot(request: ResponsesRequestSnapshot) {
  return { endpoint: request.endpoint, body: redactValue(request.body) as Record<string, unknown> };
}

export default function DemoRequestInspector({ request }: { request: ReturnType<typeof redactRequestSnapshot> | null }) {
  const tools = Array.isArray(request?.body.tools) ? request.body.tools : [];
  const instructions = typeof request?.body.instructions === 'string' ? request.body.instructions : '(none)';

  return <details className="demo-request-inspector">
    <summary>最近的实际网络请求{request ? ` · ${tools.length} tools` : ''}</summary>
    {!request ? <p>暂无真实请求；本地模拟回复不会发起网络请求。</p> : <div className="demo-request-content">
      <div><span>POST</span><code>{request.endpoint}</code></div>
      <section><h3>最终 instructions</h3><pre>{instructions}</pre></section>
      <section><h3>注册工具签名 · {tools.length}</h3><pre>{JSON.stringify(tools, null, 2)}</pre></section>
      <details className="demo-request-raw">
        <summary>完整请求 JSON</summary>
        <pre>{JSON.stringify(request.body, null, 2)}</pre>
      </details>
      <small>API Key 不在请求体中；图像 Base64 内容已脱敏。</small>
    </div>}
  </details>;
}
