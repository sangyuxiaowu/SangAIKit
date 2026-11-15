import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';

test('generated utility rules are limited to assistant surfaces', async () => {
  const content = await readFile(new URL('../generated/sang-ai-utilities.css', import.meta.url), 'utf8');
  const stylesheet = postcss.parse(content);
  const unscoped: string[] = [];
  stylesheet.walkRules(rule => {
    let parent: { type: string; name?: string; parent?: typeof parent } | undefined = rule.parent;
    while (parent) {
      if (parent.type === 'atrule' && /keyframes$/i.test(parent.name || '')) return;
      parent = parent.parent;
    }
    for (const selector of rule.selectors) if (!selector.includes(':where(.cf-ai-panel, .sang-ai-settings, .sang-ai-portal)')) unscoped.push(selector);
  });
  expect(unscoped).toEqual([]);
  expect(content).not.toContain('--tw-');
  stylesheet.walkAtRules('layer', rule => {
    expect(rule.params.split(',').every(name => name.trim().startsWith('sang-ai-'))).toBe(true);
  });
  stylesheet.walkAtRules('keyframes', rule => { expect(rule.params.startsWith('sang-ai-')).toBe(true); });
});

test('typography utilities override unlayered host element resets', async () => {
  const stylesheet = postcss.parse(await readFile(new URL('../generated/sang-ai-utilities.css', import.meta.url), 'utf8'));
  const typographyRules: postcss.Rule[] = [];
  stylesheet.walkRules(rule => {
    if (rule.selectors.some(selector => selector.includes('.text-xs'))) typographyRules.push(rule);
  });
  expect(typographyRules.length).toBeGreaterThan(0);
  for (const rule of typographyRules) {
    let parent = rule.parent;
    while (parent && parent.type !== 'root') {
      expect(parent.type === 'atrule' && parent.name === 'layer').toBe(false);
      parent = parent.parent as typeof parent;
    }
  }
});