import { useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, FileText, Hash, Search, X } from 'lucide-react';

const rawDocs = import.meta.glob('../docs/*.md', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>;

export interface DocChapter {
  id: string;
  fileName: string;
  order: string;
  title: string;
  summary: string;
  headings: string[];
  content: string;
}

function parseDocChapters(records: Record<string, string>): DocChapter[] {
  return Object.entries(records)
    .sort(([pathA], [pathB]) => pathA.localeCompare(pathB, 'en'))
    .map(([filePath, rawContent], idx) => {
      const fileName = filePath.split('/').pop() || `chapter-${idx + 1}.md`;
      const id = fileName.replace(/\.md$/i, '');
      const orderMatch = /^(\d+)/.exec(fileName);
      const order = orderMatch ? orderMatch[1].padStart(2, '0') : String(idx + 1).padStart(2, '0');
      const lines = rawContent.split(/\r?\n/);
      const titleLine = lines.find(line => line.startsWith('# ')) || `# ${id}`;
      const rawTitle = titleLine.replace(/^#\s+/, '').replace(/^\d+\.\s*/, '').trim();
      const summaryLine =
        lines.find(line => {
          const trimmed = line.trim();
          return (
            trimmed.length > 0 &&
            !trimmed.startsWith('#') &&
            !trimmed.startsWith('---') &&
            !trimmed.startsWith('|') &&
            !trimmed.startsWith('>') &&
            !trimmed.startsWith('-') &&
            !trimmed.startsWith('```')
          );
        }) || '';
      const summary = summaryLine.replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').trim();
      const headings = lines
        .filter(line => line.startsWith('## '))
        .map(line => line.replace(/^##\s+/, '').trim());

      return {
        id,
        fileName: `docs/${fileName}`,
        order,
        title: rawTitle,
        summary,
        headings,
        content: rawContent
      };
    });
}

export const DOC_CHAPTERS: readonly DocChapter[] = parseDocChapters(rawDocs);

interface DemoDocsViewProps {
  activeChapterId?: string;
  onSelectChapter?: (id: string) => void;
  onBackToWorkspace: () => void;
}

export default function DemoDocsView({
  activeChapterId,
  onSelectChapter,
  onBackToWorkspace
}: DemoDocsViewProps) {
  const [internalId, setInternalId] = useState<string>(() => DOC_CHAPTERS[0]?.id || '');
  const [query, setQuery] = useState('');

  const selectedId = activeChapterId ?? internalId;
  const selectChapter = (id: string) => {
    setInternalId(id);
    onSelectChapter?.(id);
  };

  const filteredChapters = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return DOC_CHAPTERS;
    return DOC_CHAPTERS.filter(
      chapter =>
        chapter.title.toLowerCase().includes(keyword) ||
        chapter.content.toLowerCase().includes(keyword) ||
        chapter.fileName.toLowerCase().includes(keyword)
    );
  }, [query]);

  const currentChapter =
    filteredChapters.find(item => item.id === selectedId) ||
    DOC_CHAPTERS.find(item => item.id === selectedId) ||
    filteredChapters[0] ||
    DOC_CHAPTERS[0];

  const currentIndex = DOC_CHAPTERS.findIndex(item => item.id === currentChapter?.id);
  const prevChapter = currentIndex > 0 ? DOC_CHAPTERS[currentIndex - 1] : null;
  const nextChapter =
    currentIndex >= 0 && currentIndex < DOC_CHAPTERS.length - 1 ? DOC_CHAPTERS[currentIndex + 1] : null;

  const renderedHtml = useMemo(() => {
    if (!currentChapter) return '';
    return DOMPurify.sanitize(marked.parse(currentChapter.content, { async: false }) as string);
  }, [currentChapter]);

  return (
    <div className="demo-docs" aria-label="帮助文档中心">
      <div className="demo-content-heading">
        <div>
          <span className="demo-eyebrow">DOCUMENTATION / DOCS DIRECTORY</span>
          <h1>SangAIKit 帮助与接入文档</h1>
        </div>
        <div className="demo-docs-header-actions">
          <span className="demo-docs-count">共 {DOC_CHAPTERS.length} 个独立章节文档 (`docs/*.md`)</span>
          <button type="button" className="demo-reset" onClick={onBackToWorkspace}>
            <ArrowLeft size={13} /> 返回演示工作台
          </button>
        </div>
      </div>

      <div className="demo-docs-layout">
        {/* 左侧章节导航与搜索 */}
        <aside className="demo-docs-sidebar" aria-label="文档章节目录">
          <div className="demo-docs-search">
            <Search size={14} className="demo-docs-search-icon" />
            <input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="搜索章节、API 或配置项..."
              aria-label="搜索帮助文档"
            />
            {query && (
              <button
                type="button"
                className="demo-docs-search-clear"
                onClick={() => setQuery('')}
                aria-label="清空搜索"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <nav className="demo-docs-nav" aria-label="章节列表">
            {filteredChapters.map(chapter => {
              const active = chapter.id === currentChapter?.id;
              return (
                <button
                  key={chapter.id}
                  type="button"
                  className={`demo-docs-chapter-btn ${active ? 'active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => selectChapter(chapter.id)}
                >
                  <div className="demo-docs-chapter-top">
                    <span className="demo-docs-chapter-num">{chapter.order}.</span>
                    <strong className="demo-docs-chapter-title">{chapter.title}</strong>
                  </div>
                  <span className="demo-docs-chapter-file">
                    <FileText size={11} />
                    {chapter.fileName}
                  </span>
                  {active && chapter.headings.length > 0 && (
                    <ul className="demo-docs-outline" aria-label="本节提纲">
                      {chapter.headings.map(heading => (
                        <li key={heading}>
                          <Hash size={10} />
                          <span>{heading}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </button>
              );
            })}
            {filteredChapters.length === 0 && (
              <p className="demo-docs-empty">未找到匹配“{query}”的文档章节。</p>
            )}
          </nav>
        </aside>

        {/* 右侧文档正文阅读区 */}
        {currentChapter && (
          <article className="demo-docs-article">
            <header className="demo-docs-article-bar">
              <div className="demo-docs-article-meta">
                <BookOpen size={14} />
                <span>章节 {currentChapter.order} / {String(DOC_CHAPTERS.length).padStart(2, '0')}</span>
                <span aria-hidden="true">·</span>
                <code>{currentChapter.fileName}</code>
              </div>
              {currentChapter.summary && (
                <p className="demo-docs-article-summary">{currentChapter.summary}</p>
              )}
            </header>

            <div
              className="demo-docs-markdown"
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />

            <footer className="demo-docs-footer">
              {prevChapter ? (
                <button
                  type="button"
                  className="demo-docs-pager prev"
                  onClick={() => selectChapter(prevChapter.id)}
                >
                  <ChevronLeft size={16} />
                  <div>
                    <small>上一章 · {prevChapter.order}</small>
                    <strong>{prevChapter.title}</strong>
                  </div>
                </button>
              ) : <div />}

              {nextChapter ? (
                <button
                  type="button"
                  className="demo-docs-pager next"
                  onClick={() => selectChapter(nextChapter.id)}
                >
                  <div>
                    <small>下一章 · {nextChapter.order}</small>
                    <strong>{nextChapter.title}</strong>
                  </div>
                  <ChevronRight size={16} />
                </button>
              ) : <div />}
            </footer>
          </article>
        )}
      </div>
    </div>
  );
}
