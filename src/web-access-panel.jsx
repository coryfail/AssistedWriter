import React, { useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";

function rememberedRemoteUrl() {
  try { return localStorage.getItem("assisted-writer:web-remote-url") || ""; }
  catch { return ""; }
}

export function WebAccessPanel({ api, bookTitle, beforeStart }) {
  const [status, setStatus] = useState(null);
  const [address, setAddress] = useState("");
  const [remoteUrl, setRemoteUrl] = useState(rememberedRemoteUrl);
  const [mode, setMode] = useState(() => remoteUrl ? "remote" : "lan");
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

  async function start() {
    await beforeStart();
    const next = await api.webStart(mode === "remote"
      ? { mode, remoteUrl }
      : { mode, host: selected });
    if (next.enabled && next.mode === "remote") {
      try { localStorage.setItem("assisted-writer:web-remote-url", next.url); }
      catch { /* Sharing still works when preferences cannot be saved. */ }
    }
    setCopied(false);
    return next;
  }

  const addresses = status?.addresses || [];
  const selected = addresses.some((item) => item.address === address) ? address : addresses[0]?.address;
  return <>
    <div className="eyebrow">DESKTOP HOST</div>
    <h2>Web Access</h2>
    {error && <p className="web-access-error" role="alert">{error}</p>}
    {!status ? <p>Checking network…</p> : status.enabled ? <>
      <p><strong>{status.bookTitle}</strong> is shared {status.mode === "remote" ? "over private Tailscale HTTPS" : "on your home network"}. Keep this desktop app open and your computer awake.</p>
      {status.mode === "remote" && <p>Connect the other device to your Tailscale network before opening this address.</p>}
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
      <p>Pair a browser to edit chapters in <strong>{bookTitle || "the current book"}</strong>. Sharing turns off when you leave the book or close this window.</p>
      <label>Connection
        <select value={mode} disabled={busy} onChange={(event) => setMode(event.target.value)}>
          <option value="lan">Home Wi-Fi</option>
          <option value="remote">Away from home · Tailscale</option>
        </select>
      </label>
      {mode === "remote" ? <>
        <p>Sign in to Tailscale on this Mac and the device you’ll write on. Run this in Terminal on the Mac and keep it running:</p>
        <code className="web-access-command">{status.remoteCommand}</code>
        <label>Tailscale Serve address
          <input type="url" value={remoteUrl} disabled={busy} placeholder="https://your-mac.your-network.ts.net:8443"
            onChange={(event) => setRemoteUrl(event.target.value)} />
        </label>
      </> : <>
        <p className="web-access-notice">Use a trusted network. This local connection is not encrypted.</p>
        {addresses.length ? <label>Network address
          <select value={selected || ""} disabled={busy} onChange={(event) => setAddress(event.target.value)}>
            {addresses.map(({ name, address }) => <option key={address} value={address}>{address} ({name})</option>)}
          </select>
        </label> : <p>Connect this computer to your home network to start sharing.</p>}
      </>}
      <button className="primary full" disabled={busy || !bookTitle || (mode === "remote" ? !remoteUrl.trim() : !selected)}
        onClick={() => run(start)}><Radio size={17} /> {busy ? "Starting…" : "Enable Web Access"}</button>
    </>}
  </>;
}
