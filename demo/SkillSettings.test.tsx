// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import SkillSettings from '../src/SkillSettings';
import type { AiSkillConfig } from '../src/settingsTypes';

let cleanup = () => {};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup(persist: (skills: AiSkillConfig[]) => Promise<void> = async () => {}) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let skills: AiSkillConfig[] = [];
  const render = () => root.render(<SkillSettings skills={skills} english onChange={async next => { await persist(next); skills = next; render(); }} />);
  act(render);
  cleanup = () => { act(() => root.unmount()); container.remove(); };
  const click = async (text: string) => {
    const button = [...container.querySelectorAll('button')].find(item => item.textContent === text || item.getAttribute('aria-label') === text || item.title === text);
    expect(button).toBeTruthy();
    await act(async () => button!.click());
  };
  const fill = (labelText: string, value: string) => {
    const label = [...container.querySelectorAll('label')].find(item => item.textContent?.includes(labelText))!;
    const field = document.getElementById(label.htmlFor) as HTMLInputElement | HTMLTextAreaElement;
    act(() => {
      const prototype = field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  return { container, click, fill, skills: () => skills };
}

it('validates new skills before saving and preserves saved content when editing is cancelled', async () => {
  const view = setup();
  await view.click('New Skill');
  expect(view.skills()).toEqual([]);
  await view.click('Add Skill');
  expect(view.container.textContent).toContain('Skill name cannot be empty');
  view.fill('Skill Name', 'new-skill');
  await view.click('Add Skill');
  expect(view.container.textContent).toContain('Skill description must contain');
  view.fill('Trigger Context', 'Use for testing');
  await view.click('Add Skill');
  expect(view.container.textContent).toContain('Skill content must contain');
  view.fill('Full Skill Content', 'Keep original colors');
  view.fill('Skill Name', 'invalid--name');
  await view.click('Add Skill');
  expect(view.container.textContent).toContain('Skill name must use');
  expect(view.skills()).toEqual([]);
  view.fill('Skill Name', 'new-skill');
  await view.click('Add Skill');
  expect(view.skills()).toEqual([{ name: 'new-skill', description: 'Use for testing', content: 'Keep original colors' }]);
  await view.click('Edit');
  view.fill('Full Skill Content', 'Unsaved draft');
  await view.click('Cancel');
  expect(view.skills()[0].content).toBe('Keep original colors');
  await view.click('New Skill');
  view.fill('Skill Name', 'new-skill');
  await view.click('Add Skill');
  expect(view.container.textContent).toContain('already exists');
  expect(view.skills()).toHaveLength(1);
});

it('keeps the editor content until the skill has actually been persisted', async () => {
  let finishSave!: () => void;
  const pendingSave = new Promise<void>(resolve => { finishSave = resolve; });
  const persist = vi.fn(() => pendingSave);
  const view = setup(persist);
  await view.click('New Skill');
  view.fill('Skill Name', 'persisted-skill');
  view.fill('Trigger Context', 'Use for testing');
  view.fill('Full Skill Content', 'Do not lose this content');
  await view.click('Add Skill');
  expect(persist).toHaveBeenCalledOnce();
  expect(view.skills()).toEqual([]);
  expect(view.container.querySelector('textarea')?.value).toBe('Do not lose this content');
  expect([...view.container.querySelectorAll('button')].find(button => button.textContent === 'Saving...')?.disabled).toBe(true);
  await view.click('Saving...');
  expect(persist).toHaveBeenCalledOnce();
  await act(async () => { finishSave(); await pendingSave; });
  expect(view.container.querySelector('textarea')).toBeNull();
  expect(view.container.querySelector('[role="status"]')?.textContent).toBe('Saved');
  expect(view.skills()[0].content).toBe('Do not lose this content');
});

it('preserves the form on persistence failure and allows retrying', async () => {
  const persist = vi.fn<(skills: AiSkillConfig[]) => Promise<void>>()
    .mockRejectedValueOnce(new Error('Disk is full'))
    .mockResolvedValue(undefined);
  const view = setup(persist);
  await view.click('New Skill');
  view.fill('Skill Name', 'retry-skill');
  view.fill('Trigger Context', 'Use for testing');
  view.fill('Full Skill Content', 'Keep this draft');
  await view.click('Add Skill');
  expect(view.container.querySelector('[role="alert"]')?.textContent).toBe('Disk is full');
  expect(view.container.querySelector('textarea')?.value).toBe('Keep this draft');
  expect(view.skills()).toEqual([]);
  expect(view.container.querySelector('[role="status"]')).toBeNull();
  await view.click('Add Skill');
  expect(persist).toHaveBeenCalledTimes(2);
  expect(view.container.querySelector('textarea')).toBeNull();
  expect(view.skills()[0].content).toBe('Keep this draft');
});