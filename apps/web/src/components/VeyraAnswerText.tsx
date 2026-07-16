import { useMemo, type ReactNode } from 'react';

// A small, dependency-free renderer for Veyra's assistant answers. Model
// output regularly contains basic markdown (bold, numbered/bulleted lists,
// paragraphs, links) — this turns that into real React elements instead of
// showing raw "**"/"1."/"-" characters, without ever touching
// dangerouslySetInnerHTML or any HTML string parsing: every node below is
// built directly from plain-text segments, so there is no injection surface
// at all. Deliberately supports only this narrow, common subset — not a
// general-purpose markdown/CommonMark implementation.

type Block = { type: 'paragraph'; lines: string[] } | { type: 'ol' | 'ul'; items: string[] };

const NUMBERED_LIST_ITEM = /^(\d+)[.)]\s+(.*)$/;
const BULLET_LIST_ITEM = /^[-*•]\s+(.*)$/;
const INLINE_PATTERN = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { type: 'ol' | 'ul'; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', lines: paragraph });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push(list);
      list = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed === '') {
      flushParagraph();
      flushList();
      continue;
    }

    const numbered = NUMBERED_LIST_ITEM.exec(trimmed);
    if (numbered) {
      flushParagraph();
      if (!list || list.type !== 'ol') {
        flushList();
        list = { type: 'ol', items: [] };
      }
      list.items.push(numbered[2]);
      continue;
    }

    const bulleted = BULLET_LIST_ITEM.exec(trimmed);
    if (bulleted) {
      flushParagraph();
      if (!list || list.type !== 'ul') {
        flushList();
        list = { type: 'ul', items: [] };
      }
      list.items.push(bulleted[1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** Splits a single line into text/bold/link segments — never returns raw markdown syntax. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let index = 0;
  INLINE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    if (match[1] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-b-${index++}`}>{match[1]}</strong>);
    } else if (match[2] !== undefined && match[3] !== undefined) {
      nodes.push(
        <a
          key={`${keyPrefix}-l-${index++}`}
          href={match[3]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:opacity-80"
        >
          {match[2]}
        </a>
      );
    }
    lastIndex = INLINE_PATTERN.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

/** Renders a Veyra assistant answer with basic markdown (bold/lists/links) turned into real elements. Plain-text answers render exactly as before. */
export default function VeyraAnswerText({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseBlocks(text || ''), [text]);

  return (
    <div className={className}>
      {blocks.map((block, blockIndex) => {
        if (block.type === 'paragraph') {
          return (
            <p key={`p-${blockIndex}`} className={blockIndex > 0 ? 'mt-2' : undefined}>
              {block.lines.map((line, lineIndex) => (
                <span key={lineIndex}>
                  {renderInline(line, `p-${blockIndex}-${lineIndex}`)}
                  {lineIndex < block.lines.length - 1 && <br />}
                </span>
              ))}
            </p>
          );
        }
        const items = block.items.map((item, itemIndex) => (
          <li key={itemIndex}>{renderInline(item, `l-${blockIndex}-${itemIndex}`)}</li>
        ));
        return block.type === 'ol' ? (
          <ol key={`l-${blockIndex}`} className="mt-2 list-decimal space-y-1 pl-5">
            {items}
          </ol>
        ) : (
          <ul key={`l-${blockIndex}`} className="mt-2 list-disc space-y-1 pl-5">
            {items}
          </ul>
        );
      })}
    </div>
  );
}
