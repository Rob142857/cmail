<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type { Editor } from '@tiptap/core';
  import Icon from '#lib/ui/Icon.svelte';
  import {
    COMPOSE_FONTS,
    COMPOSE_FONT_SIZES_PT,
    DEFAULT_COMPOSE_DEFAULTS,
    composeDefaultsStyle,
    type ComposeDefaults,
  } from '@cmail/shared/compose-style';
  import { normaliseLinkInput, type RichNode } from './rich-text';
  import { cleanPastedHtml } from './paste-html';
  import {
    HIGHLIGHT_COLORS,
    TEXT_COLORS,
    fontNameFromFamily,
    fontSizePt,
    fontStack,
    shortcutLabel,
  } from './rich-text-format';

  let {
    id,
    value = '',
    disabled = false,
    label = 'Message',
    placeholder = 'Write your message…',
    defaults = DEFAULT_COMPOSE_DEFAULTS,
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
    /** The font and size this person's messages start in (Settings). */
    defaults?: ComposeDefaults;
    /** html is '' when the editor holds no text, so empty drafts stay empty. */
    onchange?: (html: string) => void;
    onready?: (api: { getJson: () => RichNode | null }) => void;
    /** The editor bundle could not load (for example offline after a deploy). */
    onfailed?: () => void;
  } = $props();

  type Menu = 'color' | 'highlight' | 'link' | 'more' | null;

  let host: HTMLDivElement | null = $state(null);
  let wrap: HTMLDivElement | null = $state(null);
  let toolbar: HTMLDivElement | null = $state(null);
  let editor: Editor | null = $state(null);
  let loadFailed = $state(false);
  let empty = $state(untrack(() => !value));
  // Bumped on every editor transaction so toolbar states re-read.
  let revision = $state(0);
  let menu: Menu = $state(null);
  /** Where a colour palette or the link form sits under the bar, in px. */
  let popoverLeft = $state(0);
  let menuTrigger: HTMLElement | null = null;
  let linkInput = $state('');
  let linkError = $state('');
  let linkField: HTMLInputElement | null = $state(null);
  // Roving tab stop: Tab reaches the bar once, arrow keys move inside it.
  let activeControl = $state('bold');
  let apple = $state(false);
  let pasteCleaner: ((html: string) => string) | null = null;
  /** Shown as data-paste="office" once Word/Outlook paste cleaning is loaded. */
  let officePaste = $state(false);

  const surfaceStyle = $derived(composeDefaultsStyle(defaults));
  const defaultFont = $derived(defaults.fontFamily);
  const defaultSize = $derived(defaults.fontSizePt);
  const keys = (combo: string) => shortcutLabel(combo, apple);

  const current = $derived.by(() => {
    void revision;
    const active = editor;
    const style = active?.getAttributes('textStyle') ?? {};
    const align = (['center', 'right'] as const).find((value) => active?.isActive({ textAlign: value })) ?? 'left';
    return {
      bold: active?.isActive('bold') ?? false,
      italic: active?.isActive('italic') ?? false,
      underline: active?.isActive('underline') ?? false,
      strike: active?.isActive('strike') ?? false,
      link: active?.isActive('link') ?? false,
      bulletList: active?.isActive('bulletList') ?? false,
      orderedList: active?.isActive('orderedList') ?? false,
      blockquote: active?.isActive('blockquote') ?? false,
      align,
      font: fontNameFromFamily(style.fontFamily) || (style.fontFamily ? '' : defaultFont),
      size: fontSizePt(style.fontSize) ?? (style.fontSize ? null : defaultSize),
      color: typeof style.color === 'string' ? style.color.toLowerCase() : '',
      highlight: typeof style.backgroundColor === 'string' ? style.backgroundColor.toLowerCase() : '',
      canUndo: active?.can().undo() ?? false,
      canRedo: active?.can().redo() ?? false,
    };
  });
  const off = $derived(disabled || !editor);

  onMount(() => {
    apple = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
    let destroyed = false;
    let instance: Editor | null = null;
    const phone = window.matchMedia('(max-width: 599px)');
    const resetStop = () => { activeControl = 'bold'; menu = null; };
    phone.addEventListener('change', resetStop);
    (async () => {
      try {
        // Loaded on demand so TipTap/ProseMirror never weigh on other routes.
        const [
          { Editor: EditorClass },
          { default: StarterKit },
          { TextStyle, Color, BackgroundColor, FontFamily, FontSize },
          { default: TextAlign },
          { ComposeIndent, OutlookShortcuts },
        ] = await Promise.all([
          import('@tiptap/core'),
          import('@tiptap/starter-kit'),
          import('@tiptap/extension-text-style'),
          import('@tiptap/extension-text-align'),
          import('./rich-text-extensions'),
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
            TextStyle,
            Color,
            BackgroundColor,
            FontFamily,
            FontSize,
            TextAlign.configure({ types: ['paragraph'], alignments: ['left', 'center', 'right'] }),
            ComposeIndent,
            OutlookShortcuts.configure({ onLink: () => { void openLink(null); } }),
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
            // Word and Outlook paste keeps bold, italic, lists, links, colours
            // and sizes; mso- styles, classes and conditional comments go. The
            // same allowlist runs again on the server.
            // Keep the line being typed clear of the sticky formatting bar
            // (top) and the phone's sticky Send bar (bottom).
            scrollMargin: { top: 64, bottom: 104, left: 8, right: 8 },
            scrollThreshold: { top: 64, bottom: 104, left: 0, right: 0 },
            // The Office-aware cleaner (an HTML parser, ~75 KB) loads once the
            // editor is idle; until then the lighter DOM cleaner stands in.
            transformPastedHTML: (html) => (pasteCleaner ? pasteCleaner(html) : cleanPastedHtml(html)),
          },
          onTransaction: () => { revision += 1; },
          onUpdate: ({ editor: active }) => {
            empty = active.isEmpty;
            onchange?.(active.isEmpty ? '' : active.getHTML());
          },
        });
        editor = instance;
        empty = instance.isEmpty;
        const loadPasteCleaner = () => {
          import('@cmail/shared/compose-paste')
            .then((module) => { pasteCleaner = module.cleanComposePaste; officePaste = true; })
            .catch(() => { /* the DOM cleaner keeps working */ });
        };
        if ('requestIdleCallback' in window) window.requestIdleCallback(loadPasteCleaner, { timeout: 3000 });
        else setTimeout(loadPasteCleaner, 1000);
        onready?.({ getJson: () => (instance ? instance.getJSON() as RichNode : null) });
      } catch {
        if (destroyed) return;
        loadFailed = true;
        onfailed?.();
      }
    })();
    return () => {
      destroyed = true;
      phone.removeEventListener('change', resetStop);
      instance?.destroy();
      editor = null;
    };
  });

  $effect(() => {
    const editable = !disabled;
    if (editor && editor.isEditable !== editable) editor.setEditable(editable);
    if (disabled) menu = null;
  });

  function run(action: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) {
    if (!editor || disabled) return;
    action(editor.chain().focus()).run();
  }

  // Keep the caret (and the phone keyboard) in the editor when a button is
  // pressed with a mouse or finger. Keyboard activation is unaffected.
  function keepFocus(event: MouseEvent) {
    event.preventDefault();
  }

  function setFont(name: string) {
    if (!name) return;
    run((chain) => (name === defaultFont ? chain.unsetFontFamily() : chain.setFontFamily(fontStack(name))));
  }

  function setSize(value: string) {
    const size = Number(value);
    if (!size) return;
    run((chain) => (size === defaultSize ? chain.unsetFontSize() : chain.setFontSize(`${size}pt`)));
  }

  function setColor(value: string) {
    run((chain) => (value ? chain.setColor(value) : chain.unsetColor()));
    closeMenu(false);
  }

  function setHighlight(value: string) {
    run((chain) => (value ? chain.setBackgroundColor(value) : chain.unsetBackgroundColor()));
    closeMenu(false);
  }

  function clearFormatting() {
    run((chain) => chain.unsetAllMarks().clearNodes().unsetTextAlign().updateAttributes('paragraph', { indent: 0 }));
  }

  async function openMenu(next: Exclude<Menu, null>, trigger: HTMLElement | null, event?: Event) {
    if (off) return;
    if (menu === next) {
      closeMenu(true);
      return;
    }
    const byKeyboard = !event || (event as PointerEvent).detail === 0;
    menuTrigger = trigger;
    if (trigger && wrap) {
      const box = wrap.getBoundingClientRect();
      const at = trigger.getBoundingClientRect();
      // Clamped so a 280px panel never sticks out of the editor (or the screen).
      popoverLeft = Math.max(0, Math.min(at.left - box.left, box.width - Math.min(280, box.width)));
    } else {
      popoverLeft = 0;
    }
    menu = next;
    await tick();
    if (next === 'link') linkField?.focus();
    else if (byKeyboard) wrap?.querySelector<HTMLElement>(`[data-menu="${next}"] button`)?.focus();
  }

  function closeMenu(returnFocus: boolean) {
    const trigger = menuTrigger;
    menu = null;
    menuTrigger = null;
    linkError = '';
    if (!returnFocus) return;
    if (trigger && trigger.offsetParent !== null) trigger.focus();
    else editor?.commands.focus();
  }

  async function openLink(trigger: HTMLElement | null, event?: Event) {
    if (!editor || disabled) return;
    const previous = editor.getAttributes('link').href;
    linkInput = typeof previous === 'string' ? previous : '';
    linkError = '';
    await openMenu('link', trigger ?? wrap?.querySelector<HTMLElement>('[data-control="link"]:not(.is-hidden)') ?? null, event);
  }

  function applyLink() {
    if (!editor || disabled) return;
    if (!linkInput.trim()) {
      removeLink();
      return;
    }
    const href = normaliseLinkInput(linkInput);
    if (!href) {
      linkError = 'Use a web address (https://…) or an email address.';
      linkField?.focus();
      return;
    }
    if (editor.state.selection.empty && !editor.isActive('link')) {
      // No selected text: insert the address itself as the link text.
      editor.chain().focus().insertContent({ type: 'text', text: href.replace(/^mailto:/i, ''), marks: [{ type: 'link', attrs: { href } }] }).run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    }
    menu = null;
    menuTrigger = null;
  }

  function removeLink() {
    editor?.chain().focus().extendMarkRange('link').unsetLink().run();
    menu = null;
    menuTrigger = null;
  }

  function linkKeydown(event: KeyboardEvent) {
    // The editor sits inside the compose form: Enter here must not send.
    if (event.key === 'Enter') {
      event.preventDefault();
      applyLink();
    }
  }

  function onWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && menu) {
      event.preventDefault();
      closeMenu(true);
    }
  }

  function onWindowPointerdown(event: PointerEvent) {
    if (menu && wrap && !wrap.contains(event.target as Node)) closeMenu(false);
  }

  /** WAI-ARIA toolbar: Left/Right/Home/End move between the visible controls. */
  function toolbarKeydown(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !toolbar) return;
    const controls = [...toolbar.querySelectorAll<HTMLElement>('[data-control]')]
      .filter((control) => control.offsetParent !== null && !(control as HTMLButtonElement).disabled);
    const index = controls.indexOf(event.target as HTMLElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? controls.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + controls.length) % controls.length;
    controls[next].focus();
  }

  function toolbarFocusin(event: FocusEvent) {
    const control = (event.target as HTMLElement).closest<HTMLElement>('[data-control]');
    if (control?.dataset.control) activeControl = control.dataset.control;
  }

  const stop = (name: string) => (activeControl === name ? 0 : -1);
</script>

<svelte:window onkeydown={onWindowKeydown} onpointerdown={onWindowPointerdown} />

{#snippet fontSelect(extra: string)}
  <select
    class={`tb-select tb-font ${extra}`}
    data-control="font"
    tabindex={stop('font')}
    aria-label="Font"
    title="Font"
    disabled={off}
    value={current.font}
    onchange={(event) => setFont(event.currentTarget.value)}
  >
    {#if !current.font}<option value="" disabled>Mixed</option>{/if}
    {#each COMPOSE_FONTS as font (font.name)}
      <option value={font.name} style={`font-family: ${font.stack}`}>{font.name}</option>
    {/each}
  </select>
{/snippet}

{#snippet sizeSelect(extra: string)}
  <select
    class={`tb-select tb-size ${extra}`}
    data-control="size"
    tabindex={stop('size')}
    aria-label="Font size"
    title="Font size"
    disabled={off}
    value={current.size === null ? '' : String(current.size)}
    onchange={(event) => setSize(event.currentTarget.value)}
  >
    {#if current.size === null || !COMPOSE_FONT_SIZES_PT.includes(current.size)}<option value={current.size === null ? '' : String(current.size)} disabled>{current.size ?? '–'}</option>{/if}
    {#each COMPOSE_FONT_SIZES_PT as size (size)}
      <option value={String(size)}>{size}</option>
    {/each}
  </select>
{/snippet}

<div class="rich-text" class:is-disabled={disabled} data-paste={officePaste ? 'office' : 'basic'}>
  <div class="toolbar-wrap" bind:this={wrap}>
    <div
      class="toolbar"
      role="toolbar"
      aria-label={`${label} formatting`}
      aria-controls={id}
      tabindex="-1"
      bind:this={toolbar}
      onkeydown={toolbarKeydown}
      onfocusin={toolbarFocusin}
    >
      {@render fontSelect('wide-only')}
      {@render sizeSelect('wide-only')}
      <span class="sep" aria-hidden="true"></span>
      <button type="button" class="tb" data-control="bold" tabindex={stop('bold')} onmousedown={keepFocus} onclick={() => run((c) => c.toggleBold())} disabled={off} aria-pressed={current.bold} aria-label="Bold" title={`Bold (${keys('Ctrl+B')})`}><strong class="glyph">B</strong></button>
      <button type="button" class="tb" data-control="italic" tabindex={stop('italic')} onmousedown={keepFocus} onclick={() => run((c) => c.toggleItalic())} disabled={off} aria-pressed={current.italic} aria-label="Italic" title={`Italic (${keys('Ctrl+I')})`}><em class="glyph glyph-serif">I</em></button>
      <button type="button" class="tb" data-control="underline" tabindex={stop('underline')} onmousedown={keepFocus} onclick={() => run((c) => c.toggleUnderline())} disabled={off} aria-pressed={current.underline} aria-label="Underline" title={`Underline (${keys('Ctrl+U')})`}><u class="glyph">U</u></button>
      <button type="button" class="tb wide-only" data-control="strike" tabindex={stop('strike')} onmousedown={keepFocus} onclick={() => run((c) => c.toggleStrike())} disabled={off} aria-pressed={current.strike} aria-label="Strikethrough" title={`Strikethrough (${keys('Ctrl+Shift+S')})`}><s class="glyph">ab</s></button>
      {@render sizeSelect('phone-only')}
      <span class="sep" aria-hidden="true"></span>
      <button type="button" class="tb tb-swatch" data-control="color" tabindex={stop('color')} onmousedown={keepFocus} onclick={(event) => openMenu('color', event.currentTarget, event)} disabled={off} aria-haspopup="true" aria-expanded={menu === 'color'} aria-label="Font colour" title="Font colour">
        <span class="glyph">A</span><span class="bar" style={`background: ${current.color || '#000000'}`}></span>
      </button>
      <button type="button" class="tb tb-swatch wide-only" data-control="highlight" tabindex={stop('highlight')} onmousedown={keepFocus} onclick={(event) => openMenu('highlight', event.currentTarget, event)} disabled={off} aria-haspopup="true" aria-expanded={menu === 'highlight'} aria-label="Highlight colour" title="Highlight colour">
        <Icon name="highlight" size={16} /><span class="bar" style={`background: ${current.highlight || '#ffff00'}`}></span>
      </button>
      <span class="sep" aria-hidden="true"></span>
      <button type="button" class="tb" data-control="bullets" tabindex={stop('bullets')} onmousedown={keepFocus} onclick={() => run((c) => c.toggleBulletList())} disabled={off} aria-pressed={current.bulletList} aria-label="Bulleted list" title={`Bulleted list (${keys('Ctrl+Shift+8')})`}><Icon name="listBullet" size={18} /></button>
      <button type="button" class="tb wide-only" data-control="numbers" tabindex={stop('numbers')} onmousedown={keepFocus} onclick={() => run((c) => c.toggleOrderedList())} disabled={off} aria-pressed={current.orderedList} aria-label="Numbered list" title={`Numbered list (${keys('Ctrl+Shift+7')})`}><Icon name="listNumber" size={18} /></button>
      <button type="button" class="tb wide-only" data-control="outdent" tabindex={stop('outdent')} onmousedown={keepFocus} onclick={() => run((c) => c.outdent())} disabled={off} aria-label="Decrease indent" title={`Decrease indent (${keys('Ctrl+Shift+M')})`}><Icon name="indentDecrease" size={18} /></button>
      <button type="button" class="tb wide-only" data-control="indent" tabindex={stop('indent')} onmousedown={keepFocus} onclick={() => run((c) => c.indent())} disabled={off} aria-label="Increase indent" title={`Increase indent (${keys('Ctrl+M')})`}><Icon name="indentIncrease" size={18} /></button>
      <span class="sep wide-only" aria-hidden="true"></span>
      <button type="button" class="tb wide-only" data-control="align-left" tabindex={stop('align-left')} onmousedown={keepFocus} onclick={() => run((c) => c.unsetTextAlign())} disabled={off} aria-pressed={current.align === 'left'} aria-label="Align left" title={`Align left (${keys('Ctrl+Shift+L')})`}><Icon name="alignLeft" size={18} /></button>
      <button type="button" class="tb wide-only" data-control="align-center" tabindex={stop('align-center')} onmousedown={keepFocus} onclick={() => run((c) => c.setTextAlign('center'))} disabled={off} aria-pressed={current.align === 'center'} aria-label="Centre" title={`Centre (${keys('Ctrl+Shift+E')})`}><Icon name="alignCenter" size={18} /></button>
      <button type="button" class="tb wide-only" data-control="align-right" tabindex={stop('align-right')} onmousedown={keepFocus} onclick={() => run((c) => c.setTextAlign('right'))} disabled={off} aria-pressed={current.align === 'right'} aria-label="Align right" title={`Align right (${keys('Ctrl+Shift+R')})`}><Icon name="alignRight" size={18} /></button>
      <span class="sep" aria-hidden="true"></span>
      <button type="button" class="tb" data-control="link" tabindex={stop('link')} onmousedown={keepFocus} onclick={(event) => openLink(event.currentTarget, event)} disabled={off} aria-haspopup="true" aria-expanded={menu === 'link'} aria-pressed={current.link} aria-label="Link" title={`Insert or edit link (${keys('Ctrl+K')})`}><Icon name="link" size={18} /></button>
      <button type="button" class="tb wide-only" data-control="quote" tabindex={stop('quote')} onmousedown={keepFocus} onclick={() => run((c) => c.toggleBlockquote())} disabled={off} aria-pressed={current.blockquote} aria-label="Quote" title={`Quote (${keys('Ctrl+Shift+B')})`}><Icon name="quote" size={18} /></button>
      <button type="button" class="tb wide-only" data-control="clear" tabindex={stop('clear')} onmousedown={keepFocus} onclick={clearFormatting} disabled={off} aria-label="Clear formatting" title="Clear formatting"><Icon name="clearFormat" size={18} /></button>
      <span class="sep wide-only" aria-hidden="true"></span>
      <button type="button" class="tb wide-only" data-control="undo" tabindex={stop('undo')} onmousedown={keepFocus} onclick={() => run((c) => c.undo())} disabled={off || !current.canUndo} aria-label="Undo" title={`Undo (${keys('Ctrl+Z')})`}><Icon name="undo" size={18} /></button>
      <button type="button" class="tb wide-only" data-control="redo" tabindex={stop('redo')} onmousedown={keepFocus} onclick={() => run((c) => c.redo())} disabled={off || !current.canRedo} aria-label="Redo" title={`Redo (${keys('Ctrl+Y')})`}><Icon name="redo" size={18} /></button>
      <button type="button" class="tb phone-only more-button" data-control="more" tabindex={stop('more')} onmousedown={keepFocus} onclick={(event) => openMenu('more', event.currentTarget, event)} disabled={off} aria-haspopup="true" aria-expanded={menu === 'more'} aria-controls={`${id}-more`} aria-label="More formatting" title="More formatting"><Icon name="more" size={18} /></button>
    </div>

    {#if menu === 'more'}
      <div class="more-sheet" id={`${id}-more`} data-menu="more" role="group" aria-label="More formatting">
        <div class="sheet-row">{@render fontSelect('sheet-select')}</div>
        <div class="sheet-grid">
          <button type="button" class="tb" onmousedown={keepFocus} onclick={() => run((c) => c.toggleStrike())} aria-pressed={current.strike} aria-label="Strikethrough"><s class="glyph">ab</s></button>
          <button type="button" class="tb tb-swatch" onmousedown={keepFocus} onclick={(event) => openMenu('highlight', event.currentTarget, event)} aria-haspopup="true" aria-label="Highlight colour"><Icon name="highlight" size={16} /><span class="bar" style={`background: ${current.highlight || '#ffff00'}`}></span></button>
          <button type="button" class="tb" onmousedown={keepFocus} onclick={() => run((c) => c.toggleOrderedList())} aria-pressed={current.orderedList} aria-label="Numbered list"><Icon name="listNumber" size={18} /></button>
          <button type="button" class="tb" onmousedown={keepFocus} onclick={() => run((c) => c.outdent())} aria-label="Decrease indent"><Icon name="indentDecrease" size={18} /></button>
          <button type="button" class="tb" onmousedown={keepFocus} onclick={() => run((c) => c.indent())} aria-label="Increase indent"><Icon name="indentIncrease" size={18} /></button>
          <button type="button" class="tb" onmousedown={keepFocus} onclick={() => run((c) => c.unsetTextAlign())} aria-pressed={current.align === 'left'} aria-label="Align left"><Icon name="alignLeft" size={18} /></button>
          <button type="button" class="tb" onmousedown={keepFocus} onclick={() => run((c) => c.setTextAlign('center'))} aria-pressed={current.align === 'center'} aria-label="Centre"><Icon name="alignCenter" size={18} /></button>
          <button type="button" class="tb" onmousedown={keepFocus} onclick={() => run((c) => c.setTextAlign('right'))} aria-pressed={current.align === 'right'} aria-label="Align right"><Icon name="alignRight" size={18} /></button>
          <button type="button" class="tb" onmousedown={keepFocus} onclick={() => run((c) => c.toggleBlockquote())} aria-pressed={current.blockquote} aria-label="Quote"><Icon name="quote" size={18} /></button>
          <button type="button" class="tb" onmousedown={keepFocus} onclick={clearFormatting} aria-label="Clear formatting"><Icon name="clearFormat" size={18} /></button>
          <button type="button" class="tb" onmousedown={keepFocus} onclick={() => run((c) => c.undo())} disabled={!current.canUndo} aria-label="Undo"><Icon name="undo" size={18} /></button>
          <button type="button" class="tb" onmousedown={keepFocus} onclick={() => run((c) => c.redo())} disabled={!current.canRedo} aria-label="Redo"><Icon name="redo" size={18} /></button>
        </div>
      </div>
    {/if}

    {#if menu === 'color' || menu === 'highlight'}
      {@const swatches = menu === 'color' ? TEXT_COLORS : HIGHLIGHT_COLORS}
      {@const chosen = menu === 'color' ? current.color : current.highlight}
      <div class="popover palette" data-menu={menu} style={`left: ${popoverLeft}px`} role="group" aria-label={menu === 'color' ? 'Font colour' : 'Highlight colour'}>
        <button type="button" class="swatch-auto" onmousedown={keepFocus} onclick={() => (menu === 'color' ? setColor('') : setHighlight(''))} aria-pressed={!chosen}>
          <span class="swatch-chip" style={menu === 'color' ? 'background: #000000' : ''} class:no-colour={menu === 'highlight'}></span>
          {menu === 'color' ? 'Automatic' : 'No colour'}
        </button>
        <div class="swatches">
          {#each swatches as swatch (swatch.value)}
            <button
              type="button"
              class="swatch"
              style={`background: ${swatch.value}`}
              onmousedown={keepFocus}
              onclick={() => (menu === 'color' ? setColor(swatch.value) : setHighlight(swatch.value))}
              aria-label={swatch.name}
              aria-pressed={chosen === swatch.value}
              title={swatch.name}
            ></button>
          {/each}
        </div>
      </div>
    {/if}

    {#if menu === 'link'}
      <div class="popover link-form" data-menu="link" style={`left: ${popoverLeft}px`} role="group" aria-label="Link">
        <label for={`${id}-link`}>Link address</label>
        <input
          id={`${id}-link`}
          bind:this={linkField}
          bind:value={linkInput}
          onkeydown={linkKeydown}
          type="text"
          inputmode="url"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder="https://… or name@example.org"
          aria-invalid={linkError ? 'true' : undefined}
          aria-describedby={linkError ? `${id}-link-error` : undefined}
        />
        {#if linkError}<p class="link-error" id={`${id}-link-error`} role="alert">{linkError}</p>{/if}
        <div class="link-actions">
          {#if current.link}<button type="button" class="btn btn-ghost" onclick={removeLink}>Remove link</button>{/if}
          <button type="button" class="btn" onclick={() => closeMenu(true)}>Cancel</button>
          <button type="button" class="btn btn-primary" onclick={applyLink}>Apply</button>
        </div>
      </div>
    {/if}
  </div>
  <div class="surface-wrap" style={surfaceStyle}>
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
    position: relative;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
  }
  .rich-text:focus-within { border-color: var(--primary); box-shadow: 0 0 0 1px var(--focus-inner), 0 0 0 3px var(--primary-border); }
  /* No overflow: hidden on .rich-text: it would stop the bar sticking. */
  .toolbar-wrap {
    position: relative;
    z-index: 4;
    border-bottom: 1px solid var(--border);
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    background: var(--bg-subtle);
  }
  .toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 1px;
    min-height: 40px;
    padding: 4px 6px;
    outline: none;
  }
  .tb {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    position: relative;
    flex: 0 0 auto;
    min-width: 28px;
    min-height: 30px;
    padding: 2px 4px;
    border-color: transparent;
    background: transparent;
    color: var(--text);
    font-size: 13px;
    text-transform: none;
    letter-spacing: 0;
  }
  .tb:hover:not(:disabled) { border-color: var(--border); background: var(--bg-hover); }
  .tb[aria-pressed='true'], .tb[aria-expanded='true'] { border-color: var(--primary-border); background: var(--primary-soft, var(--bg-hover)); color: var(--primary-text); }
  .tb:disabled { opacity: 0.45; }
  .glyph { font-size: 15px; line-height: 1; }
  .glyph-serif { font-family: Georgia, 'Times New Roman', serif; }
  .tb-swatch { flex-direction: column; gap: 1px; padding-top: 4px; }
  .tb-swatch .bar { display: block; width: 16px; height: 4px; border: 1px solid rgba(0, 0, 0, 0.25); border-radius: 1px; }
  .tb-select {
    flex: 0 0 auto;
    min-height: 32px;
    padding: 2px 24px 2px 8px;
    font-size: 13px;
  }
  .tb-font { width: 120px; }
  .tb-size { width: 56px; }
  .sep { flex: 0 0 auto; width: 1px; height: 20px; margin: 0 3px; background: var(--border); }
  .phone-only { display: none; }

  .popover {
    position: absolute;
    top: calc(100% + 4px);
    z-index: 6;
    width: min(280px, 100%);
    padding: 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    box-shadow: var(--shadow-16, 0 8px 24px rgba(0, 0, 0, 0.18));
  }
  .swatch-auto {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 32px;
    margin-bottom: 8px;
    padding: 4px 8px;
    border-color: transparent;
    background: transparent;
    font-size: 13px;
    text-transform: none;
    letter-spacing: 0;
  }
  .swatch-auto:hover, .swatch-auto[aria-pressed='true'] { border-color: var(--border); background: var(--bg-hover); }
  .swatch-chip { width: 16px; height: 16px; border: 1px solid var(--border-strong); border-radius: 2px; }
  .swatch-chip.no-colour { background: linear-gradient(135deg, transparent 45%, #d13438 45%, #d13438 55%, transparent 55%), #ffffff; }
  .swatches { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
  .swatch {
    min-width: 0;
    height: 28px;
    padding: 0;
    border: 1px solid rgba(0, 0, 0, 0.25);
    border-radius: 3px;
  }
  .swatch:hover { outline: 2px solid var(--text-muted); outline-offset: 1px; }
  .swatch[aria-pressed='true'] { outline: 2px solid var(--primary); outline-offset: 2px; }
  .link-form { display: flex; flex-direction: column; gap: 6px; width: min(340px, 100%); }
  .link-form label { font-size: 12px; font-weight: 600; }
  .link-form input { width: 100%; }
  .link-error { margin: 0; color: var(--danger); font-size: 12px; }
  .link-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; margin-top: 4px; }

  .more-sheet { padding: 8px; border-top: 1px solid var(--border); }
  .sheet-row { margin-bottom: 6px; }
  .sheet-select { width: 100%; }
  .sheet-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); gap: 4px; }

  /* Email paper, like the signature editor: recipients read on white, so the
     writing surface stays white in dark mode too. Font, size and colour come
     from the person's defaults (inline style), as recipients will see them. */
  .surface-wrap { position: relative; color-scheme: light; background: #ffffff; border-radius: 0 0 var(--radius-md) var(--radius-md); }
  .host :global(.rich-text-surface) {
    min-height: 240px;
    max-height: 60vh;
    overflow-y: auto;
    padding: 12px 14px;
    outline: none;
    color: inherit;
    caret-color: #000000;
    font: inherit;
    line-height: 1.4;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
  .host :global(.rich-text-surface p) { margin: 0 0 0.6em; }
  .host :global(.rich-text-surface ul), .host :global(.rich-text-surface ol) { margin: 0 0 0.6em; padding-left: 1.6em; }
  .host :global(.rich-text-surface ul) { list-style: disc; }
  .host :global(.rich-text-surface ol) { list-style: decimal; }
  .host :global(.rich-text-surface ul ul) { list-style: circle; }
  .host :global(.rich-text-surface ul ul ul) { list-style: square; }
  .host :global(.rich-text-surface ol ol) { list-style: lower-alpha; }
  .host :global(.rich-text-surface li p) { margin: 0; }
  .host :global(.rich-text-surface blockquote) { margin: 0 0 0.6em; padding-left: 10px; border-left: 3px solid #d1d5db; color: #4b5563; }
  .host :global(.rich-text-surface a) { color: #0563c1; text-decoration: underline; }
  .placeholder { position: absolute; top: 12px; left: 14px; color: #6b6b6b; pointer-events: none; }
  .editor-state { margin: 0; padding: 12px 14px; color: #6b7280; font-size: 13px; font-family: var(--font-base, inherit); }
  .is-disabled .toolbar { opacity: 0.58; }
  .is-disabled .surface-wrap { cursor: not-allowed; }

  @media (max-width: 768px) {
    .host :global(.rich-text-surface) { min-height: 200px; max-height: none; }
  }
  @media (pointer: coarse), (max-width: 860px) {
    .toolbar { gap: 2px; padding: 2px 4px; }
    .tb, .tb-select { min-width: 44px; min-height: 44px; }
    .tb { padding: 3px 10px; font-size: 14px; }
    .swatch { height: 44px; }
    .swatch-auto { min-height: 44px; }
  }
  /* Phones: one sideways-scrolling row with the most-used controls and a
     More sheet for the rest, stuck to the top of the editor so it stays above
     the on-screen keyboard while typing. */
  @media (max-width: 599px) {
    .toolbar-wrap { position: sticky; top: 0; }
    .toolbar {
      flex-wrap: nowrap;
      overflow-x: auto;
      overscroll-behavior-x: contain;
      scrollbar-width: none;
    }
    .toolbar::-webkit-scrollbar { display: none; }
    .wide-only, .sep { display: none; }
    .phone-only { display: inline-flex; }
    select.phone-only { display: inline-block; }
    .tb { padding: 3px 6px; }
    .tb-size { width: 60px; }
    /* More stays pinned at the end of the row while the rest scrolls under it. */
    .more-button {
      position: sticky;
      right: 0;
      z-index: 1;
      margin-left: auto;
      background: var(--bg-subtle);
      box-shadow: -10px 0 8px -6px rgba(0, 0, 0, 0.18);
    }
    .popover { left: 8px !important; right: 8px; width: auto; }
  }
</style>
