<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { Editor } from '@tiptap/core';
  import { cleanPastedHtml } from './paste-html';
  import { normaliseLinkInput, type RichNode } from './rich-text';

  let {
    id,
    value = '',
    disabled = false,
    label = 'Message',
    placeholder = 'Write your message…',
    onchange,
    onready,
    onfailed,
  }: {
    id: string;
    /** Initial HTML. Later prop changes are ignored; remount to replace content. */
    value?: string;
    disabled?: boolean;
    label?: string;
    placeholder?: string;
    /** html is '' when the editor holds no text, so empty drafts stay empty. */
    onchange?: (html: string) => void;
    onready?: (api: { getJson: () => RichNode | null }) => void;
    /** The editor bundle could not load (for example offline after a deploy). */
    onfailed?: () => void;
  } = $props();

  let host: HTMLDivElement | null = $state(null);
  let editor: Editor | null = $state(null);
  let loadFailed = $state(false);
  let empty = $state(untrack(() => !value));
  // Bumped on every editor transaction so toolbar pressed states re-read.
  let revision = $state(0);

  const marks = $derived.by(() => {
    void revision;
    const current = editor;
    return {
      bold: current?.isActive('bold') ?? false,
      italic: current?.isActive('italic') ?? false,
      underline: current?.isActive('underline') ?? false,
      link: current?.isActive('link') ?? false,
      bulletList: current?.isActive('bulletList') ?? false,
      orderedList: current?.isActive('orderedList') ?? false,
      blockquote: current?.isActive('blockquote') ?? false,
    };
  });

  onMount(() => {
    let destroyed = false;
    let instance: Editor | null = null;
    (async () => {
      try {
        // Loaded on demand so TipTap/ProseMirror never weigh on other routes.
        const [{ Editor: EditorClass }, { default: StarterKit }] = await Promise.all([
          import('@tiptap/core'),
          import('@tiptap/starter-kit'),
        ]);
        if (destroyed || !host) return;
        instance = new EditorClass({
          element: host,
          content: untrack(() => value) || '',
          editable: !untrack(() => disabled),
          extensions: [
            StarterKit.configure({
              heading: false,
              code: false,
              codeBlock: false,
              horizontalRule: false,
              strike: false,
              link: {
                openOnClick: false,
                autolink: true,
                linkOnPaste: true,
                defaultProtocol: 'https',
                protocols: ['mailto'],
                isAllowedUri: (url) => normaliseLinkInput(url) !== null,
                HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: null },
              },
            }),
          ],
          editorProps: {
            attributes: {
              id,
              role: 'textbox',
              'aria-multiline': 'true',
              'aria-label': label,
              spellcheck: 'true',
              autocapitalize: 'sentences',
              class: 'rich-text-surface',
            },
            // The schema already drops anything it has no node for; this also
            // removes Word cruft, comments and unsafe links before parsing.
            transformPastedHTML: (html) => cleanPastedHtml(html),
          },
          onTransaction: () => { revision += 1; },
          onUpdate: ({ editor: current }) => {
            empty = current.isEmpty;
            onchange?.(current.isEmpty ? '' : current.getHTML());
          },
        });
        editor = instance;
        empty = instance.isEmpty;
        onready?.({ getJson: () => (instance ? instance.getJSON() as RichNode : null) });
      } catch {
        if (destroyed) return;
        loadFailed = true;
        onfailed?.();
      }
    })();
    return () => {
      destroyed = true;
      instance?.destroy();
      editor = null;
    };
  });

  $effect(() => {
    const editable = !disabled;
    if (editor && editor.isEditable !== editable) editor.setEditable(editable);
  });

  function toggle(command: 'bold' | 'italic' | 'underline' | 'bulletList' | 'orderedList' | 'blockquote') {
    if (!editor || disabled) return;
    const chain = editor.chain().focus();
    if (command === 'bold') chain.toggleBold().run();
    else if (command === 'italic') chain.toggleItalic().run();
    else if (command === 'underline') chain.toggleUnderline().run();
    else if (command === 'bulletList') chain.toggleBulletList().run();
    else if (command === 'orderedList') chain.toggleOrderedList().run();
    else chain.toggleBlockquote().run();
  }

  function editLink() {
    if (!editor || disabled) return;
    const previous = editor.getAttributes('link').href;
    const input = window.prompt('Link address (https://… or an email address). Leave empty to remove the link.', typeof previous === 'string' ? previous : 'https://');
    if (input === null) return;
    if (!input.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    const href = normaliseLinkInput(input);
    if (!href) {
      window.alert('That link isn\'t supported. Use a web address (https://…) or an email address.');
      return;
    }
    if (editor.state.selection.empty && !editor.isActive('link')) {
      // No selected text: insert the address itself as the link text.
      editor.chain().focus().insertContent({ type: 'text', text: href.replace(/^mailto:/i, ''), marks: [{ type: 'link', attrs: { href } }] }).run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  }

  function clearFormatting() {
    if (!editor || disabled) return;
    editor.chain().focus().unsetAllMarks().clearNodes().run();
  }
</script>

<div class="rich-text" class:is-disabled={disabled}>
  <div class="toolbar" role="toolbar" aria-label={`${label} formatting`} aria-controls={id}>
    <button type="button" onclick={() => toggle('bold')} disabled={disabled || !editor} aria-pressed={marks.bold} aria-label="Bold" title="Bold (Ctrl+B)"><strong>B</strong></button>
    <button type="button" onclick={() => toggle('italic')} disabled={disabled || !editor} aria-pressed={marks.italic} aria-label="Italic" title="Italic (Ctrl+I)"><em>I</em></button>
    <button type="button" onclick={() => toggle('underline')} disabled={disabled || !editor} aria-pressed={marks.underline} aria-label="Underline" title="Underline (Ctrl+U)"><u>U</u></button>
    <span class="toolbar-divider" aria-hidden="true"></span>
    <button type="button" onclick={editLink} disabled={disabled || !editor} aria-pressed={marks.link} aria-label="Add or edit link" title="Link">Link</button>
    <button type="button" onclick={() => toggle('bulletList')} disabled={disabled || !editor} aria-pressed={marks.bulletList} aria-label="Bulleted list" title="Bulleted list">• List</button>
    <button type="button" onclick={() => toggle('orderedList')} disabled={disabled || !editor} aria-pressed={marks.orderedList} aria-label="Numbered list" title="Numbered list">1. List</button>
    <button type="button" onclick={() => toggle('blockquote')} disabled={disabled || !editor} aria-pressed={marks.blockquote} aria-label="Quote" title="Quote">Quote</button>
    <span class="toolbar-divider" aria-hidden="true"></span>
    <button type="button" onclick={clearFormatting} disabled={disabled || !editor} aria-label="Clear formatting" title="Clear formatting">Clear</button>
  </div>
  <div class="surface-wrap">
    {#if loadFailed}
      <p class="editor-state" role="alert">The formatting editor couldn't load. Switch to plain text, or reload the page.</p>
    {:else if !editor}
      <p class="editor-state" aria-live="polite">Loading editor…</p>
    {/if}
    {#if editor && empty}<span class="placeholder" aria-hidden="true">{placeholder}</span>{/if}
    <div bind:this={host} class="host"></div>
  </div>
</div>

<style>
  .rich-text {
    overflow: hidden;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
  }
  .rich-text:focus-within { border-color: var(--primary); box-shadow: 0 0 0 1px var(--focus-inner), 0 0 0 3px var(--primary-border); }
  .toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 3px;
    min-height: 40px;
    padding: 4px 6px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-subtle);
  }
  .toolbar button {
    min-width: 30px;
    min-height: 30px;
    padding: 3px 8px;
    border-color: transparent;
    background: transparent;
    font-size: 12px;
    text-transform: none;
    letter-spacing: 0;
  }
  .toolbar button:hover:not(:disabled) { border-color: var(--border); background: var(--bg-hover); }
  .toolbar button[aria-pressed='true'] { border-color: var(--primary-border); background: var(--primary-soft, var(--bg-hover)); color: var(--primary); }
  .toolbar-divider { width: 1px; height: 20px; margin: 0 3px; background: var(--border); }
  /* Email paper, like the signature editor: recipients read on white, so the
     writing surface stays white in dark mode too. */
  .surface-wrap { position: relative; color-scheme: light; background: #ffffff; }
  .host :global(.rich-text-surface) {
    min-height: 240px;
    max-height: 60vh;
    overflow-y: auto;
    padding: 12px 14px;
    outline: none;
    color: #242424;
    caret-color: #242424;
    font-size: 14px;
    line-height: 1.55;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
  .host :global(.rich-text-surface p) { margin: 0 0 0.6em; }
  .host :global(.rich-text-surface ul), .host :global(.rich-text-surface ol) { margin: 0 0 0.6em; padding-left: 1.6em; }
  .host :global(.rich-text-surface ul) { list-style: disc; }
  .host :global(.rich-text-surface ol) { list-style: decimal; }
  .host :global(.rich-text-surface li p) { margin: 0; }
  .host :global(.rich-text-surface blockquote) { margin: 0 0 0.6em; padding-left: 10px; border-left: 3px solid #d1d5db; color: #4b5563; }
  .host :global(.rich-text-surface a) { color: #2563eb; text-decoration: underline; }
  .placeholder { position: absolute; top: 12px; left: 14px; color: #8a8a8a; font-size: 14px; pointer-events: none; }
  .editor-state { margin: 0; padding: 12px 14px; color: #6b7280; font-size: 13px; }
  .is-disabled .toolbar { opacity: 0.58; }
  .is-disabled .surface-wrap { cursor: not-allowed; }

  @media (max-width: 768px) {
    .host :global(.rich-text-surface) { min-height: 200px; max-height: none; }
  }
</style>
