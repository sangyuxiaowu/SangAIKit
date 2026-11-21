import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Search, Wrench, X } from 'lucide-react';
import {
  resolveToolGroup,
  resolveToolLabel,
  resolveToolUiDescription,
  type ToolDescriptor
} from './toolRegistry';

export interface SessionToolTreeProps {
  /** Unified list of host and built-in tool descriptors */
  tools: readonly ToolDescriptor[];
  /** Currently enabled tool names */
  selectedNames: ReadonlySet<string>;
  /** Called with the updated list of enabled tool names */
  onChange: (nextToolNames: string[]) => void;
  english?: boolean;
  toolLabels?: Record<string, [string, string]>;
  onClose?: () => void;
  title?: string;
  searchPlaceholder?: string;
  className?: string;
}

interface TreeGroupNode {
  group: string;
  items: Array<{
    tool: ToolDescriptor;
    label: string;
    uiDescription: string;
  }>;
}

function GroupCheckbox({
  checked,
  indeterminate,
  ariaLabel,
  onChange
}: {
  checked: boolean;
  indeterminate: boolean;
  ariaLabel: string;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      aria-label={ariaLabel}
      onChange={onChange}
    />
  );
}

export default function SessionToolTree({
  tools,
  selectedNames,
  onChange,
  english = false,
  toolLabels,
  onClose,
  title,
  searchPlaceholder,
  className = ''
}: SessionToolTreeProps) {
  const [query, setQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const label = (zh: string, en: string) => (english ? en : zh);
  const normalizedQuery = query.trim().toLowerCase();

  const grouped = useMemo<TreeGroupNode[]>(() => {
    const groups = new Map<string, TreeGroupNode>();
    for (const tool of tools) {
      const groupName = resolveToolGroup(tool, english);
      const displayLabel = resolveToolLabel(tool, english, toolLabels);
      const uiDescription = resolveToolUiDescription(tool, english);

      if (normalizedQuery) {
        const haystack = `${displayLabel} ${tool.name} ${groupName} ${uiDescription}`.toLowerCase();
        if (!haystack.includes(normalizedQuery)) continue;
      }

      let bucket = groups.get(groupName);
      if (!bucket) {
        bucket = { group: groupName, items: [] };
        groups.set(groupName, bucket);
      }
      bucket.items.push({ tool, label: displayLabel, uiDescription });
    }
    return Array.from(groups.values());
  }, [tools, english, toolLabels, normalizedQuery]);

  const toggleTool = (toolName: string) => {
    const next = new Set(selectedNames);
    if (next.has(toolName)) next.delete(toolName);
    else next.add(toolName);
    onChange(Array.from(next));
  };

  const toggleGroup = (node: TreeGroupNode) => {
    const next = new Set(selectedNames);
    const allSelected = node.items.every(item => next.has(item.tool.name));
    for (const item of node.items) {
      if (allSelected) next.delete(item.tool.name);
      else next.add(item.tool.name);
    }
    onChange(Array.from(next));
  };

  const toggleCollapse = (groupName: string) => {
    setCollapsedGroups(prev => ({ ...prev, [groupName]: !prev[groupName] }));
  };

  const visibleToolNames = useMemo(
    () => grouped.flatMap(node => node.items.map(item => item.tool.name)),
    [grouped]
  );

  const selectAllVisible = () => {
    if (!normalizedQuery) {
      onChange(tools.map(tool => tool.name));
      return;
    }
    const next = new Set(selectedNames);
    for (const name of visibleToolNames) next.add(name);
    onChange(Array.from(next));
  };

  const clearVisible = () => {
    if (!normalizedQuery) {
      onChange([]);
      return;
    }
    const next = new Set(selectedNames);
    for (const name of visibleToolNames) next.delete(name);
    onChange(Array.from(next));
  };

  return (
    <section
      className={`cf-ai-session-tools-panel ${className}`.trim()}
      aria-label={label('本会话可用工具设置', 'Session tools selector')}
    >
      <div className="cf-ai-session-tools-header">
        <div className="cf-ai-session-tools-title">
          <Wrench size={13} />
          <strong>{title || label('本会话可用工具', 'Session Tools')}</strong>
          <span>{selectedNames.size}/{tools.length}</span>
        </div>
        <div className="cf-ai-session-tools-actions">
          <button
            type="button"
            className="cf-ai-session-tools-link"
            onClick={selectAllVisible}
          >
            {label('全选', 'All')}
          </button>
          <button
            type="button"
            className="cf-ai-session-tools-link"
            onClick={clearVisible}
          >
            {label('清空', 'None')}
          </button>
          {onClose && (
            <button
              type="button"
              className="cf-ai-icon"
              onClick={onClose}
              aria-label={label('关闭工具面板', 'Close tools panel')}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="cf-ai-tool-tree-search">
        <Search size={13} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={searchPlaceholder || label('搜索工具名称、分组或介绍…', 'Search tools, groups, or descriptions...')}
          aria-label={label('搜索可用工具', 'Search available tools')}
        />
        {query && (
          <button
            type="button"
            className="cf-ai-tool-tree-search-clear"
            onClick={() => setQuery('')}
            aria-label={label('清空搜索', 'Clear search')}
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div className="cf-ai-tool-tree" role="tree" aria-label={label('工具分组树', 'Tool groups tree')}>
        {grouped.length === 0 ? (
          <div className="cf-ai-tool-tree-empty">
            <span>{label('未找到匹配的工具', 'No matching tools')}</span>
            {query && (
              <button type="button" className="cf-ai-session-tools-link" onClick={() => setQuery('')}>
                {label('重置搜索', 'Reset')}
              </button>
            )}
          </div>
        ) : (
          grouped.map(node => {
            const totalInGroup = node.items.length;
            const selectedInGroup = node.items.filter(item => selectedNames.has(item.tool.name)).length;
            const allChecked = totalInGroup > 0 && selectedInGroup === totalInGroup;
            const indeterminate = selectedInGroup > 0 && selectedInGroup < totalInGroup;
            const expanded = normalizedQuery ? true : !collapsedGroups[node.group];

            return (
              <div
                key={node.group}
                className="cf-ai-tool-tree-group"
                role="treeitem"
                aria-expanded={expanded}
              >
                <div className="cf-ai-tool-tree-group-row">
                  <button
                    type="button"
                    className="cf-ai-tool-tree-toggle"
                    onClick={() => toggleCollapse(node.group)}
                    aria-label={
                      expanded
                        ? label(`收起分组 ${node.group}`, `Collapse group ${node.group}`)
                        : label(`展开分组 ${node.group}`, `Expand group ${node.group}`)
                    }
                  >
                    {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                  <label className="cf-ai-tool-tree-group-check">
                    <GroupCheckbox
                      checked={allChecked}
                      indeterminate={indeterminate}
                      ariaLabel={label(`切换分组 ${node.group}`, `Toggle group ${node.group}`)}
                      onChange={() => toggleGroup(node)}
                    />
                    <span className="cf-ai-tool-tree-group-name">{node.group}</span>
                  </label>
                  <span className="cf-ai-tool-tree-group-count">
                    {selectedInGroup}/{totalInGroup}
                  </span>
                </div>

                {expanded && (
                  <div className="cf-ai-tool-tree-children" role="group">
                    {node.items.map(({ tool, label: displayLabel, uiDescription }) => {
                      const checked = selectedNames.has(tool.name);
                      return (
                        <label
                          key={tool.name}
                          className={`cf-ai-tool-tree-item ${checked ? 'is-enabled' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleTool(tool.name)}
                          />
                          <span className="cf-ai-tool-tree-item-body">
                            <span className="cf-ai-tool-tree-item-head">
                              <strong>{displayLabel}</strong>
                              <span className={`cf-ai-tool-tree-source is-${tool.source}`}>
                                {tool.source === 'builtin' ? label('内置', 'Built-in') : label('业务', 'Host')}
                              </span>
                              <code>{tool.name}</code>
                            </span>
                            {uiDescription && (
                              <small className="cf-ai-tool-tree-item-desc">{uiDescription}</small>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
