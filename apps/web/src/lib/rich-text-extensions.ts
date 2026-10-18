// Loaded only with the editor (dynamic import from RichTextEditor.svelte).
//
// TipTap has no open-source indent extension, so paragraph indent is a small
// global attribute built on TipTap's own Extension API: it renders a bounded
// margin-left in fixed steps, which the compose sanitizer allows. Inside a
// list, indent and outdent use the list extension's own sink/lift commands.
// The second extension adds the Outlook shortcuts TipTap doesn't bind by
// default (Ctrl+K for a link, Ctrl+M and Ctrl+Shift+M for indent).

import { Extension } from '@tiptap/core';
import { COMPOSE_MAX_INDENT_LEVEL } from '@cmail/shared/compose-style';
import { indentLevelFromMargin, indentMargin } from './rich-text-format';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    composeIndent: {
      /** Indent the selected paragraphs, or nest the current list item. */
      indent: () => ReturnType;
      /** Outdent the selected paragraphs, or lift the current list item. */
      outdent: () => ReturnType;
    };
  }
}

const INDENT_TYPES = ['paragraph'];

function changeIndent(delta: number) {
  return ({ tr, state, dispatch }: { tr: import('@tiptap/pm/state').Transaction; state: import('@tiptap/pm/state').EditorState; dispatch?: (tr: import('@tiptap/pm/state').Transaction) => void }) => {
    let changed = false;
    const { from, to } = state.selection;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!INDENT_TYPES.includes(node.type.name)) return true;
      const current = Number(node.attrs.indent) || 0;
      const next = Math.max(0, Math.min(COMPOSE_MAX_INDENT_LEVEL, current + delta));
      if (next !== current) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
        changed = true;
      }
      return false;
    });
    if (changed && dispatch) dispatch(tr);
    return changed;
  };
}

export const ComposeIndent = Extension.create({
  name: 'composeIndent',

  addGlobalAttributes() {
    return [{
      types: INDENT_TYPES,
      attributes: {
        indent: {
          default: 0,
          parseHTML: (element: HTMLElement) => indentLevelFromMargin(element.style.marginLeft),
          renderHTML: (attributes: Record<string, unknown>) => {
            const margin = indentMargin(Number(attributes.indent) || 0);
            return margin ? { style: `margin-left: ${margin}` } : {};
          },
        },
      },
    }];
  },

  addCommands() {
    return {
      indent: () => (props) => {
        if (props.editor.isActive('listItem')) return props.commands.sinkListItem('listItem');
        return changeIndent(1)(props);
      },
      outdent: () => (props) => {
        if (props.editor.isActive('listItem')) return props.commands.liftListItem('listItem');
        return changeIndent(-1)(props);
      },
    };
  },
});

export interface OutlookShortcutOptions {
  onLink: () => void;
}

export const OutlookShortcuts = Extension.create<OutlookShortcutOptions>({
  name: 'outlookShortcuts',

  addOptions() {
    return { onLink: () => {} };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        this.options.onLink();
        return true;
      },
      'Mod-m': () => this.editor.commands.indent(),
      'Mod-Shift-m': () => this.editor.commands.outdent(),
    };
  },
});
