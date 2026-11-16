import { expect, it } from 'vitest';
import { buildThemeStyleVariables, getPaletteById } from './palettes';

it('chooses readable text and hover colors for custom accents', () => {
  const palette = getPaletteById('default');
  const light = buildThemeStyleVariables(palette, 'light', '#ffffff') as Record<string, string>;
  const dark = buildThemeStyleVariables(palette, 'dark', '#000000') as Record<string, string>;
  const mid = buildThemeStyleVariables(palette, 'light', '#777777') as Record<string, string>;

  expect(light['--sang-ai-accent-text']).toBe('#000000');
  expect(light['--demo-primary-text']).toBe('#000000');
  expect(dark['--sang-ai-accent-text']).toBe('#ffffff');
  expect(mid['--sang-ai-accent-text']).toBe('#000000');
  expect(mid['--sang-ai-accent-hover']).toContain('#ffffff');
  expect(dark['--sang-ai-accent-hover']).toContain('#000000');
});

it('preserves the amber palette contrast color', () => {
  const styles = buildThemeStyleVariables(getPaletteById('amber'), 'dark') as Record<string, string>;
  expect(styles['--sang-ai-accent-text']).toBe('#1c1204');
});