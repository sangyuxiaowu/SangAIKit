import { useEffect, useState } from 'react';
import { Download, Image as ImageIcon, Scissors, Sparkles, Trash2, Upload } from 'lucide-react';
import { ColorMattingEditor } from '../src';
import './demo-color-matting.css';

type DemoSampleId = 'badge' | 'greenscreen' | 'darkcard';

async function createSampleMattingBlob(kind: DemoSampleId): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 420;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new Blob([], { type: 'image/png' });

  if (kind === 'badge') {
    // 纯白背景 + 几何渐变主体徽章
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 640, 420);

    const grad = ctx.createLinearGradient(180, 70, 460, 350);
    grad.addColorStop(0, '#4f6ef7');
    grad.addColorStop(0.55, '#7c3aed');
    grad.addColorStop(1, '#06b6d4');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(320, 210, 130, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(320, 210, 48, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SANG AI', 320, 382);
  } else if (kind === 'greenscreen') {
    // 绿幕背景 + 暖色立体卡片
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(0, 0, 640, 420);

    const grad = ctx.createLinearGradient(170, 80, 470, 340);
    grad.addColorStop(0, '#f59e0b');
    grad.addColorStop(1, '#ef4444');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(170, 80, 300, 260, 32);
    ctx.fill();

    ctx.fillStyle = '#fffbeb';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('STUDIO PRO', 320, 205);
    ctx.font = '16px sans-serif';
    ctx.fillText('Chroma Key Matting Sample', 320, 242);
  } else {
    // 纯黑背景 + 青翠发光多边形
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 640, 420);

    const grad = ctx.createLinearGradient(200, 70, 440, 350);
    grad.addColorStop(0, '#10b981');
    grad.addColorStop(1, '#3b82f6');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(320, 64);
    ctx.lineTo(468, 168);
    ctx.lineTo(412, 344);
    ctx.lineTo(228, 344);
    ctx.lineTo(172, 168);
    ctx.closePath();
    ctx.fill();
  }

  return await new Promise<Blob>(resolve => {
    canvas.toBlob(blob => resolve(blob || new Blob([], { type: 'image/png' })), 'image/png');
  });
}

export default function DemoColorMatting() {
  const [image, setImage] = useState<Blob>();
  const [result, setResult] = useState<Blob>();
  const [preview, setPreview] = useState('');
  const [editing, setEditing] = useState<Blob>();
  const [sampleLoading, setSampleLoading] = useState(false);

  useEffect(() => {
    const displayed = result ?? image;
    if (!displayed) { setPreview(''); return; }
    const url = URL.createObjectURL(displayed);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image, result]);

  const handleLoadSample = async (kind: DemoSampleId, openEditor = true) => {
    setSampleLoading(true);
    try {
      const blob = await createSampleMattingBlob(kind);
      setImage(blob);
      setResult(undefined);
      if (openEditor) setEditing(blob);
    } finally {
      setSampleLoading(false);
    }
  };

  return (
    <section className="demo-matting" aria-label="颜色抠图演示">
      <header className="demo-matting-header">
        <div className="demo-matting-title-group">
          <span className="demo-section-kicker">INTERACTIVE COLOR MATTING & BRUSH REFINEMENT</span>
          <div className="demo-matting-title-row">
            <h2>颜色抠图与画笔精修工作台</h2>
            <span className="demo-matting-tag">ColorMattingEditor</span>
          </div>
          <p className="demo-matting-desc">
            支持背景取色、色彩容差、边缘羽化、四周/起点连通区域过滤及橡皮擦/恢复画笔精修。可上传本地图片或直接点击下方示例一键唤醒背景移除弹窗。
          </p>
        </div>

        <div className="demo-matting-actions">
          <label className="demo-matting-upload">
            <Upload size={14} />
            <span>选择图片</span>
            <input
              type="file"
              accept="image/*"
              onChange={event => {
                const file = event.target.files?.[0];
                if (file) {
                  setImage(file);
                  setResult(undefined);
                  setEditing(file);
                }
                event.target.value = '';
              }}
            />
          </label>
          <button
            type="button"
            className="demo-matting-primary-btn"
            disabled={!image}
            onClick={() => setEditing(result ?? image)}
          >
            <Scissors size={14} />
            <span>编辑</span>
          </button>
          {result && (
            <a href={preview} download="matting.png" className="demo-matting-download-btn">
              <Download size={14} />
              <span>下载 PNG</span>
            </a>
          )}
          {image && (
            <button
              type="button"
              className="demo-matting-clear-btn"
              title="清除图片"
              aria-label="清除图片"
              onClick={() => {
                setImage(undefined);
                setResult(undefined);
                setEditing(undefined);
              }}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </header>

      {/* 快速示例图片体验栏 */}
      <div className="demo-matting-samples">
        <span className="demo-matting-samples-label">
          <Sparkles size={13} />
          <span>快速体验示例图（点击生成并打开抠图弹窗）：</span>
        </span>
        <div className="demo-matting-sample-btns">
          <button
            type="button"
            disabled={sampleLoading}
            onClick={() => void handleLoadSample('badge', true)}
          >
            <ImageIcon size={13} />
            <span>纯白底徽章（含内部镂空测试）</span>
          </button>
          <button
            type="button"
            disabled={sampleLoading}
            onClick={() => void handleLoadSample('greenscreen', true)}
          >
            <ImageIcon size={13} />
            <span>绿幕主体卡片（#00FF00 抠除）</span>
          </button>
          <button
            type="button"
            disabled={sampleLoading}
            onClick={() => void handleLoadSample('darkcard', true)}
          >
            <ImageIcon size={13} />
            <span>纯黑底多边形（深色背景抠除）</span>
          </button>
        </div>
      </div>

      {preview && (
        <div className="demo-matting-preview">
          <div className="demo-matting-preview-badge">
            {result ? '✓ 已应用抠图结果（透明 PNG）' : '原图已加载（点击“编辑”进入抠图弹窗）'}
          </div>
          <img src={preview} alt={result ? '抠图结果' : '原图'} />
        </div>
      )}

      {editing && (
        <ColorMattingEditor
          image={editing}
          onApply={setResult}
          onClose={() => setEditing(undefined)}
        />
      )}
    </section>
  );
}