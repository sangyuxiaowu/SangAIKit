# 本地抠图

SangAIKit 提供无需模型的颜色抠图和基于 ONNX 的本地智能抠图。图片在本地处理，不上传服务端；宿主负责图层、权限、撤销及结果应用。设置 `features.backgroundRemoval` 控制设置页与内置 `remove_background` 工具，默认开启，关闭不删除已下载资源。

通用工具默认使用 `imageId` 读取会话原图并保存结果，在宿主提供成对图片读写回调或抠图宿主扩展时注册。默认改为 `modelId: "u2netp"`，与 CoverFlow 已验证的默认行为一致；颜色抠图须显式指定 `modelId: "color"`。颜色参数统一放在可选的 `colorOptions` 对象中，不再接受顶层颜色参数：`color`（`#RRGGBB`，默认白色）、`tolerance`（0–100，默认 25）、`contiguous`（默认 true，从图片边缘开始）和 `feather`（0–10 像素，默认 1.5）。对象及其字段均可省略，例如 `{ "imageId": "source", "modelId": "color", "colorOptions": { "color": "#ffffff", "tolerance": 20 } }`。AI 模型接受 `u2netp`、`birefnet`、`modnet`，支持 `device: auto/webgpu/wasm`，默认 auto。

工具与手动入口共用 `removeBackground`：缺少运行时则自动下载（最长 180 秒），缺少所选模型则自动下载（最长 600 秒）、实际推理验证并缓存，然后继续处理原图。已有缓存不重复下载；取消会停止后续推理和结果保存，下载或验证失败如实报告，可由用户重试，不保存半成品模型。首次使用需联网，图片不上传；后续可离线复用缓存。自动下载不修改用户的默认模型设置。

宿主可通过[图片工具扩展](./03-features-and-tools.md#内置工具链-createbuiltintools)提供原图并直接接收结果 Blob，无需另写同名抠图定义或下载流程。项目、页面、图层锁定、原图变化、保留原图和保存由宿主负责；没有扩展时仍使用会话图片协议。

`applyColorMatting` 也支持以 `startX`、`startY` 为连通区域起点。

## 交互编辑器

`ColorMattingEditor` 是独立的图片编辑弹窗，接收 `Blob` 或图片 URL，提供取色、容差、连通区域、羽化、手动擦除和恢复原图、笔刷大小、缩放、撤销及清除笔迹。可关闭颜色抠图，仅使用笔刷。输出为原尺寸 PNG，不依赖模型或运行时；关闭弹窗会取消处理。预览最长边为 800 像素，极小笔迹可能在预览中略放大，最终计算在 Worker 按原图坐标执行。

```tsx
import { ColorMattingEditor } from 'sang-ai-kit';

<ColorMattingEditor
	image={imageBlob}
	onClose={() => setOpen(false)}
	onApply={async (result, signal) => {
		const prepared = await prepareResult(result);
		signal.throwIfAborted();
		applyResult(prepared);
	}}
/>
```

宿主负责图片权限、结果应用和撤销等业务；异步应用结果前须检查 `signal` 和宿主数据是否仍有效。组件限制图片不超过 50 MB、4000 万像素。

## 资源存储

模型、运行时和抠图设置默认保存在当前来源的 IndexedDB `sang-ai-kit-background-removal`。宿主可在首次使用任何抠图资源之前指定数据库名称，以复用已有的兼容缓存或隔离应用：

```ts
import { configureBackgroundRemovalStorage } from 'sang-ai-kit';

configureBackgroundRemovalStorage({ databaseName: 'my-app-background-removal' });
```

配置对当前页面的工具包实例全局生效，首次访问资源后不能切换到其他数据库；相同名称可重复配置。不会自动复制或迁移其他数据库的数据。

## 模型及运行时

不随应用打包任何模型。设置页在线下载模型并进行实际推理验证，验证成功后才保存并激活；已有同一浏览器缓存继续使用。模型文件的大小仅供展示，不作为哈希或版本锁。模型最大 1 GB，图片最大 40 MP；输出保持原始像素尺寸，将蒙版乘入原 alpha 并编码为 PNG。

- U2NetP：320×320，轻量通用模型，[下载](https://www.modelscope.cn/models/budaoshou/U2NetP-ONNX/resolve/master/u2netp.onnx?view=false)。
- BiRefNet Lite 512：512×512，适合复杂边缘；[FP16](https://www.modelscope.cn/models/sangsq/birefnet-lite-512/resolve/master/model_fp16.onnx?view=false)、[FP32](https://www.modelscope.cn/models/sangsq/birefnet-lite-512/resolve/master/model.onnx?view=false)。不复用旧版 1024 模型缓存。
- MODNet：512×512，人像模型；[FP32](https://www.modelscope.cn/models/onnx-community/modnet-webnn/resolve/master/onnx/model.onnx?view=false)、[FP16](https://www.modelscope.cn/models/onnx-community/modnet-webnn/resolve/master/onnx/model_fp16.onnx?view=false)。由于 WebGPU 数值异常，始终使用 CPU/WASM。

ONNX Runtime Web 1.23.2 从 jsDelivr 按需下载并缓存于 IndexedDB，设置页支持导入同版本的可信 `ort.webgpu.bundle.min.mjs`、`ort-wasm-simd-threaded.asyncify.mjs` 和 `ort-wasm-simd-threaded.asyncify.wasm`。运行时包含可执行 JavaScript，必须来自可信来源。推理在 Worker 运行，可取消，10 分钟超时；默认优先 WebGPU，失败回退单线程 WASM。

U2NetP 使用最大 RGB 值缩放、ImageNet 归一化和输出 min-max；BiRefNet 使用 ImageNet 归一化和 sigmoid；MODNet 使用 `(RGB / 255 - 0.5) / 0.5`，输出直接截断为 alpha。支持单个 NCHW float32/float16 输入和单通道输出，不支持外置权重文件。
