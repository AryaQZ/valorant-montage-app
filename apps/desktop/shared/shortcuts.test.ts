import { describe, expect, it } from 'vitest';
import { isEditableShortcutTarget, resolveGlobalShortcut } from './shortcuts.js';

describe('global editor shortcuts', () => {
  it('resolves undo, redo, and save in normal editor focus', () => {
    const idle = { busy: false, modalOpen: false, editableTarget: false };
    expect(resolveGlobalShortcut({ ctrlKey: true, metaKey: false, shiftKey: false, key: 'z' }, idle)).toBe('undo');
    expect(resolveGlobalShortcut({ ctrlKey: true, metaKey: false, shiftKey: false, key: 'y' }, idle)).toBe('redo');
    expect(resolveGlobalShortcut({ ctrlKey: true, metaKey: false, shiftKey: true, key: 'Z' }, idle)).toBe('redo');
    expect(resolveGlobalShortcut({ ctrlKey: true, metaKey: false, shiftKey: false, key: 's' }, idle)).toBe('save');
  });

  it('does not hijack undo/redo inside text or numeric inputs while still allowing Ctrl+S', () => {
    const inInput = { busy: false, modalOpen: false, editableTarget: true };
    expect(resolveGlobalShortcut({ ctrlKey: true, metaKey: false, shiftKey: false, key: 'z' }, inInput)).toBeNull();
    expect(resolveGlobalShortcut({ ctrlKey: true, metaKey: false, shiftKey: false, key: 'y' }, inInput)).toBeNull();
    expect(resolveGlobalShortcut({ ctrlKey: true, metaKey: false, shiftKey: true, key: 'z' }, inInput)).toBeNull();
    expect(resolveGlobalShortcut({ ctrlKey: true, metaKey: false, shiftKey: false, key: 's' }, inInput)).toBe('save');
  });

  it('blocks shortcuts when a modal dialog is open, during busy tasks, or with AltGr', () => {
    expect(resolveGlobalShortcut({ ctrlKey: true, metaKey: false, shiftKey: false, key: 'z' },
      { busy: false, modalOpen: true, editableTarget: false })).toBeNull();
    expect(resolveGlobalShortcut({ ctrlKey: true, metaKey: false, shiftKey: false, key: 's' },
      { busy: false, modalOpen: true, editableTarget: false })).toBeNull();
    expect(resolveGlobalShortcut({ ctrlKey: true, metaKey: false, shiftKey: false, key: 'z' },
      { busy: true, modalOpen: false, editableTarget: false })).toBeNull();
    expect(resolveGlobalShortcut({ ctrlKey: true, metaKey: false, shiftKey: false, altKey: true, key: 'z' },
      { busy: false, modalOpen: false, editableTarget: false })).toBeNull();
  });

  it('classifies text/number inputs and textareas as editable targets, but not checkboxes or range sliders', () => {
    expect(isEditableShortcutTarget({ tagName: 'INPUT', type: 'number' } as unknown as EventTarget)).toBe(true);
    expect(isEditableShortcutTarget({ tagName: 'INPUT', type: 'text' } as unknown as EventTarget)).toBe(true);
    expect(isEditableShortcutTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(isEditableShortcutTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isEditableShortcutTarget({ tagName: 'INPUT', type: 'checkbox' } as unknown as EventTarget)).toBe(false);
    expect(isEditableShortcutTarget({ tagName: 'INPUT', type: 'range' } as unknown as EventTarget)).toBe(false);
    expect(isEditableShortcutTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false);
  });
});
