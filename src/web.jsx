import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorContent, useEditor } from "@tiptap/react";
import { ArrowRight, BookOpen, ChevronDown, Download, LogOut, Radio } from "lucide-react";
import { FormattingToolbar, manuscriptExtensions } from "./manuscript-editor.jsx";
import { clearDraft, downloadDraft, readDraft, storeDraft } from "./drafts.mjs";
import { browserRelay } from "./relay-browser.mjs";
import "./style.css";
import "./web.css";

const remoteLink = browserRelay();

async function request(path, method = "GET", body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  const unreachable = "Can’t reach the desktop. Check that it’s awake and Web Access is on.";
  try {
    if (remoteLink) {
      try { return await remoteLink.request(path, method, body, controller.signal); }
      catch (error) {
        if (error.status) throw error;
        throw new Error(unreachable);
      }
    }
    let response;
    try {
      response = await fetch(path, {
        method, signal: controller.signal, credentials: "same-origin",
        ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
    } catch { throw new Error(unreachable); }
    const data = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error(data?.error || (response.status >= 500
      ? unreachable : "The request did not complete.")), { status: response.status });
    if (!data) throw new Error(unreachable);
    return data;
  } finally { clearTimeout(timeout); }
}

const chapterPath = (id) => "/api/chapters/" + encodeURIComponent(id);
const needsSource = (body) => /<\/?[a-z][^>]*>|<!--|!\[|^\s*(?:#|#{4,6}) |^\s*\|.*\||^\s*:?-{3,}:?\s*\||^\s*[-*+] \[[ xX]\]|\[\^[^\]]+\]/im.test(body);

function Wordmark() {
  return <div className="web-wordmark"><span className="brand-mark">AW<span>✦</span></span> Assisted Writer</div>;
}

function PairForm({ onPair, dismiss }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <form className="web-pair-form" onSubmit={async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await request("/api/pair", "POST", { code });
      await onPair();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }}>
    <label htmlFor="pair-code">Pairing code</label>
    <p>Find the eight-digit code under <strong>Web Access</strong> on your desktop.</p>
    <input id="pair-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
      placeholder="00000000" autoComplete="one-time-code" inputMode="numeric" maxLength={8} />
    {error && <p className="web-error" role="alert">{error}</p>}
    <button className="web-primary" disabled={code.length !== 8 || busy}>
      {busy ? "Pairing…" : "Pair this browser"} <ArrowRight size={18} />
    </button>
    {dismiss && <button className="web-quiet" type="button" onClick={dismiss}>Back to draft</button>}
  </form>;
}

const Manuscript = forwardRef(function Manuscript({ bookId, chapter, locked, onUnauthorized }, ref) {
  const [recovery] = useState(() => {
    const draft = readDraft("browser", bookId, chapter.id);
    if (draft?.body.trim() === chapter.body) return null;
    return draft;
  });
  const saved = useRef(chapter);
  const draft = useRef(recovery);
  const writing = useRef(null);
  const timer = useRef(null);
  const [version, setVersion] = useState(chapter);
  const [source, setSource] = useState(() => needsSource(recovery?.body ?? chapter.body));
  const [text, setText] = useState(recovery?.body ?? chapter.body);
  const [conflict, setConflict] = useState(Boolean(recovery &&
    (recovery.revision !== chapter.revision || recovery.manifestRevision !== chapter.manifestRevision)));
  const [message, setMessage] = useState(recovery ? "Draft recovered" : "Saved to desktop");
  const [error, setError] = useState("");
  const [storageWarning, setStorageWarning] = useState(false);
  const [dirty, setDirty] = useState(Boolean(recovery));
  const [saving, setSaving] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [comparison, setComparison] = useState(null);
  const [discard, setDiscard] = useState(false);
  const editor = useEditor({
    extensions: manuscriptExtensions(),
    content: recovery?.body ?? chapter.body,
    contentType: "markdown",
    editorProps: { attributes: { spellcheck: "true", "aria-label": "Manuscript" } },
    onUpdate: ({ editor: current }) => change(current.getMarkdown()),
  });

  useEffect(() => {
    if (!recovery && readDraft("browser", bookId, chapter.id)?.body.trim() === chapter.body)
      clearDraft("browser", bookId, chapter.id);
  }, [bookId, chapter.id, chapter.body, recovery]);
  useEffect(() => { editor?.setEditable(!locked); }, [editor, locked]);

  function persist(value) {
    setStorageWarning(!storeDraft("browser", bookId, chapter.id, value));
  }

  function change(body) {
    setText(body);
    setError("");
    clearTimeout(timer.current);
    if (!conflict && !writing.current && body.trim() === saved.current.body) {
      draft.current = null;
      clearDraft("browser", bookId, chapter.id);
      setDirty(false);
      setStorageWarning(false);
      setMessage("Saved to desktop");
      return;
    }
    draft.current = {
      revision: saved.current.revision, manifestRevision: saved.current.manifestRevision,
      title: saved.current.title, ...draft.current, body,
    };
    persist(draft.current);
    setDirty(true);
    if (conflict) return;
    setMessage("Unsaved changes");
    timer.current = setTimeout(() => save().catch(() => {}), 750);
  }

  function report(error) {
    setError(error.message);
    if (error.status === 401) onUnauthorized();
  }

  async function save() {
    while (writing.current) await writing.current;
    const pending = draft.current;
    if (!pending) return;
    if (conflict) throw new Error("Resolve the chapter conflict before continuing.");
    setSaving(true);
    setMessage("Saving…");
    setError("");
    const operation = (async () => {
      try {
        const next = await request(chapterPath(chapter.id), "PUT", {
          body: pending.body, revision: pending.revision, manifestRevision: pending.manifestRevision,
        });
        saved.current = next;
        setVersion(next);
        if (draft.current === pending) {
          draft.current = null;
          clearDraft("browser", bookId, chapter.id);
          setDirty(false);
          setStorageWarning(false);
          setMessage("Saved to desktop");
        } else if (draft.current) {
          draft.current = { ...draft.current, revision: next.revision, manifestRevision: next.manifestRevision };
          persist(draft.current);
          setMessage("Unsaved changes");
        }
      } catch (failure) {
        clearTimeout(timer.current);
        if (failure.status === 409 || failure.status === 404) setConflict(true);
        setMessage("Not saved to desktop");
        report(failure);
        throw failure;
      }
    })();
    writing.current = operation;
    try { await operation; }
    finally {
      if (writing.current === operation) writing.current = null;
      setSaving(false);
    }
  }

  async function flush() {
    clearTimeout(timer.current);
    while (draft.current || writing.current) await save();
  }

  useImperativeHandle(ref, () => ({ flush, hasDraft: () => Boolean(draft.current) }));

  function showSaved(next) {
    saved.current = next;
    setVersion(next);
    setText(next.body);
    if (needsSource(next.body)) setSource(true);
    editor?.commands.setContent(next.body, { contentType: "markdown", emitUpdate: false });
    setMessage("Saved to desktop");
  }

  useEffect(() => {
    let live = true;
    async function refresh() {
      if (draft.current || writing.current || document.visibilityState === "hidden") return;
      const previous = saved.current;
      try {
        const next = await request(chapterPath(chapter.id));
        if (live && !draft.current && !writing.current && saved.current === previous &&
            (next.revision !== previous.revision || next.manifestRevision !== previous.manifestRevision)) showSaved(next);
      } catch (failure) {
        if (live && failure.status === 401) onUnauthorized();
      }
    }
    const interval = setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);
    return () => { live = false; clearInterval(interval); window.removeEventListener("focus", refresh); };
  }, [chapter.id, editor, onUnauthorized]);

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function compare() {
    setComparing(true);
    setError("");
    try { setComparison(await request(chapterPath(chapter.id))); }
    catch (failure) { report(failure); }
    finally { setComparing(false); }
  }

  async function useSaved() {
    setComparing(true);
    try {
      const next = await request(chapterPath(chapter.id));
      clearDraft("browser", bookId, chapter.id);
      draft.current = null;
      setDirty(false);
      setStorageWarning(false);
      setConflict(false);
      setError("");
      setComparison(null);
      setDiscard(false);
      showSaved(next);
    } catch (failure) {
      if (failure.status === 404) {
        // The parent refreshes the chapter list when the user chooses another chapter.
        clearDraft("browser", bookId, chapter.id);
        draft.current = null;
        setDirty(false);
        setStorageWarning(false);
        setConflict(false);
        setDiscard(false);
        setMessage("Chapter removed on desktop");
        setError("Choose another chapter to continue.");
      } else report(failure);
    } finally { setComparing(false); }
  }

  function toggleSource() {
    const body = draft.current?.body ?? saved.current.body;
    if (source && needsSource(body)) return;
    if (source) editor?.commands.setContent(body, { contentType: "markdown", emitUpdate: false });
    setText(body);
    setSource(!source);
  }

  return <>
    <div className="web-write-tools">
      {!source && <FormattingToolbar editor={locked ? null : editor} />}
      <button className="web-quiet web-source-switch" onClick={toggleSource}
        disabled={source && needsSource(text)}>{source ? "Formatted view" : "Markdown source"}</button>
    </div>
    <article className="web-paper" aria-label="Writing workspace">
      <div className="web-paper-meta"><span>MANUSCRIPT</span><span>✦</span></div>
      <h1>{version.title}</h1>
      <div className="web-save-bar">
        <span role="status" aria-live="polite">{message}</span>
        <button className="web-quiet" disabled={!dirty || saving || conflict || locked}
          onClick={() => flush().catch(() => {})}>Save now</button>
      </div>
      {source && needsSource(text) && <p className="web-subtle">Markdown source keeps this chapter’s formatting intact.</p>}
      {storageWarning && <p className="web-error" role="alert">This browser couldn’t keep a recovery copy. Download your draft before leaving.</p>}
      {error && !conflict && <p className="web-error" role="alert">{error}</p>}
      {conflict && <section className="web-conflict" aria-label="Chapter conflict">
        <strong>The saved chapter changed.</strong>
        <p>Your draft is still below. Review the saved text or download your draft before opening the saved version.</p>
        {error && <p className="web-error" role="alert">{error}</p>}
        <div className="web-conflict-actions">
          <button className="web-quiet" onClick={compare} disabled={comparing}>{comparing ? "Checking…" : "Review saved text"}</button>
          <button className="web-quiet" onClick={() => downloadDraft(version.title, draft.current?.body ?? text)}><Download size={15} /> Download draft</button>
          <button className="web-quiet" onClick={() => setDiscard(true)}>Open saved chapter</button>
        </div>
        {comparison && <pre aria-label="Saved chapter text">{comparison.body || "This chapter is blank."}</pre>}
        {discard && <div className="web-discard">
          <p>Discard the browser draft? Download it first to keep a copy.</p>
          <button className="web-quiet" onClick={() => setDiscard(false)}>Keep draft</button>
          <button className="web-quiet" onClick={useSaved} disabled={comparing}>Discard draft</button>
        </div>}
      </section>}
      {source ? <textarea className="web-source" aria-label="Manuscript Markdown" value={text} readOnly={locked}
        onChange={(event) => change(event.target.value)} spellCheck /> : <EditorContent editor={editor} className="prose-editor web-prose" />}
      <footer className="web-paper-footer">
        <span>{(text.trim().match(/\S+/g) || []).length.toLocaleString()} words</span>
        {dirty && !conflict && <button className="web-quiet" onClick={() => downloadDraft(version.title, draft.current?.body ?? text)}><Download size={15} /> Download draft</button>}
      </footer>
    </article>
  </>;
});

function Workspace({ book, updateBook, logout, onUnauthorized }) {
  const [chapter, setChapter] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const writer = useRef(null);
  const loading = useRef(false);

  useEffect(() => {
    if (!book.chapters.length) return;
    let live = true;
    request(chapterPath(book.chapters[0].id)).then((data) => { if (live) setChapter(data); }).catch((failure) => {
      if (!live) return;
      if (failure.status === 401) onUnauthorized();
      setError(failure.message);
    });
    return () => { live = false; };
  }, [book.id]);

  async function run(action) {
    if (loading.current) return;
    loading.current = true;
    setBusy(true);
    setError("");
    try {
      await writer.current?.flush();
      await action();
    } catch (failure) {
      if (failure.status === 401) onUnauthorized();
      setError(failure.message);
    } finally {
      loading.current = false;
      setBusy(false);
    }
  }

  function open(id) {
    run(async () => setChapter(await request(chapterPath(id))));
  }

  function refreshChapters() {
    run(async () => {
      const latest = await request("/api/book");
      if (latest.id !== book.id) {
        updateBook(latest);
        return;
      }
      updateBook(latest);
      if (!latest.chapters.some((entry) => entry.id === chapter?.id)) {
        setChapter(latest.chapters.length ? await request(chapterPath(latest.chapters[0].id)) : null);
      }
    });
  }

  return <main className="web-workspace">
    <header className="web-header"><Wordmark /><button className="web-quiet" onClick={() => run(logout)} disabled={busy}><LogOut size={16} /> Disconnect</button></header>
    <div className="web-workspace-grid">
      <aside className="web-library">
        <span className="web-kicker"><Radio size={14} /> SHARED FROM DESKTOP</span>
        <h2>{book.title}</h2>
        {book.author && <p>{book.author}</p>}
        <label className="web-chapters">
          <span><BookOpen size={17} /> Chapter</span>
          <span className="web-select"><select disabled={busy || !book.chapters.length} value={chapter?.id || ""} onChange={(event) => open(event.target.value)}>
            {!chapter && <option value="" disabled>Select a chapter</option>}
            {book.chapters.map(({ id, title }) => <option value={id} key={id}>{title}</option>)}
          </select><ChevronDown size={17} /></span>
        </label>
        <button className="web-quiet" onClick={refreshChapters} disabled={busy}>Refresh chapters</button>
        {error && <p className="web-error" role="alert">{error}</p>}
      </aside>
      <div className="web-writing">{chapter
        ? <Manuscript key={chapter.id} ref={writer} bookId={book.id} chapter={chapter} locked={busy} onUnauthorized={onUnauthorized} />
        : <p className="web-empty">{book.chapters.length ? "Select a chapter to begin." : "Add a chapter on the desktop to start writing."}</p>}</div>
    </div>
  </main>;
}

function App() {
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pairAgain, setPairAgain] = useState(false);
  const [expired, setExpired] = useState(false);
  const onUnauthorized = React.useCallback(() => setExpired(true), []);

  async function connect() {
    try {
      const current = await request("/api/book");
      if (book && current.id !== book.id)
        throw new Error("The desktop is sharing a different book. Download any open draft before reloading this page.");
      setBook(current);
      setPairAgain(false);
      setExpired(false);
      setError("");
    } catch (failure) {
      if (failure.status !== 401 || book || remoteLink) throw failure;
      setBook(null);
    }
  }

  async function initial() {
    setLoading(true);
    setError("");
    try { await connect(); }
    catch (failure) { setError(failure.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { initial(); }, []);

  if (book) return <>
    {expired && !pairAgain && <div className="web-reconnect" role="status">
      <span>{remoteLink ? "Open a new private link from the desktop to reconnect. Your draft stays here." : "Pair again to reconnect to the desktop. Your open draft stays here."}</span>
      {!remoteLink && <button className="web-quiet" onClick={() => setPairAgain(true)}>Pair again</button>}
    </div>}
    <Workspace key={book.id} book={book} updateBook={setBook} onUnauthorized={onUnauthorized} logout={async () => {
      if (remoteLink) {
        remoteLink.forget();
        setError("Open the private link again to reconnect.");
      } else await request("/api/logout", "POST", {});
      setBook(null);
      setExpired(false);
    }} />
    {pairAgain && <div className="web-pair-overlay" role="dialog" aria-modal="true" aria-label="Pair with desktop">
      <div><h2>Pair with the desktop</h2><PairForm onPair={connect} dismiss={() => setPairAgain(false)} /></div>
    </div>}
  </>;

  return <main className="web-landing">
    <header><Wordmark /><span className="web-kicker">WEB ACCESS</span></header>
    <div className="web-landing-grid">
      <section className="web-intro">
        <div className="web-kicker"><Radio size={15} /> YOUR DESKTOP LIBRARY</div>
        <h1>Pick up where<br />you left off<span>.</span></h1>
        <p>Continue your manuscript in this browser. Your desktop keeps the book and saves your edits to its files.</p>
      </section>
      <section className="web-pair">
        <span className="web-folio">01 / CONNECTION</span>
        <h2>{remoteLink ? "Open shared book" : "Pair your browser"}</h2>
        {loading ? <p role="status">Looking for a connection…</p> : <>
          {error && <><p className="web-error" role="alert">{error}</p><button className="web-quiet" onClick={initial}>Try again</button></>}
          {!remoteLink && <PairForm onPair={connect} />}
        </>}
      </section>
    </div>
    <footer><span>ASSISTED WRITER</span><span>Keep your desktop awake while you write.</span></footer>
  </main>;
}

createRoot(document.getElementById("root")).render(<App />);
