import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Eraser, Paintbrush, Pipette, RotateCcw, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react';
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
    const scaleX = original.width / dimensions.current.width;
    const scaleY = original.height / dimensions.current.height;
    const options = { targetColor, tolerance, feather: feather * scaleX, contiguous,
      ...(seed ? { startX: Math.min(original.width - 1, Math.floor(seed.x * scaleX)), startY: Math.min(original.height - 1, Math.floor(seed.y * scaleY)) } : {}) };
    const result = colorMatting ? applyColorMatting(original, options) : new ImageData(new Uint8ClampedArray(original.data), original.width, original.height);
    applyBrushStrokes(result, original, strokes.map(previewStroke));
    working.current = result;
    canvas.current.getContext('2d')?.putImageData(result, 0, 0);
  }, [blob, color, tolerance, feather, contiguous, colorMatting, seed, strokes]);

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

  const toolButton = (value: Tool, label: string, Icon: typeof Pipette) => <button type="button" title={label} aria-label={label}
    aria-pressed={tool === value} onClick={() => setTool(value)} disabled={!blob || busy}><Icon size={16} /></button>;

  return <div className="sak-matting-overlay" role="dialog" aria-modal="true" aria-label={text('颜色抠图', 'Color matting')}>
    <div className="sak-matting">
      <header className="sak-matting-header"><h2>{text('颜色抠图', 'Color matting')}</h2>
        <button type="button" onClick={onClose} aria-label={text('关闭', 'Close')} title={text('关闭', 'Close')}><X size={18} /></button></header>
      <div className="sak-matting-body">
        <div className="sak-matting-workspace">
          <div className="sak-matting-toolbar">
            <div className="sak-matting-tools" role="group" aria-label={text('工具', 'Tools')}>
              {toolButton('pick', text('取色', 'Pick color'), Pipette)}
              {toolButton('erase', text('擦除', 'Erase'), Eraser)}
              {toolButton('restore', text('恢复原图', 'Restore original'), Paintbrush)}
            </div>
            <button type="button" title={text('撤销笔迹', 'Undo stroke')} aria-label={text('撤销笔迹', 'Undo stroke')} disabled={!strokes.length || busy} onClick={() => setStrokes(previous => previous.slice(0, -1))}><Undo2 size={16} /></button>
            <button type="button" title={text('清除笔迹', 'Clear strokes')} aria-label={text('清除笔迹', 'Clear strokes')} disabled={!strokes.length || busy} onClick={() => setStrokes([])}><RotateCcw size={16} /></button>
            <div className="sak-matting-zoom">
              <button type="button" aria-label={text('缩小', 'Zoom out')} title={text('缩小', 'Zoom out')} onClick={() => setZoom(value => Math.max(0.5, value - 0.25))}><ZoomOut size={16} /></button>
              <span>{Math.round(zoom * 100)}%</span>
              <button type="button" aria-label={text('放大', 'Zoom in')} title={text('放大', 'Zoom in')} onClick={() => setZoom(value => Math.min(4, value + 0.25))}><ZoomIn size={16} /></button>
            </div>
          </div>
          <div className="sak-matting-stage">
            <div className="sak-matting-canvas" style={{ width: source.current ? `min(${zoom * 100}%, ${zoom * 60 * source.current.width / source.current.height}vh)` : undefined }}>
              <canvas ref={canvas} aria-label={text('图片预览', 'Image preview')}
                onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onPointerLeave={() => setCursor(undefined)} />
              {cursor && tool !== 'pick' && <span className="sak-matting-cursor" style={{ left: `${cursor.x}%`, top: `${cursor.y}%`, width: `${brushSize * 2 / dimensions.current.width * 100}%` }} />}
            </div>
          </div>
        </div>
        <div className="sak-matting-controls">
          <label className="sak-matting-check"><input type="checkbox" checked={colorMatting} onChange={event => setColorMatting(event.target.checked)} />{text('颜色抠图', 'Color matting')}</label>
          <label className="sak-matting-color">{text('背景颜色', 'Background color')}<input type="color" value={color} disabled={!colorMatting} onChange={event => { setColor(event.target.value); setSeed(undefined); }} /></label>
          <label>{text('容差', 'Tolerance')} <span>{tolerance}</span><input type="range" min="0" max="100" value={tolerance} disabled={!colorMatting} onChange={event => setTolerance(Number(event.target.value))} /></label>
          <label>{text('羽化', 'Feather')} <span>{feather}</span><input type="range" min="0" max="5" step="0.5" value={feather} disabled={!colorMatting} onChange={event => setFeather(Number(event.target.value))} /></label>
          <label className="sak-matting-check"><input type="checkbox" checked={contiguous} disabled={!colorMatting} onChange={event => setContiguous(event.target.checked)} />{text('仅连通区域', 'Contiguous only')}</label>
          {seed && <button type="button" className="sak-matting-link" onClick={() => setSeed(undefined)}>{text('使用边缘区域', 'Use edges')}</button>}
          <label>{text('笔刷半径', 'Brush radius')} <span>{brushSize} px</span><input type="range" min="2" max="256" value={brushSize} disabled={tool === 'pick'} onChange={event => setBrushSize(Number(event.target.value))} /></label>
          {error && <p role="alert" className="sak-matting-error">{error}</p>}
          <button type="button" disabled={!blob || busy} onClick={() => void apply()} className="sak-matting-apply">{busy ? text('处理中...', 'Processing...') : text('应用', 'Apply')}</button>
        </div>
      </div>
    </div>
  </div>;
}