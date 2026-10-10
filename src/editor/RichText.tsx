// What-you-see editor that reads and writes Markdown, so records stay plain text in the repository.
import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { TableKit } from '@tiptap/extension-table';
import { Markdown } from '@tiptap/markdown';

export function RichText({
  value,
  onChange,
  placeholder,
  minHeight = 110,
  id,
}: {
  value: string | undefined;
  onChange: (md: string) => void;
  placeholder?: string;
  minHeight?: number;
  id?: string;
}) {
  const [raw, setRaw] = useState(false);
  const [linking, setLinking] = useState(false);
  const [href, setHref] = useState('');
  const last = useRef(value ?? '');
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } },
      }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      TableKit.configure({ table: { resizable: false } }),
      Markdown,
    ],
    content: value ?? '',
    contentType: 'markdown',
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor: ed }) => {
      const md = ed.getMarkdown();
      last.current = md;
      onChange(md);
    },
  });

  // Follow outside changes (e.g. switching back from the Markdown view, or a preset).
  useEffect(() => {
    if (!editor || raw) return;
    if ((value ?? '') !== last.current) {
      last.current = value ?? '';
      editor.commands.setContent(value ?? '', { contentType: 'markdown', emitUpdate: false });
    }
  }, [value, editor, raw]);

  if (!editor) return null;
  const btn = (label: string, on: boolean, run: () => void, title?: string) => (
    <button type="button" className={on ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={run} title={title ?? label} aria-pressed={on}>
      {label}
    </button>
  );

  return (
    <div className="rte" id={id}>
      <div className="rte-bar">
        {raw ? (
          <span className="muted" style={{ fontSize: 'var(--step--2)', padding: '3px 6px' }}>
            Markdown
          </span>
        ) : (
          <>
            {btn('B', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), 'Bold')}
            {btn('I', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), 'Italic')}
            {btn('H2', editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), 'Heading')}
            {btn('H3', editor.isActive('heading', { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), 'Subheading')}
            {btn('• List', editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), 'Bulleted list')}
            {btn('1. List', editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), 'Numbered list')}
            {btn('❝', editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run(), 'Quote')}
            {btn('Link', editor.isActive('link'), () => {
              if (editor.isActive('link')) editor.chain().focus().unsetLink().run();
              else {
                setHref('');
                setLinking(true);
              }
            })}
            {btn('Table', editor.isActive('table'), () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), 'Insert table')}
            {editor.isActive('table') ? (
              <>
                {btn('+ Row', false, () => editor.chain().focus().addRowAfter().run())}
                {btn('+ Col', false, () => editor.chain().focus().addColumnAfter().run())}
                {btn('− Row', false, () => editor.chain().focus().deleteRow().run())}
              </>
            ) : null}
            {btn('↶', false, () => editor.chain().focus().undo().run(), 'Undo')}
          </>
        )}
        <span style={{ marginLeft: 'auto' }} />
        {btn(raw ? 'Rich text' : 'Markdown', false, () => setRaw((v) => !v), raw ? 'Back to the visual editor' : 'Edit the Markdown source')}
      </div>
      {linking && !raw ? (
        <div className="row" style={{ padding: 6, borderBottom: '1px solid var(--rule)', gap: 6 }}>
          <input
            className="input"
            autoFocus
            placeholder="https://"
            value={href}
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (href.trim()) editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
                setLinking(false);
              }
              if (e.key === 'Escape') {
                e.stopPropagation();
                setLinking(false);
              }
            }}
            style={{ maxWidth: 420 }}
            aria-label="Link address"
          />
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              if (href.trim()) editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
              setLinking(false);
            }}
          >
            Apply
          </button>
        </div>
      ) : null}
      {raw ? (
        <textarea
          className="textarea"
          style={{ border: 0, borderRadius: '0 0 7px 7px', minHeight, fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          aria-label={placeholder ?? 'Markdown'}
        />
      ) : (
        <div className="rte-body" style={{ ['--rte-min' as string]: `${minHeight}px` }}>
          <EditorContent editor={editor} />
        </div>
      )}
    </div>
  );
}
