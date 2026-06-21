"use client";



import { useState, useRef, useCallback } from "react";

import { cn } from "@/shared/utils/cn";



/**

 * InteractModal — captcha/manual solver panel.

 *

 * Props:

 *   slot        { index, email, provider, reason }

 *   frame       base64 JPEG string (latest screenshot)

 *   onAction    (slot, action) => Promise<void>   — posts to /api/interact

 *   onClose     () => void

 */

export default function InteractModal({ slot, frame, onAction, onClose }) {

  const [manualKey, setManualKey] = useState("");

  const [gotoUrl, setGotoUrl] = useState("");

  const [typeText, setTypeText] = useState("");

  const [busy, setBusy] = useState(false);

  const [tab, setTab] = useState("view"); // "view" | "remote"

  const imgRef = useRef(null);



  const send = useCallback(async (action) => {

    setBusy(true);

    try {

      await onAction(slot.index, action);

    } finally {

      setBusy(false);

    }

  }, [slot.index, onAction]);



  // Convert click on screenshot to browser coordinates (1366×768 viewport)

  function handleImgClick(e) {

    const rect = e.currentTarget.getBoundingClientRect();

    const scaleX = 1366 / rect.width;

    const scaleY = 768 / rect.height;

    const x = Math.round((e.clientX - rect.left) * scaleX);

    const y = Math.round((e.clientY - rect.top) * scaleY);

    send(`click:${x}:${y}`);

  }



  function handleScroll(e) {

    e.preventDefault();

    const dy = e.deltaY > 0 ? 300 : -300;

    send(`scroll:0:${dy}`);

  }



  async function handleContinue() {

    if (manualKey.trim()) {

      // Submit manual key via clipboard simulation — send as type action first,

      // then continue so server reads clipboard

      const encoded = btoa(unescape(encodeURIComponent(manualKey.trim())));

      await send(`type:${encoded}`);

    }

    await send("continue");

    onClose();

  }



  async function handleGoto() {

    if (!gotoUrl.trim()) return;

    await send(`goto:${gotoUrl.trim()}`);

    setGotoUrl("");

  }



  async function handleType() {

    if (!typeText) return;

    const encoded = btoa(unescape(encodeURIComponent(typeText)));

    await send(`type:${encoded}`);

    setTypeText("");

  }



  return (

    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>

      <div

        className="w-full max-w-3xl rounded-2xl border border-border-subtle bg-surface shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"

        onClick={(e) => e.stopPropagation()}

      >

        {/* Header */}

        <div className="flex items-center gap-3 px-5 py-3 border-b border-border-subtle bg-blue-500/5">

          <div className="flex items-center justify-center size-8 rounded-lg bg-blue-500/20 text-blue-500">

            <span className="material-symbols-outlined text-[18px]">touch_app</span>

          </div>

          <div className="flex-1 min-w-0">

            <h2 className="text-sm font-semibold text-text-main">Interaction Required — Slot {slot.index}</h2>

            <p className="text-[11px] text-text-muted truncate">{slot.reason || slot.provider}</p>

          </div>

          <span className="text-xs font-mono text-text-muted bg-surface-2 px-2 py-0.5 rounded border border-border-subtle">{slot.email}</span>

          <button onClick={onClose} className="text-text-muted hover:text-text-main cursor-pointer">

            <span className="material-symbols-outlined text-[20px]">close</span>

          </button>

        </div>



        {/* Tab bar */}

        <div className="flex border-b border-border-subtle bg-surface-2/50 px-5 gap-4">

          {[

            { id: "view",   label: "Screenshot",     icon: "monitor" },

            { id: "remote", label: "Remote Control",  icon: "computer" },

          ].map((t) => (

            <button

              key={t.id}

              onClick={() => setTab(t.id)}

              className={cn(

                "flex items-center gap-1.5 py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer",

                tab === t.id

                  ? "border-primary text-primary"

                  : "border-transparent text-text-muted hover:text-text-main"

              )}

            >

              <span className="material-symbols-outlined text-[14px]">{t.icon}</span>

              {t.label}

            </button>

          ))}

        </div>



        <div className="flex-1 overflow-y-auto custom-scrollbar">

          {tab === "view" && (

            <div className="p-4 space-y-3">

              {/* Live screenshot — clickable */}

              <div

                className={cn(

                  "relative rounded-xl overflow-hidden border border-border-subtle bg-black/30",

                  "cursor-crosshair select-none"

                )}

                onWheel={handleScroll}

              >

                {frame ? (

                  <img

                    ref={imgRef}

                    src={`data:image/jpeg;base64,${frame}`}

                    alt="Browser screenshot"

                    className="w-full h-auto"

                    draggable={false}

                    onClick={handleImgClick}

                  />

                ) : (

                  <div className="flex flex-col items-center justify-center py-16 gap-2 text-text-muted/40">

                    <span className="material-symbols-outlined text-[32px]">hide_image</span>

                    <span className="text-xs">No screenshot available</span>

                    <p className="text-[10px]">Virtual or Xvfb display mode required for live screenshots</p>

                  </div>

                )}

                {frame && (

                  <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-full">

                    Click to interact

                  </div>

                )}

              </div>



              {/* Reason */}

              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 flex gap-2">

                <span className="material-symbols-outlined text-[16px] text-amber-500 shrink-0 mt-px">warning</span>

                <p className="text-xs text-text-main">{slot.reason || "Manual interaction required. Solve the challenge in the browser, then click Continue."}</p>

              </div>



              {/* Manual key input */}

              <div>

                <label className="text-xs font-semibold text-text-muted block mb-1.5">

                  Manual API Key (optional — paste key if you retrieved it manually)

                </label>

                <input

                  type="text"

                  value={manualKey}

                  onChange={(e) => setManualKey(e.target.value)}

                  placeholder="Paste API key here..."

                  className="w-full text-xs font-mono bg-surface-2 border border-border-subtle rounded-lg px-3 py-2 text-text-main placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/40"

                />

              </div>

            </div>

          )}



          {tab === "remote" && (

            <div className="p-4 space-y-4">

              {/* Screenshot mini */}

              {frame && (

                <div className="rounded-xl overflow-hidden border border-border-subtle bg-black/20 cursor-crosshair" onWheel={handleScroll}>

                  <img

                    src={`data:image/jpeg;base64,${frame}`}

                    alt="Browser screenshot"

                    className="w-full h-auto"

                    draggable={false}

                    onClick={handleImgClick}

                  />

                </div>

              )}



              {/* Navigate */}

              <div>

                <label className="text-xs font-semibold text-text-muted block mb-1.5 uppercase tracking-wider">Navigate to URL</label>

                <div className="flex gap-2">

                  <input

                    type="text"

                    value={gotoUrl}

                    onChange={(e) => setGotoUrl(e.target.value)}

                    onKeyDown={(e) => e.key === "Enter" && handleGoto()}

                    placeholder="https://..."

                    className="flex-1 text-xs font-mono bg-surface-2 border border-border-subtle rounded-lg px-3 py-2 text-text-main placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/40"

                  />

                  <button onClick={handleGoto} disabled={busy} className="px-3 py-2 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors disabled:opacity-50 cursor-pointer shrink-0">

                    Go

                  </button>

                </div>

              </div>



              {/* Type text */}

              <div>

                <label className="text-xs font-semibold text-text-muted block mb-1.5 uppercase tracking-wider">Type Text</label>

                <div className="flex gap-2">

                  <input

                    type="text"

                    value={typeText}

                    onChange={(e) => setTypeText(e.target.value)}

                    onKeyDown={(e) => e.key === "Enter" && handleType()}

                    placeholder="Text to type into focused element..."

                    className="flex-1 text-xs bg-surface-2 border border-border-subtle rounded-lg px-3 py-2 text-text-main placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/40"

                  />

                  <button onClick={handleType} disabled={busy} className="px-3 py-2 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors disabled:opacity-50 cursor-pointer shrink-0">

                    Type

                  </button>

                </div>

              </div>



              {/* Page actions */}

              <div>

                <label className="text-xs font-semibold text-text-muted block mb-1.5 uppercase tracking-wider">Page Actions</label>

                <div className="flex flex-wrap gap-2">

                  {[

                      { action: "screenshot",    icon: "screenshot_monitor", label: "Refresh Screenshot" },

                    { action: "back",          icon: "arrow_back",         label: "Back" },

                    { action: "reload",        icon: "refresh",            label: "Reload" },

                    { action: "switch_tab:-1", icon: "tab",                label: "Prev Tab" },

                    { action: "switch_tab:1",  icon: "tab",                label: "Next Tab" },

                  ].map((a) => (

                    <button

                      key={a.action}

                      onClick={() => send(a.action)}

                      disabled={busy}

                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-subtle text-text-muted text-xs hover:bg-surface-2 hover:text-text-main transition-colors disabled:opacity-50 cursor-pointer"

                    >

                      <span className="material-symbols-outlined text-[14px]">{a.icon}</span>

                      {a.label}

                    </button>

                  ))}

                </div>

              </div>

            </div>

          )}

        </div>



        {/* Footer actions */}

        <div className="flex items-center gap-2 px-5 py-3 border-t border-border-subtle bg-surface-2/50">

          <button

            onClick={() => { send("abort"); onClose(); }}

            disabled={busy}

            className="px-3 py-1.5 rounded-lg border border-border-subtle text-text-muted text-xs font-semibold hover:bg-surface-2 transition-colors disabled:opacity-50 cursor-pointer"

          >

            Abort

          </button>

          <button

            onClick={() => { send("skip"); onClose(); }}

            disabled={busy}

            className="px-3 py-1.5 rounded-lg border border-border-subtle text-text-muted text-xs font-semibold hover:bg-surface-2 transition-colors disabled:opacity-50 cursor-pointer"

          >

            Skip Provider

          </button>

          <button

            onClick={() => send("retry")}

            disabled={busy}

            className="px-3 py-1.5 rounded-lg border border-border-subtle text-text-muted text-xs font-semibold hover:bg-surface-2 transition-colors disabled:opacity-50 cursor-pointer"

          >

            <span className="material-symbols-outlined text-[13px] align-middle mr-0.5">refresh</span>

            Retry

          </button>

          <div className="flex-1" />

          <button

            onClick={handleContinue}

            disabled={busy}

            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-500 text-white text-xs font-semibold hover:bg-blue-600 transition-colors disabled:opacity-50 cursor-pointer shadow"

          >

            <span className="material-symbols-outlined text-[14px]">check_circle</span>

            {busy ? "Sending..." : "Continue"}

          </button>

        </div>

      </div>

    </div>

  );

}

