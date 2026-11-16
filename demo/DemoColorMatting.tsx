import { useEffect, useState } from 'react';
import { Download, Scissors, Trash2, Upload } from 'lucide-react';
import { ColorMattingEditor } from '../src';
import './demo-color-matting.css';

export default function DemoColorMatting() {
  const [image, setImage] = useState<Blob>();
  const [result, setResult] = useState<Blob>();
  const [preview, setPreview] = useState('');
  const [editing, setEditing] = useState<Blob>();

  useEffect(() => {
    const displayed = result ?? image;
    if (!displayed) { setPreview(''); return; }
    const url = URL.createObjectURL(displayed);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image, result]);

  return <section className="demo-matting" aria-label="颜色抠图演示">
    <header><h2>颜色抠图</h2><div className="demo-matting-actions">
      <label className="demo-matting-upload"><Upload size={15} />选择图片<input type="file" accept="image/*" onChange={event => {
        const file = event.target.files?.[0];
        if (file) { setImage(file); setResult(undefined); setEditing(file); }
        event.target.value = '';
      }} /></label>
      <button type="button" disabled={!image} onClick={() => setEditing(result ?? image)}><Scissors size={15} />编辑</button>
      {result && <a href={preview} download="matting.png"><Download size={15} />下载 PNG</a>}
      {image && <button type="button" title="清除图片" aria-label="清除图片" onClick={() => { setImage(undefined); setResult(undefined); setEditing(undefined); }}><Trash2 size={15} /></button>}
    </div></header>
    {preview && <div className="demo-matting-preview"><img src={preview} alt={result ? '抠图结果' : '原图'} /></div>}
    {editing && <ColorMattingEditor image={editing} onApply={setResult} onClose={() => setEditing(undefined)} />}
  </section>;
}