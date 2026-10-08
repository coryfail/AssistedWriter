import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { MarkdownDisplay } from "./markdown-display.mjs";
import { addTrackerEntry, deleteTrackerEntry, parseTracker,
  updateTrackerEntry, updateTrackerSegment } from "./tracker.mjs";
import {
  Bold,
  Italic,
  Strikethrough,
  Heading2,
  Heading3,
  Quote,
  List,
  ListOrdered,
  Undo2,
  Redo2,
  Plus,
  BookOpen,
  NotebookPen,
  Sparkles,
  ChevronUp,
  ChevronDown,
  FolderOpen,
  FileDown,
  X,
  Check,
  MessageCircle,
  SearchCheck,
  WandSparkles,
  PenLine,
  Settings2,
  ArrowLeft,
  LoaderCircle,
  Send,
  PanelRightClose,
  PanelRightOpen,
  Asterisk,
  GitBranch,
  GitCommitHorizontal,
  RefreshCw,
  Upload,
  Download,
  Trash2,
} from "lucide-react";
import "./style.css";

const api = window.writer;
const countWords = (value) =>
  (
    String(value || "")
      .trim()
      .match(/\S+/g) || []
  ).length;
const noteDestinationLabels = {
  book: "Book notes",
  chapter: "Chapter notes",
  characters: "Characters",
  locations: "Locations",
  timeline: "Timeline",
  terminology: "Terminology",
};

function FormattingToolbar({ editor, hint }) {
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

function MarkdownEditor({ value, onChange, children }) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: "",
    editorProps: { attributes: { spellcheck: "true", "aria-label": "Reference document" } },
    onUpdate: ({ editor: current }) => onChangeRef.current(current.getMarkdown()),
  });
  useEffect(() => {
    if (editor && value !== editor.getMarkdown())
      editor.chain().setContent(value, { contentType: "markdown", emitUpdate: false })
        .setMeta("addToHistory", false).run();
  }, [editor, value]);
  return children(editor);
}

function MarkdownReferenceEditor({ value, onChange, kicker, title, description }) {
  return <MarkdownEditor value={value} onChange={onChange}>{(editor) => <>
    <FormattingToolbar editor={editor} />
    <div className="notes-workspace"><div className="notes-page">
      <div className="page-kicker">{kicker}</div>
      <h1>{title}</h1>
      <p>{description}</p>
      <EditorContent editor={editor} className="reference-prose" />
    </div></div>
  </>}</MarkdownEditor>;
}

function TrackerEditor({ kind, value, onChange }) {
  const { entries, segments } = parseTracker(value);
  const [selectedId, setSelectedId] = useState(null);
  const selected = entries.find((entry) => entry.id === selectedId) || entries[0];
  const [draftName, setDraftName] = useState(selected?.name || "");
  useEffect(() => { setDraftName(selected?.name || ""); }, [selected?.id]);
  const label = kind === "characters" ? "character" : "location";
  const title = kind === "characters" ? "Characters" : "Locations";
  function add() {
    const id = crypto.randomUUID();
    onChange(addTrackerEntry(value, id, `New ${label}`));
    setSelectedId(id);
  }
  function remove() {
    if (!selected || !window.confirm(`Delete “${selected.name}” from ${title.toLowerCase()}?`)) return;
    onChange(deleteTrackerEntry(value, selected.id));
    setSelectedId(entries.find((entry) => entry.id !== selected.id)?.id || null);
  }
  return <div className="notes-workspace"><div className="notes-page tracker-page">
    <div className="page-kicker">STORY REFERENCE</div>
    <h1>{title}</h1>
    <p>Add a name and description for each {label}. These entries stay in the readable Markdown file.</p>
    <div className="tracker-head">
      <strong>{entries.length} {entries.length === 1 ? label : `${label}s`}</strong>
      <button onClick={add}><Plus size={15} /> Add {label}</button>
    </div>
    {entries.length > 0 && <div className="tracker-list">
      {entries.map((entry) => <button key={entry.id}
        className={selected?.id === entry.id ? "active" : ""}
        onClick={() => setSelectedId(entry.id)}>
        <strong>{entry.name}</strong>
        <span>{entry.description.replace(/[#*`>\n]/g, " ").trim() || "No description yet"}</span>
      </button>)}
    </div>}
    {selected && <div className="tracker-detail" key={selected.id}>
      <div className="tracker-detail-head">
        <strong>{label.toUpperCase()} DETAILS</strong>
        <button className="tracker-delete" onClick={remove}><Trash2 size={14} /> Delete</button>
      </div>
      <label htmlFor="tracker-name">Name</label>
      <input id="tracker-name" value={draftName}
        onChange={(event) => {
          setDraftName(event.target.value);
          if (event.target.value.trim()) onChange(updateTrackerEntry(value, selected.id,
            { name: event.target.value }));
        }}
        onBlur={() => { if (!draftName.trim()) setDraftName(selected.name); }} />
      <label>Description</label>
      <MarkdownEditor value={selected.description}
        onChange={(description) => onChange(updateTrackerEntry(value, selected.id, { description }))}>
        {(editor) => <>
          <FormattingToolbar editor={editor} />
          <EditorContent editor={editor} className="reference-prose tracker-description" />
        </>}
      </MarkdownEditor>
    </div>}
    {segments.map((segment, index) => {
      const hasLegacy = segment.text.replace(/^# [^\n]+/, "").trim();
      if (!hasLegacy && index !== 0) return null;
      return <details className="tracker-legacy" key={index} defaultOpen={Boolean(hasLegacy)}>
        <summary>{index === 0 ? "Other notes" : "Additional Markdown"}</summary>
        <p>Existing text is preserved here. You can keep using it alongside named entries.</p>
        <MarkdownEditor value={segment.text}
          onChange={(text) => onChange(updateTrackerSegment(value, segment.start, segment.end, text))}>
          {(editor) => <>
            <FormattingToolbar editor={editor} />
            <EditorContent editor={editor} className="reference-prose tracker-description" />
          </>}
        </MarkdownEditor>
      </details>;
    })}
  </div></div>;
}

function App() {
  const [book, setBook] = useState(null);
  const [recent, setRecent] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [section, setSection] = useState("write");
  const [sidePanel, setSidePanel] = useState("assist");
  const [panelOpen, setPanelOpen] = useState(true);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [referenceKind, setReferenceKind] = useState("book-context");
  const [referenceText, setReferenceText] = useState("");
  const [brainstormInput, setBrainstormInput] = useState("");
  const [brainstormMessages, setBrainstormMessages] = useState([]);
  const [aiPending, setAiPending] = useState(null);
  const [result, setResult] = useState(null);
  const [resultRevision, setResultRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState("Saved");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState(null);
  const [newTitle, setNewTitle] = useState("");
  const [newAuthor, setNewAuthor] = useState("");
  const [bookTitle, setBookTitle] = useState("");
  const [bookAuthor, setBookAuthor] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [update, setUpdate] = useState({ status: "idle" });
  const [gitState, setGitState] = useState(null);
  const [gitBusy, setGitBusy] = useState(false);
  const [gitMessageBusy, setGitMessageBusy] = useState(false);
  const [gitMessage, setGitMessage] = useState("");
  const [gitBranchName, setGitBranchName] = useState("");
  const [gitRemoteUrl, setGitRemoteUrl] = useState("");
  const [gitSelected, setGitSelected] = useState([]);
  const [gitDiff, setGitDiff] = useState(null);
  const selectedRef = useRef(null);
  const titleRef = useRef("");
  const rootRef = useRef(null);
  const timer = useRef(null);
  const notesTimer = useRef(null);
  const brainstormLastMessageRef = useRef(null);
  const reviewResultRef = useRef(null);
  useEffect(() => {
    brainstormLastMessageRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [brainstormMessages.length]);
  useEffect(() => {
    if (resultRevision) reviewResultRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [resultRevision]);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Markdown,
    ],
    content: "",
    editorProps: { attributes: { spellcheck: "true", "aria-label": "Manuscript" } },
    onUpdate: ({ editor }) => {
      setSaveState("Saving…");
      clearTimeout(timer.current);
      const root = rootRef.current,
        id = selectedRef.current,
        body = editor.getMarkdown(),
        currentTitle = titleRef.current;
      if (id)
        setBook((prev) =>
          prev
            ? {
                ...prev,
                chapters: prev.chapters.map((c) =>
                  c.id === id ? { ...c, body } : c,
                ),
              }
            : prev,
        );
      if (root && id)
        timer.current = setTimeout(async () => {
          try {
            await api.saveChapter(root, id, body, currentTitle);
            setSaveState("Saved");
          } catch (error) {
            setSaveState("Save failed");
            announce(error.message);
          }
        }, 650);
    },
  });

  useEffect(() => {
    api
      ?.recent()
      .then(setRecent)
      .catch(() => {});
    api
      ?.keyStatus()
      .then(setHasKey)
      .catch(() => {});
  }, []);
  useEffect(() => {
    const unsubscribe = api?.onUpdateStatus?.(setUpdate);
    api?.updateStatus?.().then(setUpdate).catch(() => {});
    return () => unsubscribe?.();
  }, []);
  useEffect(() => {
    const onKey = (event) => {
      if (!(event.metaKey || event.ctrlKey) || !book) return;
      const key = event.key.toLowerCase();
      if (key === "s") { event.preventDefault(); flush().catch((error) => announce(error.message)); }
      if (key === "1") { event.preventDefault(); chooseChapter(selectedRef.current); }
      if (key === "2") { event.preventDefault(); chooseBookNotes(); }
      if (key === "3") { event.preventDefault(); chooseReference("chapter-context"); }
      if (key === "\\") { event.preventDefault(); setPanelOpen((open) => !open); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [book, section, notes, referenceText, editor]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      clearTimeout(notesTimer.current);
    },
    [],
  );
  const current = book?.chapters.find((c) => c.id === selectedId);
  useEffect(() => {
    if (book?.root && sidePanel === "git") refreshGit(book.root);
  }, [book?.root, sidePanel]);

  async function refreshGit(root = book?.root) {
    if (!root) return;
    try {
      const state = await api.gitStatus(root);
      setGitState(state);
      setGitSelected(state.files?.map((file) => file.path) || []);
      setGitDiff(null);
    } catch (error) {
      announce(error.message);
    }
  }

  async function gitAction(action, success, reload = false) {
    if (gitBusy) return;
    setGitBusy(true);
    try {
      await flush();
      const state = await action();
      if (reload) showBook(await api.loadBook(book.root));
      setGitState(state);
      setGitSelected(state.files?.map((file) => file.path) || []);
      setGitDiff(null);
      if (success) announce(success);
    } catch (error) {
      announce(error.message);
      await refreshGit(book.root);
    } finally {
      setGitBusy(false);
    }
  }

  async function previewGitFile(file) {
    try {
      await flush();
      setGitDiff({ path: file, text: await api.gitDiff(book.root, file) });
    } catch (error) {
      announce(error.message);
    }
  }

  async function draftCommitMessage() {
    if (gitBusy || !gitSelected.length) return;
    if (!hasKey) { setModal("settings"); return; }
    setGitBusy(true);
    setGitMessageBusy(true);
    setAiPending("Drafting your commit message…");
    try {
      await flush();
      const draft = await api.generateCommitMessage(book.root, gitSelected);
      setGitMessage(draft.message);
      announce(draft.truncated
        ? "AI draft ready. Large diffs were shortened; review the message before committing."
        : "AI draft ready. Review it before committing.");
    } catch (error) { announce(error.message); }
    finally { setGitBusy(false); setGitMessageBusy(false); setAiPending(null); }
  }

  function announce(message) {
    setToast(message);
    setTimeout(() => setToast(""), 5000);
  }

  async function flush() {
    clearTimeout(timer.current);
    clearTimeout(notesTimer.current);
    if (!book || !selectedRef.current) return;
    if (section === "write" && editor)
      await api.saveChapter(
        rootRef.current,
        selectedRef.current,
        editor.getMarkdown(),
        titleRef.current,
      );
    if (section === "notes" || section === "book-notes") {
      const id = section === "book-notes" ? "book" : selectedRef.current;
      await api.saveNotes(rootRef.current, id, notes);
      if (id === "book") setBook((prev) => ({ ...prev, bookNotes: notes }));
      else
        setBook((prev) => ({
          ...prev,
          chapters: prev.chapters.map((c) =>
            c.id === id ? { ...c, notes } : c,
          ),
        }));
    }
    if (section === "reference") await api.saveReference(rootRef.current,
      referenceKind, selectedRef.current, referenceText);
    setSaveState("Saved");
  }

  function showBook(data) {
    if (!data) return;
    setBook(data);
    rootRef.current = data.root;
    setSelectedId(data.chapters[0]?.id || null);
    selectedRef.current = data.chapters[0]?.id || null;
    titleRef.current = data.chapters[0]?.title || "";
    setTitle(titleRef.current);
    setNotes(data.chapters[0]?.notes || "");
    editor?.commands.setContent(data.chapters[0]?.body || "", {
      contentType: "markdown",
      emitUpdate: false,
    });
    setResult(null);
    setBrainstormMessages([]);
    setBrainstormInput("");
    setGitState(null);
    setGitDiff(null);
    setSection("write");
    setSaveState("Saved");
    api
      .recent()
      .then(setRecent)
      .catch(() => {});
  }

  async function chooseChapter(id, nextSection = "write") {
    try {
      await flush();
      const latest = await api.loadBook(rootRef.current);
      setBook(latest);
      const chapter = latest.chapters.find((c) => c.id === id);
      if (!chapter) return;
      selectedRef.current = id;
      titleRef.current = chapter.title;
      setSelectedId(id);
      setTitle(chapter.title);
      setNotes(chapter.notes);
      setSection(nextSection);
      setResult(null);
      editor?.commands.setContent(chapter.body, {
        contentType: "markdown",
        emitUpdate: false,
      });
    } catch (error) {
      announce(error.message);
    }
  }

  async function chooseBookNotes() {
    try {
      await flush();
      const latest = await api.loadBook(rootRef.current);
      setBook(latest);
      setSection("book-notes");
      setNotes(latest.bookNotes);
      setResult(null);
    } catch (error) {
      announce(error.message);
    }
  }

  function referenceValue(data, kind, chapterId = selectedRef.current) {
    if (kind === "book-context") return data.aiContext || "";
    if (kind === "chapter-context") return data.chapters.find((c) => c.id === chapterId)?.context || "";
    return data.references?.[kind] || "";
  }

  async function chooseReference(kind) {
    try {
      await flush();
      const latest = await api.loadBook(rootRef.current);
      setBook(latest);
      setReferenceKind(kind);
      setReferenceText(referenceValue(latest, kind));
      setSection("reference");
      setResult(null);
    } catch (error) { announce(error.message); }
  }

  function changeReference(value) {
    setReferenceText(value);
    setSaveState("Saving…");
    clearTimeout(notesTimer.current);
    const root = rootRef.current, kind = referenceKind, id = selectedRef.current;
    notesTimer.current = setTimeout(async () => {
      try {
        await api.saveReference(root, kind, id, value);
        setBook((prev) => kind === "book-context" ? { ...prev, aiContext: value }
          : kind === "chapter-context" ? { ...prev, chapters: prev.chapters.map((c) =>
              c.id === id ? { ...c, context: value } : c) }
          : { ...prev, references: { ...prev.references, [kind]: value } });
        setSaveState("Saved");
      } catch (error) { setSaveState("Save failed"); announce(error.message); }
    }, 650);
  }

  function changeTitle(value) {
    setTitle(value);
    titleRef.current = value;
    setSaveState("Saving…");
    clearTimeout(timer.current);
    const root = rootRef.current,
      id = selectedRef.current,
      body = editor?.getMarkdown() || "";
    timer.current = setTimeout(async () => {
      try {
        const chapter = await api.saveChapter(root, id, body, value);
        setBook((prev) => ({
          ...prev,
          chapters: prev.chapters.map((c) =>
            c.id === id ? { ...c, title: chapter.title, body } : c,
          ),
        }));
        setSaveState("Saved");
      } catch (error) {
        setSaveState("Save failed");
        announce(error.message);
      }
    }, 650);
  }

  function changeNotes(value) {
    setNotes(value);
    setSaveState("Saving…");
    clearTimeout(notesTimer.current);
    const root = rootRef.current,
      id = section === "book-notes" ? "book" : selectedRef.current;
    notesTimer.current = setTimeout(async () => {
      try {
        await api.saveNotes(root, id, value);
        if (id === "book") setBook((prev) => ({ ...prev, bookNotes: value }));
        else
          setBook((prev) => ({
            ...prev,
            chapters: prev.chapters.map((c) =>
              c.id === id ? { ...c, notes: value } : c,
            ),
          }));
        setSaveState("Saved");
      } catch (error) {
        setSaveState("Save failed");
        announce(error.message);
      }
    }, 650);
  }

  async function createBook() {
    try {
      const data = await api.createBook(newTitle, newAuthor);
      showBook(data);
      if (data) setModal(null);
    } catch (error) {
      announce(error.message);
    }
  }

  function editBookDetails() {
    setBookTitle(book.manifest.title);
    setBookAuthor(book.manifest.author || "");
    setModal("book-details");
  }

  async function saveBookDetails() {
    try {
      await flush();
      const data = await api.saveMetadata(book.root, {
        title: bookTitle,
        author: bookAuthor,
      });
      setBook(data);
      setModal(null);
      announce("Book details saved.");
    } catch (error) {
      announce(error.message);
    }
  }

  async function openBook(path) {
    try {
      showBook(path ? await api.loadBook(path) : await api.openBook());
    } catch (error) {
      announce(error.message);
    }
  }

  async function addChapter() {
    try {
      await flush();
      const data = await api.addChapter(book.root);
      setBook(data);
      await chooseChapterAfterAdd(data);
    } catch (error) {
      announce(error.message);
    }
  }
  async function chooseChapterAfterAdd(data) {
    const chapter = data.chapters.at(-1);
    selectedRef.current = chapter.id;
    titleRef.current = chapter.title;
    setSelectedId(chapter.id);
    setTitle(chapter.title);
    setNotes(chapter.notes);
    setSection("write");
    setResult(null);
    editor?.commands.setContent(chapter.body, {
      contentType: "markdown",
      emitUpdate: false,
    });
  }

  async function moveChapter(id, direction) {
    try {
      await flush();
      setBook(await api.reorderChapter(book.root, id, direction));
    } catch (error) {
      announce(error.message);
    }
  }

  async function deleteChapter(chapter) {
    const confirmed = window.confirm(
      `Delete “${chapter.title}” and its chapter notes? This cannot be undone from Assisted Writer.`,
    );
    if (!confirmed) return;
    try {
      await flush();
      const data = await api.deleteChapter(book.root, chapter.id);
      const next =
        data.chapters.find((item) => item.id === selectedId) ||
        data.chapters[Math.max(0, data.chapters.length - 1)];
      setBook(data);
      if (selectedId === chapter.id) {
        selectedRef.current = next.id;
        titleRef.current = next.title;
        setSelectedId(next.id);
        setTitle(next.title);
        setNotes(next.notes);
        setSection("write");
        setResult(null);
        editor?.commands.setContent(next.body, {
          contentType: "markdown",
          emitUpdate: false,
        });
      }
      announce(`Deleted “${chapter.title}”.`);
    } catch (error) {
      announce(error.message);
    }
  }

  async function runReview(action) {
    if (!hasKey) {
      setModal("settings");
      return;
    }
    setPanelOpen(true);
    setSidePanel(action === "editor" ? "editor" : "assist");
    setAiPending(action === "ask" ? "Thinking through your question…"
      : action === "continuity" ? "Checking your story's continuity…"
      : action === "editor" ? "Editing your chapter…" : "Reviewing your chapter…");
    try {
      await flush();
      setBusy(true);
      setResult(null);
      const { from, to } = editor.state.selection;
      const selection = section === "write" ? editor.state.doc.textBetween(from, to, "\n") : "";
      const response = await api.review(book.root, {
        action,
        chapterId: selectedId,
        selection,
        question: "",
      });
      setResult(response);
      setResultRevision((value) => value + 1);
    } catch (error) {
      announce(error.message);
    } finally {
      setBusy(false);
      setAiPending(null);
    }
  }

  async function sendBrainstorm(noteRequested = false) {
    const prompt = brainstormInput.trim();
    if (!prompt && !noteRequested) return;
    if (!prompt && !brainstormMessages.length) return;
    if (!hasKey) {
      setModal("settings");
      return;
    }
    setPanelOpen(true);
    setSidePanel("assist");
    setAiPending(noteRequested ? "Thinking through a note with you…" : "Thinking through your idea…");
    try {
      await flush();
      setBusy(true);
      setResult(null);
      const { from, to } = editor.state.selection;
      const selection = section === "write" ? editor.state.doc.textBetween(from, to, "\n") : "";
      const userText = prompt || "Draft a note from our discussion.";
      const response = await api.review(book.root, {
        action: "brainstorm",
        chapterId: selectedId,
        selection,
        question: userText,
        noteRequested,
        history: brainstormMessages.map((message) => ({
          role: message.role,
          text: message.text + (message.notes?.length
            ? `\nProposed note: ${message.notes.map((note) => `${note.title}: ${note.content}`).join("; ")}`
            : ""),
        })),
      });
      setBrainstormMessages((previous) => [...previous,
        { id: crypto.randomUUID(), role: "user", text: userText },
        { id: crypto.randomUUID(), role: "assistant", text: response.summary,
          notes: response.notes,
          chapterId: response.chapterId },
      ]);
      setBrainstormInput("");
      setSidePanel("assist");
    } catch (error) {
      announce(error.message);
    } finally {
      setBusy(false);
      setAiPending(null);
    }
  }

  async function addProposedNote(note, messageId, index, chapterId) {
    try {
      await flush();
      setBusy(true);
      const target = note.target;
      const updated = await api.appendNote(book.root, target, chapterId, note);
      setBook(updated);
      if (target === "book" && section === "book-notes")
        setNotes(updated.bookNotes);
      if (target === "chapter" && section === "notes" && selectedId === chapterId)
        setNotes(updated.chapters.find((chapter) => chapter.id === chapterId).notes);
      if (section === "reference" && referenceKind === target)
        setReferenceText(updated.references[target]);
      setBrainstormMessages((previous) => previous.map((message) => message.id === messageId
        ? { ...message, notes: message.notes.filter((_, i) => i !== index) }
        : message));
      announce("Note added to the book folder.");
    } catch (error) {
      announce(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function approve(suggestion, index) {
    try {
      await flush();
      const applied = await api.approve(
        book.root,
        selectedId,
        suggestion.quote,
        suggestion.replacement,
        result.sourceHash,
      );
      editor.commands.setContent(applied.body, {
        contentType: "markdown",
        emitUpdate: false,
      });
      setBook((prev) => ({
        ...prev,
        chapters: prev.chapters.map((c) =>
          c.id === selectedId ? { ...c, body: applied.body } : c,
        ),
      }));
      setResult((prev) => ({
        ...prev,
        sourceHash: applied.hash,
        suggestions: prev.suggestions.filter((_, i) => i !== index),
      }));
      announce("Edit applied to the chapter.");
    } catch (error) {
      announce(error.message);
    }
  }

  async function exportFormat(format) {
    try {
      await flush();
      const destination = await api.export(book.root, format);
      if (destination)
        announce(`Exported ${format.toUpperCase()} to ${destination}`);
    } catch (error) {
      announce(error.message);
    }
  }

  async function checkForUpdates() {
    try {
      setUpdate(await api.checkForUpdates());
    } catch {
      setUpdate({ status: "error", message: "Could not check for updates right now. Try again." });
    }
  }

  async function downloadUpdate() {
    try {
      await api.downloadUpdate();
    } catch (error) {
      setUpdate({ status: "error", message: error.message });
    }
  }

  if (!book)
    return (
      <div className="welcome-shell">
        <div className="welcome-top">
          <div className="brand-mark">
            AW<span>✦</span>
          </div>
          <span>ASSISTED WRITER</span>
          <button className="welcome-settings" onClick={() => setModal("settings")}>
            <Settings2 size={17} /> Settings
          </button>
        </div>
        <main className="welcome-main">
          <div className="eyebrow">YOUR STORIES, YOUR WORDS</div>
          <h1>
            A calmer place
            <br />
            to write a book<span>.</span>
          </h1>
          <p>
            Write with focus. Keep every chapter in readable files. Invite an
            editorial second pair of eyes when you need one.
          </p>
          <div className="welcome-actions">
            <button className="primary" onClick={() => setModal("new")}>
              <Plus size={18} /> New book
            </button>
            <button className="secondary" onClick={() => openBook()}>
              <FolderOpen size={18} /> Open a book folder
            </button>
          </div>
          {recent.length > 0 && (
            <div className="recent">
              <div className="eyebrow">RECENT BOOKS</div>
              {recent.map((item) => (
                <button key={item} onClick={() => openBook(item)}>
                  <BookOpen size={18} />
                  <span>{item.split("/").at(-1)}</span>
                  <small>{item}</small>
                </button>
              ))}
            </div>
          )}
        </main>
        <div className="welcome-quote">
          “The first draft is you telling yourself the story.”{" "}
          <span>— Terry Pratchett</span>
        </div>
        {renderModal()}
      </div>
    );

  function renderModal() {
    if (!modal) return null;
    return (
      <div className="modal-backdrop" onMouseDown={() => setModal(null)}>
        <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
          <button className="icon modal-close" onClick={() => setModal(null)}>
            <X size={19} />
          </button>
          {modal === "new" ? (
            <>
              <div className="eyebrow">BEGIN A BOOK</div>
              <h2>Give your story a home.</h2>
              <p>
                A readable book folder will be created in the location you
                choose.
              </p>
              <label>
                Book title
                <input
                  autoFocus
                  value={newTitle}
                  onChange={(event) => setNewTitle(event.target.value)}
                  placeholder="Working title"
                />
              </label>
              <label>
                Author name
                <input
                  value={newAuthor}
                  onChange={(event) => setNewAuthor(event.target.value)}
                  placeholder="Your name"
                />
              </label>
              <button
                className="primary full"
                disabled={!newTitle.trim()}
                onClick={createBook}
              >
                Create book <Plus size={17} />
              </button>
            </>
          ) : modal === "book-details" ? (
            <>
              <div className="eyebrow">BOOK DETAILS</div>
              <h2>Edit this book</h2>
              <p>Update the title and author shown in the app and book exports.</p>
              <label>
                Book title
                <input autoFocus value={bookTitle}
                  onChange={(event) => setBookTitle(event.target.value)} />
              </label>
              <label>
                Author name
                <input value={bookAuthor}
                  onChange={(event) => setBookAuthor(event.target.value)} />
              </label>
              <button className="primary full" disabled={!bookTitle.trim()}
                onClick={saveBookDetails}>Save book details <Check size={17} /></button>
            </>
          ) : (
            <>
              <div className="eyebrow">PREFERENCES</div>
              <h2>Writing & AI</h2>
              <p>
                Your API key is encrypted with macOS Keychain protection and
                stays outside the book folder.
              </p>
              <div className="update-card">
                <div>
                  <strong>App updates</strong>
                  <span>
                    {update.status === "checking" && "Checking GitHub…"}
                    {update.status === "available" &&
                      `Version ${update.version} is ready to download.`}
                    {update.status === "downloading" &&
                      `Downloading update… ${update.percent || 0}%`}
                    {update.status === "downloaded" &&
                      `Version ${update.version} is ready to install.`}
                    {update.status === "installing" && "Restarting to install the update…"}
                    {update.status === "not-available" && "You are up to date."}
                    {update.status === "pending" &&
                      `Version ${update.version} is published. Waiting for GitHub's update feed; checking again automatically.`}
                    {update.status === "error" &&
                      (update.message || "Could not check for an update right now.")}
                    {!["checking", "available", "downloading", "downloaded", "installing", "not-available", "pending", "error"].includes(update.status) &&
                      "Updates come from the latest signed GitHub release."}
                  </span>
                </div>
                {update.status === "available" && (
                  <button className="secondary" onClick={downloadUpdate}>
                    Download update
                  </button>
                )}
                {update.status === "downloaded" && (
                  <button className="primary" onClick={() => api.installUpdate().catch((error) => setUpdate({ status: "error", message: error.message }))}>
                    Restart to update
                  </button>
                )}
                {!['available', 'downloading', 'downloaded', 'installing'].includes(update.status) && (
                  <button className="secondary" onClick={checkForUpdates}>
                    {update.status === "error" ? "Try again" : "Check now"}
                  </button>
                )}
              </div>
              {update.status === "downloading" && <progress className="update-progress" value={update.percent || 0} max="100" aria-label="Update download progress" />}
              <div className="shortcut-help"><strong>Keyboard shortcuts</strong><span>⌘S Save · ⌘1 Chapter · ⌘2 Book notes · ⌘3 Chapter context · ⌘\\ AI panel</span></div>
              <label>
                OpenAI API key
                <input
                  type="password"
                  value={keyInput}
                  onChange={(event) => setKeyInput(event.target.value)}
                  placeholder={
                    hasKey
                      ? "Key saved — enter a new one to replace it"
                      : "Paste your API key"
                  }
                />
              </label>
              <button
                className="primary full"
                onClick={async () => {
                  try {
                    if (keyInput) setHasKey(await api.setKey(keyInput));
                    setKeyInput("");
                    setModal(null);
                    announce("AI settings saved.");
                  } catch (error) {
                    announce(error.message);
                  }
                }}
              >
                Save settings <Check size={17} />
              </button>
              <button
                className="text-button"
                onClick={async () => {
                  await api.setKey("");
                  setHasKey(false);
                  setModal(null);
                  announce("API key removed.");
                }}
              >
                Remove saved key
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="library">
        <div className="library-head">
          <button
            className="book-switch"
            onClick={async () => {
              await flush();
              setBook(null);
              api.recent().then(setRecent);
            }}
          >
            <ArrowLeft size={16} />
            <span>Library</span>
          </button>
          <div className="brand-mark small">
            AW<span>✦</span>
          </div>
        </div>
        <div className="book-identity">
          <div className="book-identity-top">
            <span className="eyebrow">CURRENT MANUSCRIPT</span>
            <button title="Edit book title and author" aria-label="Edit book title and author"
              onClick={editBookDetails}><PenLine size={15} /></button>
          </div>
          <h2>{book.manifest.title}</h2>
          <p>{book.manifest.author || "Author name not set"}</p>
        </div>
        <div className="library-section">
          <div className="section-label">
            MANUSCRIPT{" "}
            <button title="Add chapter" onClick={addChapter}>
              <Plus size={17} />
            </button>
          </div>
          <div className="chapter-list">
            {book.chapters.map((chapter, i) => (
              <div
                className={`chapter-row ${selectedId === chapter.id && section !== "book-notes" ? "active" : ""}`}
                key={chapter.id}
              >
                <button
                  className="chapter-main"
                  onClick={() => chooseChapter(chapter.id)}
                >
                  <span className="chapter-num">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>{chapter.title}</span>
                </button>
                <span className="reorder">
                  <button
                    title="Move chapter up"
                    onClick={() => moveChapter(chapter.id, -1)}
                    disabled={i === 0}
                  >
                    <ChevronUp size={13} />
                  </button>
                  <button
                    title="Move chapter down"
                    onClick={() => moveChapter(chapter.id, 1)}
                    disabled={i === book.chapters.length - 1}
                  >
                    <ChevronDown size={13} />
                  </button>
                  <button
                    className="chapter-delete"
                    title="Delete chapter"
                    onClick={() => deleteChapter(chapter)}
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="library-section notes-section">
          <div className="section-label">REFERENCE</div>
          <button
            className={`reference-link ${section === "book-notes" ? "active" : ""}`}
            onClick={chooseBookNotes}
          >
            <NotebookPen size={17} /> Book notes
          </button>
          <button
            className={`reference-link ${section === "notes" ? "active" : ""}`}
            onClick={() => chooseChapter(selectedId, "notes")}
          >
            <PenLine size={17} /> Chapter notes
          </button>
          <div className="reference-subtitle">AI CONTEXT</div>
          {[["book-context", "Book context"], ["chapter-context", "Chapter context"]].map(([kind, label]) => (
            <button key={kind} className={`reference-link ${section === "reference" && referenceKind === kind ? "active" : ""}`}
              onClick={() => chooseReference(kind)}><Sparkles size={16} /> {label}</button>
          ))}
          <div className="reference-subtitle">STORY TRACKERS</div>
          {[["characters", "Characters"], ["locations", "Locations"], ["timeline", "Timeline"], ["terminology", "Terminology"]].map(([kind, label]) => (
            <button key={kind} className={`reference-link ${section === "reference" && referenceKind === kind ? "active" : ""}`}
              onClick={() => chooseReference(kind)}><BookOpen size={16} /> {label}</button>
          ))}
        </div>
        <div className="library-bottom">
          <button onClick={() => setModal("settings")}>
            <Settings2 size={17} /> Settings
          </button>
          <span>
            {countWords(
              book.chapters
                .map((c) =>
                  c.id === selectedId ? editor?.getText() || c.body : c.body,
                )
                .join(" "),
            ).toLocaleString()}{" "}
            words in book
          </span>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>{book.manifest.title}</span>
            <span className="slash">/</span>
            <strong>
              {section === "reference" ? referenceKind.replace(/-/g, " ").toUpperCase() : section === "book-notes"
                ? "Book notes"
                : section === "notes"
                  ? `${current?.title} notes`
                  : current?.title}
            </strong>
          </div>
          <div className="top-actions">
            <span className="save-state">
              <span
                className={
                  saveState === "Saved" ? "status-dot" : "status-dot pending"
                }
              ></span>
              {saveState}
            </span>
            {(["downloading", "downloaded"].includes(update.status)) && <button className="update-indicator" onClick={() => setModal("settings")}>
              {update.status === "downloading" ? `Update ${update.percent || 0}%` : "Update ready"}
            </button>}
            <div className="export-menu">
              <button className="light-button">
                <FileDown size={16} /> Export <ChevronDown size={14} />
              </button>
              <div className="export-options">
                <button onClick={() => exportFormat("docx")}>
                  Word document <small>.docx</small>
                </button>
                <button onClick={() => exportFormat("epub")}>
                  Kindle ebook <small>.epub</small>
                </button>
                <button onClick={() => exportFormat("pdf")}>
                  Print PDF <small>.pdf</small>
                </button>
              </div>
            </div>
            <button
              className="icon panel-toggle"
              title="Toggle AI panel"
              onClick={() => setPanelOpen(!panelOpen)}
            >
              {panelOpen ? (
                <PanelRightClose size={19} />
              ) : (
                <PanelRightOpen size={19} />
              )}
            </button>
          </div>
        </header>
        {section === "write" ? (
          <>
            <div className="editor-toolbar">
              <div className="tool-group">
                <button
                  title="Bold"
                  className={editor?.isActive("bold") ? "selected" : ""}
                  onClick={() => editor.chain().focus().toggleBold().run()}
                >
                  <Bold size={17} />
                </button>
                <button
                  title="Italic"
                  className={editor?.isActive("italic") ? "selected" : ""}
                  onClick={() => editor.chain().focus().toggleItalic().run()}
                >
                  <Italic size={17} />
                </button>
                <button title="Strikethrough" aria-label="Strikethrough" className={editor?.isActive("strike") ? "selected" : ""}
                  onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={17} /></button>
              </div>
              <div className="tool-separator" />
              <div className="tool-group">
                <button
                  title="Subheading"
                  className={
                    editor?.isActive("heading", { level: 2 }) ? "selected" : ""
                  }
                  onClick={() =>
                    editor.chain().focus().toggleHeading({ level: 2 }).run()
                  }
                >
                  <Heading2 size={18} />
                </button>
                <button
                  title="Scene break"
                  onClick={() =>
                    editor.chain().focus().setHorizontalRule().run()
                  }
                >
                  <Asterisk size={17} />
                </button>
                <button title="Smaller subheading" aria-label="Smaller subheading" className={editor?.isActive("heading", { level: 3 }) ? "selected" : ""}
                  onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 size={17} /></button>
                <button title="Block quote" aria-label="Block quote" className={editor?.isActive("blockquote") ? "selected" : ""}
                  onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={17} /></button>
                <button title="Bulleted list" aria-label="Bulleted list" className={editor?.isActive("bulletList") ? "selected" : ""}
                  onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={17} /></button>
                <button title="Numbered list" aria-label="Numbered list" className={editor?.isActive("orderedList") ? "selected" : ""}
                  onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={17} /></button>
              </div>
              <div className="tool-separator" />
              <div className="tool-group">
                <button
                  title="Undo"
                  onClick={() => editor.chain().focus().undo().run()}
                >
                  <Undo2 size={17} />
                </button>
                <button
                  title="Redo"
                  onClick={() => editor.chain().focus().redo().run()}
                >
                  <Redo2 size={17} />
                </button>
              </div>
              <span className="toolbar-hint">A SPACE FOR YOUR WORDS</span>
            </div>
            <div className="writing-scroll">
              <div className="page">
                <div className="page-kicker">
                  CHAPTER{" "}
                  {String(
                    book.chapters.findIndex((c) => c.id === selectedId) + 1,
                  ).padStart(2, "0")}
                </div>
                <input
                  className="chapter-title"
                  value={title}
                  onChange={(event) => changeTitle(event.target.value)}
                  aria-label="Chapter title"
                />
                <div className="chapter-rule" />
                <EditorContent editor={editor} className="prose-editor" />
                <div className="page-end">✦</div>
              </div>
            </div>
            <div className="writing-footer">
              <span>{countWords(editor?.getText() || "")} words</span>
              <span>Markdown saved in your book folder</span>
            </div>
          </>
        ) : (
          section === "reference" && ["characters", "locations"].includes(referenceKind)
            ? <TrackerEditor key={`${book.root}:${referenceKind}`} kind={referenceKind}
                value={referenceText} onChange={changeReference} />
            : <MarkdownReferenceEditor
            key={`${book.root}:${section}:${section === "reference" ? referenceKind : ""}:${selectedId}`}
            value={section === "reference" ? referenceText : notes}
            onChange={section === "reference" ? changeReference : changeNotes}
            kicker={section === "reference" ? "STORY REFERENCE" : section === "book-notes"
              ? "BOOK REFERENCE" : "CHAPTER REFERENCE"}
            title={section === "reference"
              ? referenceKind.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ")
              : section === "book-notes" ? "Book notes" : `${current?.title} notes`}
            description={section === "reference"
              ? "Readable Markdown shared with Codex and available to the in-app assistant when relevant."
              : section === "book-notes"
                ? "Characters, world details, ideas, and anything you want the assistant or Codex to remember."
                : "Plans, questions, continuity details, and reminders for this chapter."}
          />
        )}
      </main>
      {panelOpen && (
        <aside className={`ai-panel ${sidePanel === "git" ? "git-panel" : ""}`}
          aria-busy={Boolean(aiPending)}>
          <div className="ai-panel-head">
            <div className="ai-heading">
              <span className="ai-spark">
                {sidePanel === "git" ? (
                  <GitBranch size={18} />
                ) : (
                  <Sparkles size={18} />
                )}
              </span>
              <div>
                <span className="eyebrow">
                  {sidePanel === "git"
                    ? "BOOK REPOSITORY"
                    : "WRITING COMPANION"}
                </span>
                <h3>{sidePanel === "git" ? "Git desk" : "Editorial desk"}</h3>
              </div>
            </div>
            <button className="icon" onClick={() => setPanelOpen(false)}>
              <X size={18} />
            </button>
          </div>
          <div className="ai-tabs">
            <button
              className={sidePanel === "assist" ? "active" : ""}
              onClick={() => setSidePanel("assist")}
            >
              <MessageCircle size={16} /> Assistant
            </button>
            <button
              className={sidePanel === "editor" ? "active" : ""}
              onClick={() => setSidePanel("editor")}
            >
              <PenLine size={16} /> Editor mode
            </button>
            <button
              className={sidePanel === "git" ? "active" : ""}
              onClick={() => setSidePanel("git")}
            >
              <GitBranch size={16} /> Git
            </button>
          </div>
          <div className="ai-scroll">
            {sidePanel === "git" ? (
              <div className="git-content">
                {!gitState ? (
                  <div className="ai-busy">
                    <LoaderCircle className="spin" size={19} /> Checking book
                    repository…
                  </div>
                ) : !gitState.initialized ? (
                  <div className="git-empty">
                    <GitBranch size={25} />
                    <h4>Version this book</h4>
                    <p>
                      Set up a Git repository inside this book folder to track
                      chapters, notes, and editorial reports.
                    </p>
                    <button
                      className="editor-run"
                      disabled={gitBusy}
                      onClick={() =>
                        gitAction(
                          () => api.gitInit(book.root),
                          "Git is ready for this book.",
                        )
                      }
                    >
                      Set up Git
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="git-branch-head">
                      <span className="eyebrow">CURRENT BRANCH</span>
                      <button
                        className="icon"
                        title="Refresh Git status"
                        disabled={gitBusy}
                        onClick={() => refreshGit()}
                      >
                        <RefreshCw size={16} />
                      </button>
                    </div>
                    <select
                      className="git-select"
                      value={gitState.branch || ""}
                      disabled={gitBusy || !gitState.branch}
                      onChange={(event) =>
                        gitAction(
                          () => api.gitSwitch(book.root, event.target.value),
                          `Switched to ${event.target.value}.`,
                          true,
                        )
                      }
                    >
                      {!gitState.branch && (
                        <option value="">No commits yet</option>
                      )}
                      {gitState.branches.map((branch) => (
                        <option key={branch} value={branch}>
                          {branch}
                        </option>
                      ))}
                    </select>
                    <div className="git-tracking">
                      {gitState.upstream
                        ? `${gitState.upstream} · ${gitState.ahead} ahead, ${gitState.behind} behind`
                        : "No upstream branch yet"}
                    </div>
                    <div className="git-inline-form">
                      <input
                        aria-label="New branch name"
                        placeholder="New branch name"
                        value={gitBranchName}
                        onChange={(event) =>
                          setGitBranchName(event.target.value)
                        }
                      />
                      <button
                        disabled={gitBusy || !gitBranchName.trim()}
                        onClick={() =>
                          gitAction(
                            async () => {
                              const state = await api.gitCreateBranch(
                                book.root,
                                gitBranchName,
                              );
                              setGitBranchName("");
                              return state;
                            },
                            "Branch created.",
                            true,
                          )
                        }
                      >
                        Create
                      </button>
                    </div>
                    <div className="git-section-title">
                      <span>CHANGED FILES · {gitState.files.length}</span>
                    </div>
                    {gitState.files.length ? (
                      <div className="git-files">
                        {gitState.files.map((file) => (
                          <div className="git-file" key={file.path}>
                            <input
                              type="checkbox"
                              aria-label={`Include ${file.path} in commit`}
                              disabled={gitBusy}
                              checked={gitSelected.includes(file.path)}
                              onChange={(event) =>
                                setGitSelected((prev) =>
                                  event.target.checked
                                    ? [...prev, file.path]
                                    : prev.filter((name) => name !== file.path),
                                )
                              }
                            />
                            <button
                              title={`Preview ${file.path}`}
                              onClick={() => previewGitFile(file.path)}
                            >
                              <span>{file.path}</span>
                              <small>{file.code.trim() || "modified"}</small>
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="git-muted">Working tree clean.</p>
                    )}
                    {gitDiff && (
                      <div className="git-diff">
                        <div>
                          <strong>{gitDiff.path}</strong>
                          <button
                            className="icon"
                            onClick={() => setGitDiff(null)}
                          >
                            <X size={14} />
                          </button>
                        </div>
                        <pre>{gitDiff.text || "No text diff available."}</pre>
                      </div>
                    )}
                    <textarea
                      className="git-message"
                      aria-label="Commit message"
                      placeholder="Commit message"
                      value={gitMessage}
                      onChange={(event) => setGitMessage(event.target.value)}
                    />
                    <button className="git-generate" disabled={gitBusy || !gitSelected.length}
                      onClick={draftCommitMessage}>
                      {gitMessageBusy ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}
                      {gitMessageBusy ? "Drafting message…" : "Generate commit message with AI"}
                    </button>
                    <p className="git-muted">Uses only selected file changes. Review the draft before committing.</p>
                    <button
                      className="git-commit"
                      disabled={
                        gitBusy || !gitMessage.trim() || !gitSelected.length
                      }
                      onClick={() =>
                        gitAction(async () => {
                          const state = await api.gitCommit(
                            book.root,
                            gitMessage,
                            gitSelected,
                          );
                          setGitMessage("");
                          return state;
                        }, "Commit created.")
                      }
                    >
                      <GitCommitHorizontal size={16} /> Commit selected files
                    </button>
                    <div className="git-section-title">
                      <span>REMOTE</span>
                    </div>
                    {gitState.remote ? (
                      <p className="git-remote" title={gitState.remote}>
                        {gitState.remote}
                      </p>
                    ) : (
                      <div className="git-inline-form">
                        <input
                          aria-label="Origin remote URL"
                          placeholder="GitHub repository URL"
                          value={gitRemoteUrl}
                          onChange={(event) =>
                            setGitRemoteUrl(event.target.value)
                          }
                        />
                        <button
                          disabled={gitBusy || !gitRemoteUrl.trim()}
                          onClick={() =>
                            gitAction(
                              () => api.gitRemote(book.root, gitRemoteUrl),
                              "Origin remote added.",
                            )
                          }
                        >
                          Add
                        </button>
                      </div>
                    )}
                    <div className="git-sync">
                      <button
                        disabled={gitBusy || !gitState.remote}
                        onClick={() =>
                          gitAction(
                            () => api.gitSync(book.root, "fetch"),
                            "Fetched from origin.",
                          )
                        }
                      >
                        <RefreshCw size={15} /> Fetch
                      </button>
                      <button
                        disabled={
                          gitBusy || !gitState.remote || !gitState.upstream
                        }
                        onClick={() =>
                          gitAction(
                            () => api.gitSync(book.root, "pull"),
                            "Pulled latest commits.",
                            true,
                          )
                        }
                      >
                        <Download size={15} /> Pull
                      </button>
                      <button
                        disabled={
                          gitBusy || !gitState.remote || !gitState.branch
                        }
                        onClick={() =>
                          gitAction(
                            () => api.gitSync(book.root, "push"),
                            "Pushed branch.",
                          )
                        }
                      >
                        <Upload size={15} /> Push
                      </button>
                    </div>
                    <p className="scope-note">
                      Pull accepts fast-forward updates. Commit or resolve local
                      changes before switching branches or pulling. Git uses
                      your Mac’s configured credentials.
                    </p>
                  </>
                )}
              </div>
            ) : sidePanel === "assist" ? (
              <>
                <div className="assistant-intro">
                  <span className="eyebrow">WRITING PARTNER</span>
                  <h4>Talk through your story.</h4>
                  <p>Ask a question, test an idea, or decide what belongs in your notes.</p>
                </div>
                <div className="prompt-actions assistant-tools">
                  <button
                    onClick={() => runReview("chapter")}
                    disabled={busy || section !== "write"}
                  >
                    <SearchCheck size={18} />
                    <span>
                      <strong>Chapter review</strong>
                      <small>Pacing and clarity</small>
                    </span>
                  </button>
                  <button
                    onClick={() => runReview("continuity")}
                    disabled={busy || section !== "write"}
                  >
                    <BookOpen size={18} />
                    <span>
                      <strong>Continuity</strong>
                      <small>Names, dates, details</small>
                    </span>
                  </button>
                </div>
                <div className="brainstorm-box">
                  <div className="brainstorm-heading">
                    <label>CONVERSATION</label>
                    {brainstormMessages.length > 0 && <button className="brainstorm-clear"
                      disabled={busy} onClick={() => setBrainstormMessages([])}>New conversation</button>}
                  </div>
                  {brainstormMessages.length === 0 && <div className="brainstorm-empty">
                    <MessageCircle size={20} />
                    <p>What are you working through? The assistant will use your book and suggest notes when a detail is ready to keep.</p>
                  </div>}
                  {brainstormMessages.length > 0 && <div className="brainstorm-thread"
                    aria-label="Brainstorm conversation">
                    {brainstormMessages.map((message, index) => <div key={message.id}
                      ref={index === brainstormMessages.length - 1 ? brainstormLastMessageRef : null}
                      className={`brainstorm-message ${message.role}`}>
                      <strong>{message.role === "user" ? "You" : "Assistant"}</strong>
                      <MarkdownDisplay text={message.text} className="brainstorm-text" />
                      {message.notes?.map((note, i) => {
                        const existingEntry = note.entryId && ["characters", "locations"].includes(note.target)
                          ? parseTracker(book.references?.[note.target] || "").entries.find((entry) => entry.id === note.entryId)
                          : null;
                        return <div className="brainstorm-note" key={`${i}-${note.title}`}>
                        <strong>{note.entryId && !existingEntry ? "Entry changed · dismiss this suggestion" : existingEntry
                          ? `Update ${existingEntry.name} · ${noteDestinationLabels[note.target]}`
                          : `Suggested for ${noteDestinationLabels[note.target] || "notes"}`}</strong>
                        <b>{note.title}</b>
                        <MarkdownDisplay text={note.content} className="note-content" />
                        <div className="suggestion-actions">
                          <button className="apply" disabled={busy || Boolean(note.entryId && !existingEntry)} onClick={() =>
                            addProposedNote(note, message.id, i, message.chapterId)}>
                            <Check size={14} /> Approve & save
                          </button>
                          <button disabled={busy} onClick={() => setBrainstormMessages((previous) => previous.map((item) =>
                            item.id === message.id ? { ...item, notes: item.notes.filter((_, n) => n !== i) } : item))}>
                            <X size={14} /> Dismiss
                          </button>
                        </div>
                      </div>; })}
                    </div>)}
                  </div>}
                </div>
              </>
            ) : (
              <>
                <div className="editor-mode-hero">
                  <span className="mode-glyph">
                    <WandSparkles size={23} />
                  </span>
                  <div className="eyebrow">FINAL PASS EDITOR</div>
                  <h4>Polish without losing your voice.</h4>
                  <p>
                    Proofreading and copyedit suggestions appear below. Nothing
                    changes until you approve each edit.
                  </p>
                  <button
                    className="editor-run"
                    disabled={busy || section !== "write"}
                    onClick={() => runReview("editor")}
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <Sparkles size={17} />
                    )}{" "}
                    Review chapter
                  </button>
                </div>
                <div className="editor-rules">
                  <div>
                    <Check size={15} /> Exact before-and-after suggestions
                  </div>
                  <div>
                    <Check size={15} /> One approval per edit
                  </div>
                  <div>
                    <Check size={15} /> Reports saved as readable JSON
                  </div>
                </div>
              </>
            )}
            {sidePanel !== "git" && result && (
              <div className="review-result" ref={reviewResultRef}>
                <div className="result-heading">
                  <span className="eyebrow">
                    {result.action === "editor" ? "EDITOR REPORT" : "ASSISTANT RESPONSE"}
                  </span>
                  <button className="icon" onClick={() => setResult(null)}>
                    <X size={17} />
                  </button>
                </div>
                <MarkdownDisplay text={result.summary} className="result-summary" />
                {result.warnings?.length > 0 && <div className="result-group">
                  <h5>Continuity warnings <span>{result.warnings.length}</span></h5>
                  {result.warnings.map((warning, i) => <div className="finding" key={i}>
                    <strong>{warning.category.toUpperCase()}</strong>
                    <p>{warning.detail}</p>
                    <blockquote>{warning.evidence}</blockquote>
                  </div>)}
                </div>}
                {result.findings?.length > 0 && (
                  <div className="result-group">
                    <h5>Observations</h5>
                    {result.findings.map((finding, i) => (
                      <div className="finding" key={i}>
                        <strong>{finding.title}</strong>
                        <p>{finding.detail}</p>
                        {finding.quote && (
                          <blockquote>{finding.quote}</blockquote>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {result.suggestions?.length > 0 && (
                  <div className="result-group">
                    <h5>
                      Suggested edits <span>{result.suggestions.length}</span>
                    </h5>
                    {result.suggestions.map((suggestion, i) => (
                      <div
                        className="suggestion"
                        key={`${i}-${suggestion.quote}`}
                      >
                        <span className="suggestion-label">
                          {suggestion.category}
                        </span>
                        <div className="before">{suggestion.quote}</div>
                        <div className="after">{suggestion.replacement}</div>
                        <p>{suggestion.reason}</p>
                        <div className="suggestion-actions">
                          <button
                            className="apply"
                            onClick={() => approve(suggestion, i)}
                          >
                            <Check size={14} /> Apply edit
                          </button>
                          <button
                            onClick={() =>
                              setResult((prev) => ({
                                ...prev,
                                suggestions: prev.suggestions.filter(
                                  (_, n) => n !== i,
                                ),
                              }))
                            }
                          >
                            <X size={14} /> Dismiss
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="scope-note">
                  Read: {result.sent?.chapter}
                  {result.sent?.bookNotes ? ", book notes" : ""}
                  {result.sent?.chapterNotes ? ", chapter notes" : ""}
                  {result.sent?.bookContext ? ", book context" : ""}
                  {result.sent?.chapterContext ? ", chapter context" : ""}
                  {result.sent?.trackers ? ", story trackers" : ""}
                  {result.sent?.otherChapters ? ", other chapters" : ""}
                  {result.sent?.selection ? ", selected text" : ""}.
                </div>
              </div>
            )}
          </div>
          {sidePanel === "assist" && <div className="assistant-composer">
            <label htmlFor="assistant-message">YOUR MESSAGE</label>
            <textarea id="assistant-message" value={brainstormInput}
              onChange={(event) => setBrainstormInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  if (!busy && brainstormInput.trim()) sendBrainstorm(false);
                }
              }}
              placeholder="Tell me what you’re thinking about…"
              disabled={busy} aria-label="Your message to the assistant" />
            <div className="assistant-composer-actions">
              <button className="composer-suggest" onClick={() => sendBrainstorm(true)}
                disabled={busy || (!brainstormInput.trim() && !brainstormMessages.length)}>
                <NotebookPen size={15} /> Suggest notes
              </button>
              <button className="composer-send" onClick={() => sendBrainstorm(false)}
                disabled={busy || !brainstormInput.trim()}>
                <Send size={15} /> Send
              </button>
            </div>
            <small>The assistant chooses relevant files. You approve each note before it is saved.</small>
          </div>}
          <div className="ai-foot">
            {sidePanel === "git" ? (
              "Git runs in this book folder."
            ) : (
              <>
                <span className="privacy-dot" /> AI reads only when you ask.
                Edits need your approval.
              </>
            )}
          </div>
          {aiPending && <div className="ai-loading-overlay" role="status" aria-live="polite">
            <div className="ai-loading-message">
              <LoaderCircle className="spin" size={34} aria-hidden="true" />
              <strong>{aiPending}</strong>
              <span>Your writing stays in place while the assistant works.</span>
            </div>
          </div>}
        </aside>
      )}
      {renderModal()}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
