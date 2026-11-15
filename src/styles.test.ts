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