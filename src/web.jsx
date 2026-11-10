import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorContent, useEditor } from "@tiptap/react";
import { ArrowRight, BookOpen, ChevronDown, Download, LogOut, Radio } from "lucide-react";
import { FormattingToolbar, manuscriptExtensions, referenceExtensions } from "./manuscript-editor.jsx";
import { clearDraft, downloadDraft, readDraft, storeDraft } from "./drafts.mjs";
import { browserRelay, privateLinkForOrigin } from "./relay-browser.mjs";
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

const views = { manuscript: "Manuscript", book: "Book notes", chapter: "Chapter notes" };
const documentPath = (view, id) => view === "book" ? "/api/notes/book" :
  (view === "chapter" ? "/api/notes/chapters/" : "/api/chapters/") + encodeURIComponent(id);
function needsSource(body, isNote) {
  if (!isNote && /^\s*(?:#|#{4,6}) /m.test(body)) return true;
  return /<\/?[a-z][^>]*>|<!--|!\[|^\s*\|.*\||^\s*:?-{3,}:?\s*\||^\s*[-*+] \[[ xX]\]|\[\^[^\]]+\]/im.test(body);
}

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

function PrivateLinkForm() {
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  return <form className="web-pair-form" onSubmit={(event) => {
    event.preventDefault();
    const link = privateLinkForOrigin(value, location.origin);
    if (!link) {
      setInvalid(true);
      return;
    }
    // Reload even if this is the same share and only the fragment has changed.
    history.replaceState(null, "", link.pathname + link.hash);
    location.reload();
  }}>
    <label htmlFor="private-link">Private link from your Mac</label>
    <input id="private-link" className="web-private-link" type="text" inputMode="url" autoComplete="off"
      autoCapitalize="none" spellCheck={false} value={value}
      onChange={(event) => { setValue(event.target.value); setInvalid(false); }} />
    {invalid && <p className="web-error" role="alert">Paste the full link from Web Access, including the part after #.</p>}
    <button className="web-primary" disabled={!value.trim()}>Open shared book <ArrowRight size={18} /></button>
  </form>;
}

const WritingPage = forwardRef(function WritingPage({ bookId, page, view, locked, onUnauthorized }, ref) {
  const isNote = view !== "manuscript";
  const kind = isNote ? "browser-notes:" + view : "browser";
  const draftId = page.id;
  const endpoint = documentPath(view, page.id);
  const label = isNote ? "note" : "chapter";
  const matches = (body, savedBody) => (isNote ? body : body.trim()) === savedBody;
  const [recovery] = useState(() => {
    const draft = readDraft(kind, bookId, draftId);
    if (draft && matches(draft.body, page.body)) return null;
    return draft;
  });
  const saved = useRef(page);
  const draft = useRef(recovery);
  const writing = useRef(null);
  const timer = useRef(null);
  const [version, setVersion] = useState(page);
  const [source, setSource] = useState(() => needsSource(recovery?.body ?? page.body, isNote));
  const [text, setText] = useState(recovery?.body ?? page.body);
  const [conflict, setConflict] = useState(Boolean(recovery &&
    (recovery.revision !== page.revision || recovery.manifestRevision !== page.manifestRevision)));
  const conflictRef = useRef(conflict);
  const [message, setMessage] = useState(recovery ? "Draft recovered" : "Saved to desktop");
  const [error, setError] = useState("");
  const [storageWarning, setStorageWarning] = useState(false);
  const [dirty, setDirty] = useState(Boolean(recovery));
  const [saving, setSaving] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [comparison, setComparison] = useState(null);
  const [discard, setDiscard] = useState(false);
  const editor = useEditor({
    extensions: isNote ? referenceExtensions() : manuscriptExtensions(),
    content: source ? "" : recovery?.body ?? page.body,
    contentType: "markdown",
    editorProps: { attributes: { spellcheck: "true", "aria-label": views[view] } },
    onUpdate: ({ editor: current }) => {
      if (!source) change(current.getMarkdown());
    },
  });

  useEffect(() => {
    const stored = readDraft(kind, bookId, draftId);
    if (!recovery && stored && matches(stored.body, page.body)) clearDraft(kind, bookId, draftId);
  }, [kind, bookId, draftId, page.body, recovery]);
  useEffect(() => { editor?.setEditable(!locked, false); }, [editor, locked]);

  function persist(value) {
    setStorageWarning(!storeDraft(kind, bookId, draftId, value));
  }

  function markConflict(value) {
    conflictRef.current = value;
    setConflict(value);
  }

  function change(body) {
    setText(body);
    setError("");
    clearTimeout(timer.current);
    if (!conflictRef.current && !writing.current && matches(body, saved.current.body)) {
      draft.current = null;
      clearDraft(kind, bookId, draftId);
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
    if (conflictRef.current) return;
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
    if (conflictRef.current) throw new Error(`Resolve the ${label} conflict before continuing.`);
    setSaving(true);
    setMessage("Saving…");
    setError("");
    const operation = (async () => {
      try {
        const next = await request(endpoint, "PUT", {
          body: pending.body, revision: pending.revision, manifestRevision: pending.manifestRevision,
        });
        saved.current = next;
        setVersion(next);
        if (draft.current === pending) {
          draft.current = null;
          clearDraft(kind, bookId, draftId);
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
        if (failure.status === 409 || failure.status === 404) markConflict(true);
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
    if (needsSource(next.body, isNote)) setSource(true);
    else editor?.commands.setContent(next.body, { contentType: "markdown", emitUpdate: false });
    setMessage("Saved to desktop");
  }

  useEffect(() => {
    let live = true;
    async function refresh() {
      if (draft.current || writing.current || document.visibilityState === "hidden") return;
      const previous = saved.current;
      try {
        const next = await request(endpoint);
        if (live && !draft.current && !writing.current && saved.current === previous &&
            (next.revision !== previous.revision || next.manifestRevision !== previous.manifestRevision)) showSaved(next);
      } catch (failure) {
        if (live && failure.status === 401) onUnauthorized();
      }
    }
    const interval = setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);
    return () => { live = false; clearInterval(interval); window.removeEventListener("focus", refresh); };
  }, [endpoint, editor, onUnauthorized]);

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
    try { setComparison(await request(endpoint)); }
    catch (failure) { report(failure); }
    finally { setComparing(false); }
  }

  async function useSaved() {
    setComparing(true);
    try {
      const next = await request(endpoint);
      clearDraft(kind, bookId, draftId);
      draft.current = null;
      setDirty(false);
      setStorageWarning(false);
      markConflict(false);
      setError("");
      setComparison(null);
      setDiscard(false);
      showSaved(next);
    } catch (failure) {
      if (failure.status === 404) {
        // The parent refreshes the chapter list when the user chooses another chapter.
        clearDraft(kind, bookId, draftId);
        draft.current = null;
        setDirty(false);
        setStorageWarning(false);
        markConflict(false);
        setDiscard(false);
        setComparison(null);
        setMessage("Chapter removed on desktop");
        setError("Choose another chapter to continue.");
      } else report(failure);
    } finally { setComparing(false); }
  }

  function toggleSource() {
    const body = draft.current?.body ?? saved.current.body;
    if (source && (!editor || needsSource(body, isNote))) return;
    if (source) editor?.commands.setContent(body, { contentType: "markdown", emitUpdate: false });
    setText(body);
    setSource(!source);
  }

  const download = () => downloadDraft(view === "chapter" ? `${version.title} notes` : version.title,
    draft.current?.body ?? text, { includeHeading: !isNote });
  const sourceRequired = source && needsSource(text, isNote);

  return <>
    <div className="web-write-tools">
      {!source && <FormattingToolbar editor={locked ? null : editor} />}
      <button className="web-quiet web-source-switch" onClick={toggleSource}
        disabled={locked || sourceRequired || (source && !editor)}>
        {source ? "Formatted editor" : "Markdown source"}
      </button>
    </div>
    <article className="web-paper" aria-label="Writing workspace">
      <div className="web-paper-meta"><span>{views[view]}</span><span aria-hidden="true">✦</span></div>
      <h1>{version.title}</h1>
      <div className="web-save-bar">
        <span role="status" aria-live="polite">{message}</span>
        <button className="web-quiet" disabled={!dirty || saving || conflict || locked}
          onClick={() => flush().catch(() => {})}>Save now</button>
      </div>
      {sourceRequired && <p className="web-subtle">Markdown source keeps this {label}’s formatting intact.</p>}
      {storageWarning && <p className="web-error" role="alert">This browser couldn’t keep a recovery copy. Download your draft before leaving.</p>}
      {error && !conflict && <p className="web-error" role="alert">{error}</p>}
      {conflict && <section className="web-conflict" aria-label={`Saved ${label} conflict`}>
        <strong>The saved {label} changed.</strong>
        <p>Your draft is still here. Review the saved text or download your draft before opening the saved version.</p>
        {error && <p className="web-error" role="alert">{error}</p>}
        <div className="web-conflict-actions">
          <button className="web-quiet" onClick={compare} disabled={comparing}>{comparing ? "Checking…" : "Review saved text"}</button>
          <button className="web-quiet" onClick={download}><Download size={15} /> Download draft</button>
          <button className="web-quiet" onClick={() => setDiscard(true)}>Open saved {label}</button>
        </div>
        {comparison && <pre aria-label={`Saved ${label} text`}>{comparison.body || `This ${label} is blank.`}</pre>}
        {discard && <div className="web-discard">
          <p>Discard the browser draft? Download it first to keep a copy.</p>
          <button className="web-quiet" onClick={() => setDiscard(false)}>Keep draft</button>
          <button className="web-quiet" onClick={useSaved} disabled={comparing}>Discard draft</button>
        </div>}
      </section>}
      {source ? <textarea className="web-source" aria-label={`${views[view]} Markdown`} value={text} readOnly={locked}
        placeholder={isNote ? "Capture an idea…" : undefined}
        onChange={(event) => change(event.target.value)} spellCheck />
        : <EditorContent editor={editor} className={`web-prose ${isNote ? "reference-prose" : "prose-editor"}`} />}
      <footer className="web-paper-footer">
        <span>{(text.trim().match(/\S+/g) || []).length.toLocaleString()} words</span>
        {dirty && !conflict && <button className="web-quiet" onClick={download}><Download size={15} /> Download draft</button>}
      </footer>
    </article>
  </>;
});

function Workspace({ book, updateBook, logout, onUnauthorized }) {
  const [selection, setSelection] = useState(() => ({
    view: "manuscript", chapterId: book.chapters[0]?.id ?? "", page: null,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const writer = useRef(null);
  const loading = useRef(false);
  const { view, chapterId, page } = selection;

  useEffect(() => {
    if (chapterId) open(view, chapterId);
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

  async function selectPage(nextView, id) {
    const next = nextView === "book" || id ? await request(documentPath(nextView, id)) : null;
    setSelection({ view: nextView, chapterId: id, page: next });
  }

  function open(nextView, id) {
    run(() => selectPage(nextView, id));
  }

  function refreshChapters() {
    run(async () => {
      const latest = await request("/api/book");
      if (latest.id !== book.id) {
        updateBook(latest);
        return;
      }
      const nextId = latest.chapters.some((entry) => entry.id === chapterId) ? chapterId : latest.chapters[0]?.id ?? "";
      if (view === "book") {
        setSelection((current) => ({ ...current, chapterId: nextId }));
      } else if (nextId !== chapterId || !page) {
        await selectPage(view, nextId);
      }
      updateBook(latest);
    });
  }

  return <main className="web-workspace">
    <header className="web-header"><Wordmark /><button className="web-quiet" onClick={() => run(logout)} disabled={busy}><LogOut size={16} /> Disconnect</button></header>
    <div className="web-workspace-grid">
      <aside className="web-library">
        <span className="web-kicker"><Radio size={14} /> SHARED FROM DESKTOP</span>
        <h2>{book.title}</h2>
        {book.author && <p>{book.author}</p>}
        {book.notesAvailable === true && <nav className="web-pages" aria-label="Writing pages">
          {Object.entries(views).map(([key, title]) => <button key={key} className="web-page-button"
            aria-pressed={view === key} disabled={busy || (key === "chapter" && !book.chapters.length)}
            onClick={() => { if (view !== key || !page) open(key, chapterId); }}>{title}</button>)}
        </nav>}
        {view !== "book" && <>
          <label className="web-chapters">
            <span><BookOpen size={17} /> Chapter</span>
            <span className="web-select"><select disabled={busy || !book.chapters.length} value={chapterId}
              onChange={(event) => open(view, event.target.value)}>
              {!chapterId && <option value="" disabled>Select a chapter</option>}
              {book.chapters.map(({ id, title }) => <option value={id} key={id}>{title}</option>)}
            </select><ChevronDown size={17} /></span>
          </label>
          <button className="web-quiet" onClick={refreshChapters} disabled={busy}>Refresh chapters</button>
        </>}
        {error && <p className="web-error" role="alert">{error}</p>}
      </aside>
      <div className="web-writing">{page
        ? <WritingPage key={documentPath(view, page.id)} ref={writer} bookId={book.id} page={page} view={view}
          locked={busy} onUnauthorized={onUnauthorized} />
        : <p className="web-empty">{busy ? "Opening…" : book.chapters.length
          ? "Choose a chapter or refresh the chapter list to try again."
          : "Add a chapter on the desktop to start writing."}</p>}</div>
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
        <h1>{remoteLink && !loading && error ? "Reconnect to your book" : <>Pick up where<br />you left off</>}<span>.</span></h1>
        <p>{remoteLink && !loading && error
          ? "Keep your Mac awake with the book open and Web Access on."
          : "Continue your manuscript in this browser. Your desktop keeps the book and saves your edits to its files."}</p>
      </section>
      <section className="web-pair">
        <span className="web-folio">01 / CONNECTION</span>
        <h2>{remoteLink ? "Open shared book" : "Pair your browser"}</h2>
        {loading ? <p role="status">Looking for a connection…</p> : <>
          {error && <><p className="web-error" role="alert">{error}</p>
            {(!remoteLink || remoteLink.hasKey) && <button className="web-quiet" onClick={initial}>Try again</button>}</>}
          {remoteLink ? <PrivateLinkForm /> : <PairForm onPair={connect} />}
        </>}
      </section>
    </div>
    <footer><span>ASSISTED WRITER</span><span>Keep your desktop awake while you write.</span></footer>
  </main>;
}

createRoot(document.getElementById("root")).render(<App />);
