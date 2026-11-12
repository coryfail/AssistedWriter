import React, { useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, LocateFixed, X } from "lucide-react";

export function ReviewQueue({
  report, selection, stale, locked, ranges, available, inline, onInline, onSelect, onLocate, onDecide,
}) {
  const [category, setCategory] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const queue = useRef(null);
  const suggestions = report.suggestions.map((suggestion, index) => ({
    ...suggestion,
    index,
    group: suggestion.category.trim().toLowerCase() || "copyedit",
    status: suggestion.status || "pending",
  }));
  const groups = [...new Set(suggestions.map((item) => item.group))];
  const visibleGroups = groups.filter((group) => !category || category === group).map((group) => ({
    group,
    items: suggestions.filter((item) => item.group === group && (!pendingOnly || item.status === "pending")),
  })).filter(({ items }) => items.length);
  const visible = visibleGroups.flatMap(({ items }) => items);
  const active = visible.find((item) => item.index === selection) || visible[0];
  const position = visible.indexOf(active);
  const accepted = suggestions.filter((item) => item.status === "accepted").length;
  const denied = suggestions.filter((item) => item.status === "denied").length;
  const pending = suggestions.length - accepted - denied;
  const canDecide = active?.status === "pending" && !stale && !locked;
  const canAccept = canDecide && available.has(active.index);

  function decide(status) {
    if (!canDecide || (status === "accepted" && !canAccept)) return;
    const next = [...visible.slice(position + 1), ...visible.slice(0, position)]
      .find((item) => item.status === "pending");
    queue.current?.focus({ preventScroll: true });
    onDecide(active.index, status, next?.index);
  }

  function navigate(offset) {
    const next = visible[position + offset];
    if (!locked && next) onSelect(next.index);
  }

  function handleKey(event) {
    if (event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
      event.target.closest("select, input, textarea, [contenteditable=true]")) return;
    const key = event.key.toLowerCase();
    if (!["j", "k", "a", "d"].includes(key)) return;
    event.preventDefault();
    if (key === "j") navigate(1);
    if (key === "k") navigate(-1);
    if (key === "a") decide("accepted");
    if (key === "d") decide("denied");
  }

  return <section className="result-group edit-review" ref={queue} tabIndex={0}
    aria-label="Suggested edits" onKeyDown={handleKey}>
    <div className="edit-review-heading">
      <h5>Suggested edits</h5>
      {onInline && <button type="button" className="review-inline-toggle" aria-pressed={inline}
        disabled={locked || (!inline && (stale || !ranges.size))} onClick={() => onInline(active?.index)}>
        Inline review
      </button>}
    </div>
    <p className="edit-review-status" role="status">
      {accepted + denied} of {suggestions.length} reviewed · {accepted} accepted · {denied} denied
    </p>
    {stale && pending > 0 && <p className="review-notice" role="alert">
      The chapter changed after this review. Review the chapter again to make more decisions.
    </p>}
    {suggestions.length > 1 && <div className="review-filters">
      <select aria-label="Filter by category" value={category} onChange={(event) => setCategory(event.target.value)}>
        <option value="">All categories</option>
        {groups.map((group) => <option key={group} value={group}>{group[0].toUpperCase() + group.slice(1)}</option>)}
      </select>
      <label><input type="checkbox" checked={pendingOnly}
        onChange={(event) => setPendingOnly(event.target.checked)} /> Pending only</label>
    </div>}
    {active ? <>
      {visible.length > 1 && <div className="review-navigation">
        <button type="button" disabled={locked || position === 0} onClick={() => navigate(-1)}
          aria-keyshortcuts="K"><ChevronLeft size={14} /> Previous</button>
        <span>{position + 1} of {visible.length}</span>
        <button type="button" disabled={locked || position === visible.length - 1} onClick={() => navigate(1)}
          aria-keyshortcuts="J">Next <ChevronRight size={14} /></button>
      </div>}
      <article className="suggestion active">
        <div className="suggestion-detail">
          <div className="suggestion-detail-heading">
            <span className="suggestion-label">{active.group}</span>
            <span className={`review-decision ${active.status}`}>{active.status}</span>
          </div>
          <div className="change-field">
            <span className="change-label original">Original</span>
            <div className="before">{active.quote}</div>
          </div>
          <div className="change-field">
            <span className="change-label replacement">Replacement</span>
            <div className="after">{active.replacement || <em>Remove this text</em>}</div>
          </div>
          {active.reason && <p>{active.reason}</p>}
          {active.status === "pending" && !stale && !available.has(active.index) &&
            <p className="review-notice">This passage no longer matches uniquely.</p>}
          {active.status === "pending" && <div className="suggestion-actions">
            <button type="button" className="apply" disabled={!canAccept} aria-keyshortcuts="A"
              onClick={() => decide("accepted")}><Check size={14} /> Accept</button>
            <button type="button" disabled={!canDecide} aria-keyshortcuts="D"
              onClick={() => decide("denied")}><X size={14} /> Deny</button>
          </div>}
          {ranges.has(active.index) && <button type="button" className="review-locate"
            disabled={locked || stale} onClick={() => onLocate(active.index)}>
            <LocateFixed size={14} /> Show in manuscript
          </button>}
        </div>
      </article>
    </> : <p className="edit-review-status">No pending edits in this view.</p>}
    {visible.length > 1 && <div className="suggestion-queue" aria-label="Edits by category">
      {visibleGroups.map(({ group, items }) => <div key={group}>
        <h6>{group}</h6>
        {items.map((item) => <button type="button" key={item.index} className="suggestion-summary"
          disabled={locked} aria-current={item.index === active?.index ? "true" : undefined}
          onClick={() => onSelect(item.index)}>
          <span className="suggestion-summary-copy">{item.quote.replace(/\s+/g, " ").trim()}</span>
          <span className={`review-decision ${item.status}`}>{item.status}</span>
        </button>)}
      </div>)}
    </div>}
    <p className="review-shortcuts">With this panel focused, J / K to move · A to accept · D to deny</p>
  </section>;
}
