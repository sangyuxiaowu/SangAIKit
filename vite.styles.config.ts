import { defineConfig, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import postcss from 'postcss';

const scope = ':where(.cf-ai-panel, .sang-ai-settings, .sang-ai-portal)';
type Ancestor = { type: string; name?: string; parent?: Ancestor };

function scopeComponentStyles(): Plugin {
  return {
    name: 'scope-component-styles',
    generateBundle: { order: 'post', handler(_options, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== 'asset' || !asset.fileName.endsWith('.css')) continue;
        const stylesheet = postcss.parse(String(asset.source));
        const animations = new Map<string, string>();
        stylesheet.walkAtRules('keyframes', rule => {
          const original = rule.params.trim();
          if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(original)) return;
          const renamed = `sang-ai-${original}`;
          animations.set(original, renamed);
          rule.params = renamed;
        });
        stylesheet.walkDecls(declaration => {
          if (!declaration.prop.startsWith('--animate-') && !declaration.prop.startsWith('animation')) return;
          for (const [original, renamed] of animations) declaration.value = declaration.value.replace(new RegExp(`(^|[^a-zA-Z0-9_-])${original}(?=$|[^a-zA-Z0-9_-])`, 'g'), `$1${renamed}`);
        });
        stylesheet.walkAtRules('layer', rule => {
          rule.params = rule.params.split(',').map(name => `sang-ai-${name.trim()}`).join(', ');
        });
        stylesheet.walkRules(rule => {
          let parent: Ancestor | undefined = rule.parent;
          while (parent) {
            if (parent.type === 'atrule' && /keyframes$/i.test(parent.name || '')) return;
            parent = parent.parent;
          }
          rule.selectors = rule.selectors.flatMap(selector => {
            if (selector === ':root' || selector === ':host') return [scope];
            return selector.startsWith('.') ? [`${scope} ${selector}`, `${scope}${selector}`] : [`${scope} ${selector}`];
          });
        });
        asset.source = stylesheet.toString().replaceAll('--tw-', '--sang-ai-tw-');
        asset.fileName = 'sang-ai-utilities.css';
      }
      for (const [name, asset] of Object.entries(bundle)) {
        if (asset.type === 'chunk') delete bundle[name];
      }
    } }
  };
}

export default defineConfig({
  plugins: [tailwindcss(), scopeComponentStyles()],
  build: {
    outDir: 'generated',
    emptyOutDir: true,
    cssMinify: false,
    lib: { entry: 'style-build/entry.ts', formats: ['es'], fileName: 'style-entry' }
  }
});