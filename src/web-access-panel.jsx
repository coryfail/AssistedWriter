import React, { useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

export function WebAccessPanel({ api, bookTitle, beforeStart }) {
  const [status, setStatus] = useState(null);
  const [address, setAddress] = useState("");
  const [chosenMode, setMode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const urlInput = useRef(null);
  const operation = useRef(false);
  const mode = chosenMode ?? (status?.internetAvailable ? "remote" : "lan");

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
    const next = await api.webStart(mode === "remote" ? { mode } : { mode, host: selected });
    setCopied(false);
    return next;
  }

  const addresses = status?.addresses || [];
  const selected = addresses.some((item) => item.address === address) ? address : addresses[0]?.address;
  const remote = status?.mode === "remote";
  return <>
    <div className="eyebrow">DESKTOP HOST</div>
    <h2>Web Access</h2>
    {error && <p className="web-access-error" role="alert">{error}</p>}
    {!status ? <p>Checking network…</p> : status.enabled ? <>
      <p><strong>{status.bookTitle}</strong> {status.connected === false ? "is reconnecting" : "is shared"}. Keep this desktop app open and your computer awake.</p>
      <div className="web-access-scan">
        <QRCodeSVG value={status.url} size={196} level="M" marginSize={4} shapeRendering="crispEdges"
          title={remote ? "QR code for the private writing link" : "QR code for the home Wi-Fi address"} />
        <div className="web-access-scan-details">
          <strong>Scan with your phone</strong>
          <p>{remote
            ? "Point your camera at the code, then open the link in your browser."
            : "Connect to the same Wi-Fi, scan with your camera, then enter the pairing code in your browser."}</p>
          {remote ? <p>Anyone with this QR code or link can edit the manuscript and notes until you turn Web Access off.</p> :
            <div className="web-access-code">
              <strong>Pairing code</strong>
              <output aria-label="Pairing code">{status.code || "—"}</output>
              <span>{status.code ? "Works once and expires after five minutes." : "Generate another code to pair a new device."}</span>
              <button className="secondary" disabled={busy} onClick={() => run(api.webRenewCode)}>New code</button>
            </div>}
        </div>
      </div>
      <label>{remote ? "Private writing link" : "Home Wi-Fi address"}
        <input ref={urlInput} value={status.url} readOnly onFocus={(event) => event.target.select()} />
      </label>
      <button className="secondary" onClick={copyAddress}>{copied ? "Link copied" : "Copy link"}</button>
      {!remote && <p role="status">{status.devices} {status.devices === 1 ? "device" : "devices"} paired</p>}
      <div className="web-access-actions">
        {!remote && <button className="secondary" disabled={busy || !status.devices} onClick={() => run(api.webDisconnect)}>Disconnect all devices</button>}
        <button className="primary" disabled={busy} onClick={() => run(api.webStop)}>Turn off Web Access</button>
      </div>
    </> : <>
      <p>Open the manuscript and notes for <strong>{bookTitle || "the current book"}</strong> from another device. Sharing turns off when you leave the book or close the desktop window.</p>
      <label>Connection
        <select value={mode} disabled={busy} onChange={(event) => setMode(event.target.value)}>
          <option value="lan">Home Wi-Fi</option>
          <option value="remote">Internet · private link</option>
        </select>
      </label>
      {mode === "remote" ? <p>{status.internetAvailable
        ? "Create a private link you can open on another network or on cellular. The other device only needs a browser."
        : "Internet sharing isn’t available in this build. You can still connect over home Wi-Fi."}</p> : <>
        <p className="web-access-notice">Use a trusted network. This local connection is not encrypted.</p>
        {addresses.length ? <label>Network address
          <select value={selected || ""} disabled={busy} onChange={(event) => setAddress(event.target.value)}>
            {addresses.map(({ name, address }) => <option key={address} value={address}>{address} ({name})</option>)}
          </select>
        </label> : <p>Connect this computer to your home network to start sharing.</p>}
      </>}
      <button className="primary full" disabled={busy || !bookTitle || (mode === "remote" ? !status.internetAvailable : !selected)}
        onClick={() => run(start)}><Radio size={17} /> {busy ? "Starting…" : mode === "remote" ? "Create private link" : "Enable Web Access"}</button>
    </>}
  </>;
}
