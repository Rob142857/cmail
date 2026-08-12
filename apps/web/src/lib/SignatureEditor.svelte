<script lang="ts">
  import { untrack } from 'svelte';

  let {
    id,
    name = 'html',
    value = '',
    disabled = false,
    label = 'Signature content',
    description = '',
    placeholder = 'Add your name, role, phone number or preferred sign-off…',
    onchange,
  }: {
    id: string;
    name?: string;
    value?: string;
    disabled?: boolean;
    label?: string;
    description?: string;
    placeholder?: string;
    onchange?: (html: string) => void;
  } = $props();

  function normaliseEmptyMarkup(input: string): string {
    const meaningful = input
      .replace(/&nbsp;/gi, ' ')
      .replace(/<br\s*\/?>/gi, '')
      .replace(/<\/?(?:div|p|span)\b[^>]*>/gi, '')
      .trim();
    return meaningful ? input : '';
  }

  // Each form owns its editing session. A normal form response remounts the
  // component with the server-sanitised value, so prop changes must not
  // overwrite text while the person is actively editing.
  let html = $state(untrack(() => normaliseEmptyMarkup(value)));
  let editor: HTMLDivElement | null = $state(null);

  function run(command: string, commandValue?: string) {
    if (disabled || !editor) return;
    editor.focus();
    document.execCommand(command, false, commandValue);
    handleInput();
  }

  function addLink() {
    if (disabled) return;
    const address = window.prompt('Enter a complete https://, http://, or mailto: address');
    if (!address) return;
    const url = address.trim();
    if (!/^(?:https?:\/\/|mailto:)/i.test(url)) {
      window.alert('That link is not supported. Use a complete https://, http://, or mailto: address.');
      return;
    }
    run('createLink', url);
  }

  function handleInput() {
    html = normaliseEmptyMarkup(editor?.innerHTML || '');
    onchange?.(html);
  }

  function handlePaste(event: ClipboardEvent) {
    // Signatures are deliberately small, safe documents. Plain-text paste
    // prevents copied tracking markup and hidden website styles entering the
    // editor; users can add intentional formatting with the toolbar. The
    // server additionally strips every image, including remote tracking pixels.
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') || '';
    document.execCommand('insertText', false, text);
    handleInput();
  }

  const characterCount = $derived(html.replace(/<[^>]*>/g, '').trim().length);
</script>

<div class="signature-field" class:is-disabled={disabled}>
  <div class="field-heading">
    <div>
      <span class="field-label" id={`${id}-label`}>{label}</span>
      {#if description}<p>{description}</p>{/if}
    </div>
    <span class="format-note">Safe rich text</span>
  </div>

  <input type="hidden" {name} value={html} />
  <div class="editor-shell">
    <div class="toolbar" role="toolbar" aria-label={`${label} formatting`}>
      <button type="button" onclick={() => run('bold')} {disabled} aria-label="Bold" title="Bold"><strong>B</strong></button>
      <button type="button" onclick={() => run('italic')} {disabled} aria-label="Italic" title="Italic"><em>I</em></button>
      <button type="button" onclick={() => run('underline')} {disabled} aria-label="Underline" title="Underline"><u>U</u></button>
      <span class="toolbar-divider" aria-hidden="true"></span>
      <button type="button" onclick={addLink} {disabled} aria-label="Add link" title="Add link">Link</button>
      <button type="button" onclick={() => run('insertUnorderedList')} {disabled} aria-label="Bulleted list" title="Bulleted list">• List</button>
      <button type="button" onclick={() => run('removeFormat')} {disabled} aria-label="Clear formatting" title="Clear formatting">Clear</button>
    </div>
    {#if disabled}
      <iframe
        {id}
        class="editor editor-readonly-frame"
        title={`${label} preview`}
        aria-labelledby={`${id}-label`}
        sandbox=""
        srcdoc={html}
      ></iframe>
    {:else}
      <div
        {id}
        bind:this={editor}
        bind:innerHTML={html}
        class="editor"
        contenteditable="true"
        role="textbox"
        aria-labelledby={`${id}-label`}
        aria-multiline="true"
        data-placeholder={placeholder}
        oninput={handleInput}
        onpaste={handlePaste}
      ></div>
    {/if}
  </div>
  <div class="editor-foot">
    <span>Formatting is cleaned before it is saved and sent.</span>
    <span>{characterCount.toLocaleString()} characters</span>
  </div>
</div>

<style>
  .signature-field { display: flex; flex-direction: column; gap: 8px; }
  .field-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .field-label { display: block; font-size: 13px; font-weight: 650; color: var(--text); }
  .field-heading p { margin: 3px 0 0; color: var(--text-muted); font-size: 12px; line-height: 1.45; }
  .format-note {
    flex: 0 0 auto;
    padding: 3px 8px;
    border-radius: var(--radius-pill);
    background: var(--success-soft);
    color: var(--success);
    font-size: 10.5px;
    font-weight: 650;
  }
  .editor-shell {
    overflow: hidden;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
  }
  .editor-shell:focus-within { border-color: var(--primary); box-shadow: 0 0 0 1px var(--focus-inner), 0 0 0 3px var(--primary-border); }
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
  }
  .toolbar button:hover:not(:disabled) { border-color: var(--border); background: var(--bg-hover); }
  .toolbar-divider { width: 1px; height: 20px; margin: 0 3px; background: var(--border); }
  .editor {
    min-height: 148px;
    padding: 14px 16px;
    outline: none;
    color: var(--text);
    font-size: 13px;
    line-height: 1.55;
    overflow-wrap: anywhere;
  }
  .editor:empty::before { content: attr(data-placeholder); color: var(--text-faint); pointer-events: none; }
  .editor-readonly-frame { display: block; width: 100%; padding: 0; border: 0; background: #fff; }
  .editor-foot { display: flex; justify-content: space-between; gap: 12px; color: var(--text-faint); font-size: 10.5px; }
  .is-disabled .editor-shell { border-color: var(--border); background: var(--bg-subtle); }
  .is-disabled .editor { color: var(--text-muted); cursor: not-allowed; }
  .is-disabled .toolbar { opacity: 0.58; }

  @media (max-width: 520px) {
    .field-heading, .editor-foot { flex-direction: column; gap: 5px; }
  }
</style>
