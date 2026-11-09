import React from "react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { Bold, Italic, Strikethrough, Heading2, Heading3, Asterisk, Quote,
  List, ListOrdered, Undo2, Redo2 } from "lucide-react";

export const manuscriptExtensions = () => [
  StarterKit.configure({ heading: { levels: [2, 3] } }), Markdown,
];

export function FormattingToolbar({ editor, hint }) {
  return <div className="editor-toolbar">
    <div className="tool-group">
      <button title="Bold" aria-label="Bold" disabled={!editor}
        className={editor?.isActive("bold") ? "selected" : ""}
        onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={17} /></button>
      <button title="Italic" aria-label="Italic" disabled={!editor}
        className={editor?.isActive("italic") ? "selected" : ""}
        onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={17} /></button>
      <button title="Strikethrough" aria-label="Strikethrough" disabled={!editor}
        className={editor?.isActive("strike") ? "selected" : ""}
        onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={17} /></button>
    </div>
    <div className="tool-separator" />
    <div className="tool-group">
      <button title="Subheading" aria-label="Subheading" disabled={!editor}
        className={editor?.isActive("heading", { level: 2 }) ? "selected" : ""}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={18} /></button>
      <button title="Scene break" aria-label="Scene break" disabled={!editor}
        onClick={() => editor.chain().focus().setHorizontalRule().run()}><Asterisk size={17} /></button>
      <button title="Smaller subheading" aria-label="Smaller subheading" disabled={!editor}
        className={editor?.isActive("heading", { level: 3 }) ? "selected" : ""}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 size={17} /></button>
      <button title="Block quote" aria-label="Block quote" disabled={!editor}
        className={editor?.isActive("blockquote") ? "selected" : ""}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={17} /></button>
      <button title="Bulleted list" aria-label="Bulleted list" disabled={!editor}
        className={editor?.isActive("bulletList") ? "selected" : ""}
        onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={17} /></button>
      <button title="Numbered list" aria-label="Numbered list" disabled={!editor}
        className={editor?.isActive("orderedList") ? "selected" : ""}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={17} /></button>
    </div>
    <div className="tool-separator" />
    <div className="tool-group">
      <button title="Undo" aria-label="Undo" disabled={!editor}
        onClick={() => editor.chain().focus().undo().run()}><Undo2 size={17} /></button>
      <button title="Redo" aria-label="Redo" disabled={!editor}
        onClick={() => editor.chain().focus().redo().run()}><Redo2 size={17} /></button>
    </div>
    {hint && <span className="toolbar-hint">{hint}</span>}
  </div>;
}
