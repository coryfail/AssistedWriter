import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import {
  Bold,
  Italic,
  Heading2,
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
} from "lucide-react";
import "./style.css";

const api = window.writer;
const countWords = (value) =>
  (
    String(value || "")
      .trim()
      .match(/\S+/g) || []
  ).length;

function App() {
  const [book, setBook] = useState(null);
  const [recent, setRecent] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [section, setSection] = useState("write");
  const [sidePanel, setSidePanel] = useState("assist");
  const [panelOpen, setPanelOpen] = useState(true);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState("Saved");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState(null);
  const [newTitle, setNewTitle] = useState("");
  const [newAuthor, setNewAuthor] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [gitState, setGitState] = useState(null);
  const [gitBusy, setGitBusy] = useState(false);
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
  const writingScrollRef = useRef(null);
  const notesScrollRef = useRef(null);
  const dragRef = useRef({
    active: false,
    pointerId: null,
    x: 0,
    y: 0,
    left: 0,
    top: 0,
  });

  function beginPan(event) {
    if (event.button !== 0) return;
    const target = event.target;
    if (
      target.closest(
        "button, input, textarea, select, a, [contenteditable=\"true\"]",
      )
    ) {
      return;
    }
    const scroller = event.currentTarget;
    dragRef.current = {
      active: true,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: scroller.scrollLeft,
      top: scroller.scrollTop,
    };
    scroller.setPointerCapture(event.pointerId);
    scroller.classList.add("is-panning");
  }

  function pan(event) {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    const scroller = event.currentTarget;
    event.preventDefault();
    scroller.scrollLeft = drag.left - (event.clientX - drag.x);
    scroller.scrollTop = drag.top - (event.clientY - drag.y);
  }

  function endPan(event) {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    const scroller = event.currentTarget;
    if (scroller.hasPointerCapture(event.pointerId)) {
      scroller.releasePointerCapture(event.pointerId);
    }
    scroller.classList.remove("is-panning");
    dragRef.current.active = false;
    dragRef.current.pointerId = null;
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Markdown,
    ],
    content: "",
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

  async function runReview(action) {
    if (!hasKey) {
      setModal("settings");
      return;
    }
    try {
      await flush();
      setBusy(true);
      setResult(null);
      setPanelOpen(true);
      const { from, to } = editor.state.selection;
      const selection = editor.state.doc.textBetween(from, to, "\n");
      const response = await api.review(book.root, {
        action,
        chapterId: selectedId,
        selection,
        question,
      });
      setResult(response);
      setSidePanel(action === "editor" ? "editor" : "assist");
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

  if (!book)
    return (
      <div className="welcome-shell">
        <div className="welcome-top">
          <div className="brand-mark">
            AW<span>✦</span>
          </div>
          <span>ASSISTED WRITER</span>
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
          ) : (
            <>
              <div className="eyebrow">PREFERENCES</div>
              <h2>Writing & AI</h2>
              <p>
                Your API key is encrypted with macOS Keychain protection and
                stays outside the book folder.
              </p>
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
          <span className="eyebrow">CURRENT MANUSCRIPT</span>
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
              {section === "book-notes"
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
            <div
              ref={writingScrollRef}
              className="writing-scroll"
              onPointerDown={beginPan}
              onPointerMove={pan}
              onPointerUp={endPan}
              onPointerCancel={endPan}
              onLostPointerCapture={endPan}
            >
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
          <div
            ref={notesScrollRef}
            className="notes-workspace"
            onPointerDown={beginPan}
            onPointerMove={pan}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            onLostPointerCapture={endPan}
          >
            <div className="notes-page">
              <div className="page-kicker">
                {section === "book-notes"
                  ? "BOOK REFERENCE"
                  : "CHAPTER REFERENCE"}
              </div>
              <h1>
                {section === "book-notes"
                  ? "Book notes"
                  : `${current?.title} notes`}
              </h1>
              <p>
                {section === "book-notes"
                  ? "Characters, world details, ideas, and anything you want the assistant or Codex to remember."
                  : "Plans, questions, continuity details, and reminders for this chapter."}
              </p>
              <textarea
                spellCheck
                value={notes}
                onChange={(event) => changeNotes(event.target.value)}
                aria-label="Notes in Markdown"
                placeholder="Write your notes here in Markdown…"
              />
            </div>
          </div>
        )}
      </main>
      {panelOpen && (
        <aside className={`ai-panel ${sidePanel === "git" ? "git-panel" : ""}`}>
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
                <div className="ai-intro">
                  <div className="intro-icon">
                    <Sparkles size={22} />
                  </div>
                  <h4>A second pair of eyes, when you want one.</h4>
                  <p>
                    Select a passage or work with the whole chapter. Your
                    manuscript stays yours.
                  </p>
                </div>
                <div className="prompt-actions">
                  <button
                    onClick={() => runReview("chapter")}
                    disabled={busy || section !== "write"}
                  >
                    <SearchCheck size={18} />
                    <span>
                      <strong>Review this chapter</strong>
                      <small>Pacing, clarity, character, repetition</small>
                    </span>
                  </button>
                  <button
                    onClick={() => runReview("continuity")}
                    disabled={busy || section !== "write"}
                  >
                    <BookOpen size={18} />
                    <span>
                      <strong>Check continuity</strong>
                      <small>Compare notes and other chapters</small>
                    </span>
                  </button>
                </div>
                <p className="scope-preview">
                  Requests include this chapter, its notes, book notes, and book
                  instructions. Continuity also includes other chapters.
                </p>
                <div className="ask-box">
                  <label>ASK ABOUT YOUR WRITING</label>
                  <textarea
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder="What isn't working in this scene?"
                  />
                  <button
                    onClick={() => runReview("ask")}
                    disabled={busy || !question.trim() || section !== "write"}
                  >
                    <Send size={16} /> Ask assistant
                  </button>
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
                <p className="scope-preview">
                  The editor reads this chapter, its notes, book notes, and book
                  instructions when you run a review.
                </p>
              </>
            )}
            {sidePanel !== "git" && busy && (
              <div className="ai-busy">
                <LoaderCircle className="spin" size={20} /> Reading your
                chapter…
              </div>
            )}
            {sidePanel !== "git" && result && (
              <div className="review-result">
                <div className="result-heading">
                  <span className="eyebrow">
                    {result.action === "editor"
                      ? "EDITOR REPORT"
                      : "ASSISTANT RESPONSE"}
                  </span>
                  <button className="icon" onClick={() => setResult(null)}>
                    <X size={17} />
                  </button>
                </div>
                <p className="result-summary">{result.summary}</p>
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
                  Read: {result.sent?.chapter}, book notes, chapter notes
                  {result.sent?.otherChapters ? ", other chapters" : ""}
                  {result.sent?.selection ? ", selected text" : ""}.
                </div>
              </div>
            )}
          </div>
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
        </aside>
      )}
      {renderModal()}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
