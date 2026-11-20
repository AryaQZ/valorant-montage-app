export type GlobalShortcutAction = 'undo' | 'redo' | 'save' | null;

export interface ShortcutEventLike {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
  key: string;
}

export interface ShortcutContext {
  busy: boolean;
  modalOpen: boolean;
  editableTarget: boolean;
}

const NON_TEXT_INPUT_TYPES = new Set([
  'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit',
]);

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as { tagName?: string; type?: string; isContentEditable?: boolean };
  if (el.isContentEditable) return true;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const type = typeof el.type === 'string' ? el.type.toLowerCase() : 'text';
    return !NON_TEXT_INPUT_TYPES.has(type);
  }
  return false;
}

export function resolveGlobalShortcut(event: ShortcutEventLike, context: ShortcutContext): GlobalShortcutAction {
  if (context.busy || context.modalOpen) return null;
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 's' && !event.shiftKey) return 'save';
  if (context.editableTarget) return null;
  if (key === 'z' && !event.shiftKey) return 'undo';
  if (key === 'y' || (key === 'z' && event.shiftKey)) return 'redo';
  return null;
}
