import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Eye, Eraser, Grid, Moon, Paintbrush, Pipette, RotateCcw, Scissors, Sliders, Sparkles, Sun, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { applyBrushStrokes, applyColorMatting, removeColorBackground, type BrushStroke } from './colorMatting';
import { download } from './resources';
import './color-matting.css';

export interface ColorMattingEditorProps {
  image: Blob | string;
  english?: boolean;
  onApply: (result: Blob, signal: AbortSignal) => void | Promise<void>;
  onClose: () => void;
}

type Tool = 'pick' | 'erase' | 'restore';
type StageBackdrop = 'checker' | 'dark' | 'light';

const PRESET_COLORS = [
  { hex: '#ffffff', zh: '纯白', en: 'White' },
  { hex: '#000000', zh: '纯黑', en: 'Black' },
  { hex: '#00ff00', zh: '绿幕', en: 'Green' },
  { hex: '#0057ff', zh: '蓝幕', en: 'Blue' },
  { hex: '#f1f5f9', zh: '浅灰', en: 'Gray' }
] as const;

const BRUSH_PRESETS = [8, 18, 36, 72] as const;

export default function ColorMattingEditor({ image, english = false, onApply, onClose }: ColorMattingEditorProps) {
  const [color, setColor] = useState('#ffffff');
  const [tolerance, setTolerance] = useState(25);
  const [feather, setFeather] = useState(1.5);
  const [contiguous, setContiguous] = useState(true);
  const [colorMatting, setColorMatting] = useState(true);
  const [seed, setSeed] = useState<{ x: number; y: number }>();
  const [tool, setTool] = useState<Tool>('pick');
  const [brushSize, setBrushSize] = useState(18);
  const [zoom, setZoom] = useState(1);
  const [backdrop, setBackdrop] = useState<StageBackdrop>('checker');
  const [compareOriginal, setCompareOriginal] = useState(false);
  const [imageSize, setImageSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [cursor, setCursor] = useState<{ x: number; y: number }>();
  const [strokes, setStrokes] = useState<BrushStroke[]>([]);
  const [blob, setBlob] = useState<Blob>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const source = useRef<ImageData | null>(null);
  const working = useRef<ImageData | null>(null);
  const dimensions = useRef({ width: 0, height: 0 });
  const activeStroke = useRef<BrushStroke | null>(null);
  const abort = useRef(new AbortController());
  const text = (zh: string, en: string) => english ? en : zh;
  const targetColor = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16)) as [number, number, number];

  useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    source.current = null;
    working.current = null;
    setBlob(undefined);
    setStrokes([]);
    setSeed(undefined);
    setCompareOriginal(false);
    setError('');
    setBusy(false);
    void (async () => {
      try {
        const loaded = typeof image === 'string'
          ? await download(new URL(image, window.location.href).href, 50 * 1024 * 1024, controller.signal)
          : image;
        if (loaded.size > 50 * 1024 * 1024) throw new Error('Image exceeds size limit');
        const bitmap = await createImageBitmap(loaded);
        try {
          if (controller.signal.aborted) return;
          if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) throw new Error('Image exceeds 40 megapixels');
          dimensions.current = { width: bitmap.width, height: bitmap.height };
          setImageSize({ width: bitmap.width, height: bitmap.height });
          const element = canvas.current!;
          const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
          element.width = Math.max(1, Math.round(bitmap.width * scale));
          element.height = Math.max(1, Math.round(bitmap.height * scale));
          const context = element.getContext('2d', { willReadFrequently: true });
          if (!context) throw new Error('Canvas is unavailable');
          context.drawImage(bitmap, 0, 0, element.width, element.height);
          source.current = context.getImageData(0, 0, element.width, element.height);
          setBlob(loaded);
        } finally { bitmap.close(); }
      } catch (reason) { if (!controller.signal.aborted) setError(String(reason)); }
    })();
    return () => controller.abort();
  }, [image]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const previewStroke = (stroke: BrushStroke): BrushStroke => {
    const original = dimensions.current;
    const preview = source.current!;
    return {
      ...stroke,
      radius: Math.max(0.75, stroke.radius * preview.width / original.width),
      points: stroke.points.map(point => ({ x: point.x * preview.width / original.width, y: point.y * preview.height / original.height }))
    };
  };

  useEffect(() => {
    const original = source.current;
    if (!blob || !original || !canvas.current) return;
    if (compareOriginal) {
      canvas.current.getContext('2d')?.putImageData(original, 0, 0);
      return;
    }
    const scaleX = original.width / dimensions.current.width;
    const scaleY = original.height / dimensions.current.height;
    const options = { targetColor, tolerance, feather: feather * scaleX, contiguous,
      ...(seed ? { startX: Math.min(original.width - 1, Math.floor(seed.x * scaleX)), startY: Math.min(original.height - 1, Math.floor(seed.y * scaleY)) } : {}) };
    const result = colorMatting ? applyColorMatting(original, options) : new ImageData(new Uint8ClampedArray(original.data), original.width, original.height);
    applyBrushStrokes(result, original, strokes.map(previewStroke));
    working.current = result;
    canvas.current.getContext('2d')?.putImageData(result, 0, 0);
  }, [blob, color, tolerance, feather, contiguous, colorMatting, seed, strokes, compareOriginal]);

  const position = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(dimensions.current.width - 1, (event.clientX - rect.left) * dimensions.current.width / rect.width)),
      y: Math.max(0, Math.min(dimensions.current.height - 1, (event.clientY - rect.top) * dimensions.current.height / rect.height))
    };
  };

  const paint = (stroke: BrushStroke) => {
    if (!source.current || !working.current || !canvas.current) return;
    applyBrushStrokes(working.current, source.current, [previewStroke(stroke)]);
    canvas.current.getContext('2d')?.putImageData(working.current, 0, 0);
  };

  const pointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!blob || busy || event.button !== 0 || !source.current) return;
    if (compareOriginal) setCompareOriginal(false);
    const point = position(event);
    if (tool === 'pick') {
      const x = Math.min(source.current.width - 1, Math.floor(point.x * source.current.width / dimensions.current.width));
      const y = Math.min(source.current.height - 1, Math.floor(point.y * source.current.height / dimensions.current.height));
      const offset = (y * source.current.width + x) * 4;
      setColor('#' + Array.from(source.current.data.slice(offset, offset + 3), value => value.toString(16).padStart(2, '0')).join(''));
      setSeed(point);
      setColorMatting(true);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    activeStroke.current = { mode: tool, radius: brushSize, points: [point] };
    paint(activeStroke.current);
  };

  const pointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (tool !== 'pick' && blob) {
      const rect = event.currentTarget.getBoundingClientRect();
      setCursor({ x: Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)),
        y: Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100)) });
    }
    const stroke = activeStroke.current;
    if (!stroke) return;
    const point = position(event);
    const previous = stroke.points[stroke.points.length - 1];
    stroke.points.push(point);
    paint({ ...stroke, points: [previous, point] });
  };

  const pointerUp = () => {
    const stroke = activeStroke.current;
    activeStroke.current = null;
    if (stroke) setStrokes(previous => [...previous, stroke]);
  };

  const resetAllParameters = () => {
    setColor('#ffffff');
    setTolerance(25);
    setFeather(1.5);
    setContiguous(true);
    setColorMatting(true);
    setSeed(undefined);
    setStrokes([]);
    setCompareOriginal(false);
    setZoom(1);
  };

  const apply = async () => {
    if (!blob || busy) return;
    const signal = abort.current.signal;
    setBusy(true);
    setError('');
    try {
      const options = { targetColor, tolerance, feather, contiguous,
        ...(seed ? { startX: Math.floor(seed.x), startY: Math.floor(seed.y) } : {}) };
      const result = await removeColorBackground(blob, options, signal, { colorMatting, strokes });
      signal.throwIfAborted();
      await onApply(result, signal);
      signal.throwIfAborted();
      onClose();
    } catch (reason) { if (!signal.aborted) setError(String(reason)); }
    finally { if (!signal.aborted) setBusy(false); }
  };

  const toolButton = (value: Tool, ariaLabel: string, shortText: string, Icon: typeof Pipette) => (
    <button
      type="button"
      className="sak-matting-tool-btn"
      title={ariaLabel}
      aria-label={ariaLabel}
      aria-pressed={tool === value}
      onClick={() => {
        setTool(value);
        setCompareOriginal(false);
      }}
      disabled={!blob || busy}
    >
      <Icon size={15} />
      <span>{shortText}</span>
    </button>
  );

  return (
    <div className="sak-matting-overlay" role="dialog" aria-modal="true" aria-label={text('颜色抠图', 'Color matting')}>
      <div className="sak-matting">
        {/* 顶部标题栏 */}
        <header className="sak-matting-header">
          <div className="sak-matting-header-left">
            <div className="sak-matting-brand-icon" aria-hidden="true">
              <Scissors size={17} />
            </div>
            <div className="sak-matting-title-wrap">
              <div className="sak-matting-title-row">
                <h2>{text('颜色抠图', 'Color matting')}</h2>
                <span className="sak-matting-badge">
                  {text('色彩容差 + 画笔精修', 'Color Key + Brush Refine')}
                </span>
                {imageSize.width > 0 && (
                  <span className="sak-matting-meta-pill">
                    {imageSize.width} × {imageSize.height} px
                  </span>
                )}
              </div>
              <p className="sak-matting-subtitle">
                {text(
                  '吸取背景主色自动抠除，并支持局部擦除或恢复原图像素细节',
                  'Sample background color for automatic removal and refine edges with erase/restore brushes'
                )}
              </p>
            </div>
          </div>

          <div className="sak-matting-header-actions">
            <button
              type="button"
              className="sak-matting-ghost-btn"
              disabled={!blob || busy}
              onClick={resetAllParameters}
              title={text('重置全部参数与笔迹', 'Reset all parameters and strokes')}
            >
              <RotateCcw size={14} />
              <span>{text('重置全部', 'Reset all')}</span>
            </button>
            <button
              type="button"
              className="sak-matting-close-btn"
              onClick={onClose}
              aria-label={text('关闭', 'Close')}
              title={text('关闭 (Esc)', 'Close (Esc)')}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {/* 主体区域：左侧画布工作台 + 右侧参数控制栏 */}
        <div className="sak-matting-body">
          <div className="sak-matting-workspace">
            {/* 画布顶部工具栏 */}
            <div className="sak-matting-toolbar">
              <div className="sak-matting-tools" role="group" aria-label={text('工具', 'Tools')}>
                {toolButton('pick', text('取色', 'Pick color'), text('吸管取色', 'Pick'), Pipette)}
                {toolButton('erase', text('擦除', 'Erase'), text('擦除像素', 'Erase'), Eraser)}
                {toolButton('restore', text('恢复原图', 'Restore original'), text('恢复原图', 'Restore'), Paintbrush)}
              </div>

              <div className="sak-matting-divider" aria-hidden="true" />

              <div className="sak-matting-history">
                <button
                  type="button"
                  className="sak-matting-icon-btn"
                  title={text('撤销笔迹', 'Undo stroke')}
                  aria-label={text('撤销笔迹', 'Undo stroke')}
                  disabled={!strokes.length || busy}
                  onClick={() => setStrokes(previous => previous.slice(0, -1))}
                >
                  <Undo2 size={15} />
                </button>
                <button
                  type="button"
                  className="sak-matting-icon-btn"
                  title={text('清除笔迹', 'Clear strokes')}
                  aria-label={text('清除笔迹', 'Clear strokes')}
                  disabled={!strokes.length || busy}
                  onClick={() => setStrokes([])}
                >
                  <RotateCcw size={15} />
                </button>
                {strokes.length > 0 && (
                  <span className="sak-matting-stroke-count" title={text('已绘制笔迹数量', 'Brush stroke count')}>
                    {strokes.length} {text('笔', 'strokes')}
                  </span>
                )}
              </div>

              <div className="sak-matting-divider" aria-hidden="true" />

              {/* 背景底纹切换与原图对比 */}
              <div className="sak-matting-backdrop-group" role="group" aria-label={text('预览底色', 'Preview backdrop')}>
                <button
                  type="button"
                  className="sak-matting-icon-btn"
                  aria-pressed={backdrop === 'checker'}
                  title={text('透明棋盘格底纹', 'Checkerboard backdrop')}
                  onClick={() => setBackdrop('checker')}
                >
                  <Grid size={14} />
                </button>
                <button
                  type="button"
                  className="sak-matting-icon-btn"
                  aria-pressed={backdrop === 'dark'}
                  title={text('深色高对比背景', 'Dark backdrop')}
                  onClick={() => setBackdrop('dark')}
                >
                  <Moon size={14} />
                </button>
                <button
                  type="button"
                  className="sak-matting-icon-btn"
                  aria-pressed={backdrop === 'light'}
                  title={text('浅色纯白背景', 'Light backdrop')}
                  onClick={() => setBackdrop('light')}
                >
                  <Sun size={14} />
                </button>
                <button
                  type="button"
                  className="sak-matting-compare-btn"
                  aria-pressed={compareOriginal}
                  disabled={!blob || busy}
                  title={text('切换查看原图与抠图效果对比', 'Toggle original vs matted preview')}
                  onClick={() => setCompareOriginal(prev => !prev)}
                >
                  <Eye size={14} />
                  <span>{compareOriginal ? text('正在看原图', 'Original') : text('对比原图', 'Compare')}</span>
                </button>
              </div>

              {/* 缩放控制 */}
              <div className="sak-matting-zoom">
                <button
                  type="button"
                  className="sak-matting-icon-btn"
                  aria-label={text('缩小', 'Zoom out')}
                  title={text('缩小', 'Zoom out')}
                  onClick={() => setZoom(value => Math.max(0.5, value - 0.25))}
                >
                  <ZoomOut size={15} />
                </button>
                <span
                  className="sak-matting-zoom-value"
                  onClick={() => setZoom(1)}
                  title={text('点击恢复 100% 缩放', 'Click to reset to 100%')}
                >
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  className="sak-matting-icon-btn"
                  aria-label={text('放大', 'Zoom in')}
                  title={text('放大', 'Zoom in')}
                  onClick={() => setZoom(value => Math.min(4, value + 0.25))}
                >
                  <ZoomIn size={15} />
                </button>
              </div>
            </div>

            {/* 画布预览舞台 */}
            <div className={`sak-matting-stage is-backdrop-${backdrop}`}>
              <div
                className="sak-matting-canvas"
                style={{ width: source.current ? `min(${zoom * 100}%, ${zoom * 60 * source.current.width / source.current.height}vh)` : undefined }}
              >
                <canvas
                  ref={canvas}
                  aria-label={text('图片预览', 'Image preview')}
                  onPointerDown={pointerDown}
                  onPointerMove={pointerMove}
                  onPointerUp={pointerUp}
                  onPointerCancel={pointerUp}
                  onPointerLeave={() => setCursor(undefined)}
                />
                {cursor && tool !== 'pick' && (
                  <span
                    className={`sak-matting-cursor is-${tool}`}
                    style={{
                      left: `${cursor.x}%`,
                      top: `${cursor.y}%`,
                      width: `${brushSize * 2 / dimensions.current.width * 100}%`
                    }}
                  />
                )}
              </div>
            </div>

            {/* 底部状态提示栏 */}
            <div className="sak-matting-stage-footer">
              <div className="sak-matting-hint">
                {tool === 'pick' ? (
                  <>
                    <Pipette size={13} />
                    <span>{text('点击画布任意背景区域即可吸取颜色并设为连通起点', 'Click any background pixel on canvas to pick color and set seed')}</span>
                  </>
                ) : tool === 'erase' ? (
                  <>
                    <Eraser size={13} />
                    <span>{text(`拖拽涂抹以擦除残留背景像素（当前笔刷半径 ${brushSize} px）`, `Drag on canvas to erase pixels (brush radius ${brushSize} px)`)}</span>
                  </>
                ) : (
                  <>
                    <Paintbrush size={13} />
                    <span>{text(`拖拽涂抹以恢复被误删的原图主体细节（当前笔刷半径 ${brushSize} px）`, `Drag on canvas to restore original pixels (brush radius ${brushSize} px)`)}</span>
                  </>
                )}
              </div>

              <div className="sak-matting-seed-status">
                <span className="sak-matting-color-chip">
                  <i style={{ backgroundColor: color }} />
                  <code>{color.toUpperCase()}</code>
                </span>
                <span>
                  {!colorMatting
                    ? text('仅画笔模式', 'Brush only')
                    : !contiguous
                    ? text('全局色彩匹配', 'Global match')
                    : seed
                    ? text(`起点 (${Math.round(seed.x)}, ${Math.round(seed.y)})`, `Seed (${Math.round(seed.x)}, ${Math.round(seed.y)})`)
                    : text('四周边缘连通', 'Edge flood-fill')}
                </span>
              </div>
            </div>
          </div>

          {/* 右侧参数控制栏 */}
          <div className="sak-matting-controls">
            {/* 卡片 1：颜色抠图参数 */}
            <div className={`sak-matting-card ${!colorMatting ? 'is-muted' : ''}`}>
              <div className="sak-matting-card-header">
                <label className="sak-matting-check sak-matting-primary-toggle">
                  <input
                    type="checkbox"
                    checked={colorMatting}
                    onChange={event => setColorMatting(event.target.checked)}
                  />
                  <Sparkles size={14} className="sak-matting-section-icon" />
                  <strong>{text('颜色抠图', 'Color matting')}</strong>
                </label>
              </div>

              <div className="sak-matting-card-body">
                <label className="sak-matting-color">
                  <span className="sak-matting-field-label">{text('背景颜色', 'Background color')}</span>
                  <div className="sak-matting-color-picker-wrap">
                    <code className="sak-matting-hex">{color.toUpperCase()}</code>
                    <input
                      type="color"
                      value={color}
                      disabled={!colorMatting}
                      onChange={event => {
                        setColor(event.target.value);
                        setSeed(undefined);
                      }}
                    />
                  </div>
                </label>

                {/* 快捷背景色预设 */}
                <div className="sak-matting-swatches" aria-label={text('常用背景色预设', 'Preset background colors')}>
                  {PRESET_COLORS.map(preset => (
                    <button
                      key={preset.hex}
                      type="button"
                      disabled={!colorMatting}
                      className={`sak-matting-swatch-btn ${color.toLowerCase() === preset.hex ? 'is-active' : ''}`}
                      title={text(`预设：${preset.zh} (${preset.hex})`, `Preset: ${preset.en} (${preset.hex})`)}
                      onClick={() => {
                        setColor(preset.hex);
                        setSeed(undefined);
                      }}
                    >
                      <i style={{ backgroundColor: preset.hex }} />
                      <span>{text(preset.zh, preset.en)}</span>
                    </button>
                  ))}
                </div>

                <label className="sak-matting-slider-field">
                  <div className="sak-matting-slider-header">
                    <span className="sak-matting-field-label">{text('容差', 'Tolerance')}</span>
                    <span className="sak-matting-value-badge">{tolerance}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={tolerance}
                    disabled={!colorMatting}
                    onChange={event => setTolerance(Number(event.target.value))}
                  />
                  <div className="sak-matting-slider-scale">
                    <small>{text('精准 (0)', 'Strict (0)')}</small>
                    <small>{text('宽泛 (100)', 'Wide (100)')}</small>
                  </div>
                </label>

                <label className="sak-matting-slider-field">
                  <div className="sak-matting-slider-header">
                    <span className="sak-matting-field-label">{text('羽化', 'Feather')}</span>
                    <span className="sak-matting-value-badge">{feather}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="5"
                    step="0.5"
                    value={feather}
                    disabled={!colorMatting}
                    onChange={event => setFeather(Number(event.target.value))}
                  />
                  <div className="sak-matting-slider-scale">
                    <small>{text('硬边缘 (0)', 'Sharp (0)')}</small>
                    <small>{text('柔和过渡 (5)', 'Soft (5)')}</small>
                  </div>
                </label>

                <label className="sak-matting-check sak-matting-subcheck">
                  <input
                    type="checkbox"
                    checked={contiguous}
                    disabled={!colorMatting}
                    onChange={event => setContiguous(event.target.checked)}
                  />
                  <span>{text('仅连通区域', 'Contiguous only')}</span>
                </label>

                {seed && (
                  <div className="sak-matting-seed-box">
                    <small>
                      {text(
                        `已锁定取色起点 (${Math.round(seed.x)}, ${Math.round(seed.y)})`,
                        `Seed locked at (${Math.round(seed.x)}, ${Math.round(seed.y)})`
                      )}
                    </small>
                    <button type="button" className="sak-matting-link" onClick={() => setSeed(undefined)}>
                      {text('使用边缘区域', 'Use edges')}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* 卡片 2：画笔精修参数 */}
            <div className="sak-matting-card">
              <div className="sak-matting-card-header">
                <div className="sak-matting-card-title">
                  <Sliders size={14} className="sak-matting-section-icon" />
                  <strong>{text('画笔手工精修', 'Brush Refinement')}</strong>
                </div>
              </div>

              <div className="sak-matting-card-body">
                <label className="sak-matting-slider-field">
                  <div className="sak-matting-slider-header">
                    <span className="sak-matting-field-label">{text('笔刷半径', 'Brush radius')}</span>
                    <span className="sak-matting-value-badge">{brushSize} px</span>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="256"
                    value={brushSize}
                    disabled={tool === 'pick'}
                    onChange={event => setBrushSize(Number(event.target.value))}
                  />
                </label>

                <div className="sak-matting-brush-presets">
                  {BRUSH_PRESETS.map(size => (
                    <button
                      key={size}
                      type="button"
                      disabled={!blob || busy}
                      className={`sak-matting-preset-pill ${brushSize === size && tool !== 'pick' ? 'is-active' : ''}`}
                      onClick={() => {
                        setBrushSize(size);
                        if (tool === 'pick') setTool('erase');
                      }}
                    >
                      {size}px
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {error && <p role="alert" className="sak-matting-error">{error}</p>}

            {/* 底部主操作区 */}
            <div className="sak-matting-footer-actions">
              <button
                type="button"
                className="sak-matting-cancel"
                disabled={busy}
                onClick={onClose}
              >
                {text('取消', 'Cancel')}
              </button>
              <button
                type="button"
                disabled={!blob || busy}
                onClick={() => void apply()}
                className="sak-matting-apply"
              >
                {busy ? text('处理中...', 'Processing...') : text('应用', 'Apply')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}