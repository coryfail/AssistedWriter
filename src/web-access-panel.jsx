import React, { useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";

export function WebAccessPanel({ api, bookTitle, beforeStart }) {
  const [status, setStatus] = useState(null);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const urlInput = useRef(null);
  const operation = useRef(false);

  useEffect(() => {
    let mounted = true;
    async function refresh() {
      if (operation.current) return;
      try {
        const current = await api.webStatus();
        if (mounted && !operation.current) setStatus(current);
      } catch (failure) { if (mounted) setError(failure.message); }
    }
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => { mounted = false; clearInterval(timer); };
  }, [api]);

  async function run(action) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    try { setStatus(await action()); }
    catch (failure) { setError(failure.message); }
    finally { operation.current = false; setBusy(false); }
  }

  async function copyAddress() {
    try { await navigator.clipboard.writeText(status.url); setCopied(true); }
    catch { urlInput.current?.select(); }
  }

  const addresses = status?.addresses || [];
  const selected = addresses.some((item) => item.address === address) ? address : addresses[0]?.address;
  return <>
    <div className="eyebrow">DESKTOP HOST</div>
    <h2>Web Access</h2>
    {error && <p className="web-access-error" role="alert">{error}</p>}
    {!status ? <p>Checking network…</p> : status.enabled ? <>
      <p><strong>{status.bookTitle}</strong> is shared. Keep this desktop app open and your computer awake.</p>
      <label>Open this address on the other device
        <input ref={urlInput} value={status.url} readOnly onFocus={(event) => event.target.select()} />
      </label>
      <button className="secondary" onClick={copyAddress}>{copied ? "Address copied" : "Copy address"}</button>
      <div className="web-access-code">
        <strong>Pairing code</strong>
        <output aria-label="Pairing code">{status.code || "—"}</output>
        <span>{status.code ? "Works once and expires after five minutes." : "Generate another code to pair a new device."}</span>
        <button className="secondary" disabled={busy} onClick={() => run(api.webRenewCode)}>New code</button>
      </div>
      <p role="status">{status.devices} {status.devices === 1 ? "device" : "devices"} paired</p>
      <div className="web-access-actions">
        <button className="secondary" disabled={busy || !status.devices} onClick={() => run(api.webDisconnect)}>Disconnect all devices</button>
        <button className="primary" disabled={busy} onClick={() => run(api.webStop)}>Turn off Web Access</button>
      </div>
    </> : <>
      <p>Pair a browser on your home network to edit chapters in <strong>{bookTitle || "the current book"}</strong>.</p>
      <p className="web-access-notice">Use a trusted network. This connection is not encrypted. Sharing turns off when you leave this book or close the desktop window.</p>
      {addresses.length ? <label>Network address
        <select value={selected || ""} onChange={(event) => setAddress(event.target.value)}>
          {addresses.map(({ name, address }) => <option key={address} value={address}>{address} ({name})</option>)}
        </select>
      </label> : <p>Connect this computer to your home network to start sharing.</p>}
      <button className="primary full" disabled={busy || !selected || !bookTitle} onClick={() => run(async () => {
        await beforeStart();
        return api.webStart(selected);
      })}><Radio size={17} /> {busy ? "Starting…" : "Enable Web Access"}</button>
    </>}
  </>;
}
