import { expect, test } from 'bun:test';
import { applyBrushStrokes, applyColorMatting } from './colorMatting';

test('color matting removes connected matches without modifying the source', () => {
  const original = globalThis.ImageData;
  globalThis.ImageData = class {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  } as typeof ImageData;
  try {
    const pixels = new Uint8ClampedArray([
      255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255,
      0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255,
      255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255
    ]);
    const image = new ImageData(pixels, 3, 3);
    const options = { targetColor: [255, 255, 255] as [number, number, number], tolerance: 0, feather: 0, contiguous: true };
    const connected = applyColorMatting(image, options);
    expect(connected.data[3]).toBe(0);
    expect(connected.data[19]).toBe(255);
    expect(image.data[3]).toBe(255);
    expect(applyColorMatting(image, { ...options, contiguous: false }).data[19]).toBe(0);
    expect(applyColorMatting(image, { ...options, startX: 1, startY: 1 }).data[19]).toBe(0);
    expect(applyColorMatting(image, { ...options, feather: 2 }).data[7]).toBe(128);
  } finally { globalThis.ImageData = original; }
});

test('brush strokes erase continuously and restore the original RGBA in order', () => {
  const original = globalThis.ImageData;
  globalThis.ImageData = class {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  } as typeof ImageData;
  try {
    const pixels = new Uint8ClampedArray(7 * 3 * 4).fill(255);
    pixels[(1 * 7 + 3) * 4 + 3] = 120;
    const source = new ImageData(pixels, 7, 3);
    const result = new ImageData(new Uint8ClampedArray(pixels), 7, 3);
    applyBrushStrokes(result, source, [
      { mode: 'erase', radius: 0.6, points: [{ x: 0, y: 1 }, { x: 6, y: 1 }] },
      { mode: 'restore', radius: 0.6, points: [{ x: 3, y: 1 }] }
    ]);
    expect(Array.from({ length: 7 }, (_, x) => result.data[(7 + x) * 4 + 3])).toEqual([0, 0, 0, 120, 0, 0, 0]);
    expect(source.data[(7 + 2) * 4 + 3]).toBe(255);
    expect(result.data[3]).toBe(255);
  } finally { globalThis.ImageData = original; }
});