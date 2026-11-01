import { useEffect, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { PhysicalPosition, PhysicalSize, Window, availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import Captions from "@components/Captions";
import { useT } from "@i18n";
import { isOnScreen } from "@utils/screen";
import styles from "./styles.module.css";

const PREFS_KEY = "lingora.floating";
/** Font sizes that A− and A+ step through. */
const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 34, 40, 48];
/** Background opacities; the button moves to the next one. The last one is fully black. */
const OPACITIES = [0.3, 0.55, 0.8, 1];
/** Characters of what is being heard now; it is trimmed from the start. */
const LIVE_CHARS = 140;

/**
 * @typedef {{ fontStep: number, opacityStep: number, showLive: boolean, x?: number, y?: number, width?: number, height?: number }} Prefs
 * @returns {Prefs}
 */
function loadPrefs() {
  try {
    return { fontStep: 6, opacityStep: 1, showLive: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return { fontStep: 6, opacityStep: 1, showLive: true };
  }
}

/** @param {Partial<Prefs>} patch */
function savePrefs(patch) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...patch }));
  } catch {
    // Without storage the settings only last while the window is open.
  }
}

/**
 * Floating subtitles: a separate window, on top of everything, that only
 * shows the latest sentences from Listen. The main window sends it the
 * text (`captions`) and receives the pause (`captions-control`) and the close
 * (`captions-closed`). The controls appear on hover.
 */
export default function FloatingCaptions() {
  const t = useT();
  /** @type {[{ state: import("@app/types").LaneState, showSource: boolean, live?: string } | null, Function]} */
  const [data, setData] = useState(null);
  const [prefs, setPrefs] = useState(loadPrefs);
  const win = getCurrentWindow();

  useEffect(() => {
    const off = listen("captions", (e) => setData(/** @type {any} */ (e.payload)));
    // Asks for the current state: what was already said before opening it.
    off.then(() => emitTo("main", "captions-ready"));
    return () => void off.then((f) => f());
  }, []);

  // Goes back to where the user left it and remembers where they leave it.
  useEffect(() => {
    const saved = loadPrefs();
    if (saved.x !== undefined && saved.y !== undefined) {
      const { x, y } = saved;
      // Not on a monitor that is no longer connected: there it can't be seen or
      // dragged back. Then it stays where Rust opens it (bottom, centered).
      win
        .innerSize()
        .then(async (size) => {
          const rect = { x, y, width: saved.width ?? size.width, height: saved.height ?? size.height };
          if (isOnScreen(rect, await availableMonitors())) await win.setPosition(new PhysicalPosition(x, y));
        })
        .catch(() => {});
    }
    if (saved.width && saved.height) win.setSize(new PhysicalSize(saved.width, saved.height));
    const offs = [
      win.onMoved(({ payload }) => savePrefs({ x: payload.x, y: payload.y })),
      win.onResized(({ payload }) => savePrefs({ width: payload.width, height: payload.height })),
    ];
    return () => offs.forEach((off) => void off.then((f) => f()));
  }, []);

  /** @param {Partial<Prefs>} patch */
  const change = (patch) => {
    setPrefs((p) => ({ ...p, ...patch }));
    savePrefs(patch);
  };

  const close = async () => {
    await emitTo("main", "captions-closed");
    await win.close();
  };

  const showMain = async () => {
    const main = await Window.getByLabel("main");
    await main?.unminimize();
    await main?.show();
    await main?.setFocus();
  };

  /** Drags the window from anywhere that is not a button. @param {React.MouseEvent} e */
  const drag = (e) => {
    if (e.button === 0 && !(/** @type {HTMLElement} */ (e.target).closest("button"))) win.startDragging();
  };

  const running = data?.state.running ?? false;
  const live = data?.live ?? "";

  return (
    <div
      className={styles.floating}
      onMouseDown={drag}
      style={{
        "--floating-font": `${FONT_SIZES[prefs.fontStep]}px`,
        "--floating-bg": OPACITIES[prefs.opacityStep],
      }}
    >
      <div className={styles.floatingTools}>
        <button
          onClick={() => emitTo("main", "captions-control")}
          title={running ? t("floating.pause") : t("floating.start")}
          disabled={!data}
        >
          {running ? "❚❚" : "▶"}
        </button>
        <button
          onClick={() => change({ fontStep: prefs.fontStep - 1 })}
          disabled={prefs.fontStep === 0}
          title={t("floating.smaller")}
        >
          A−
        </button>
        <button
          onClick={() => change({ fontStep: prefs.fontStep + 1 })}
          disabled={prefs.fontStep === FONT_SIZES.length - 1}
          title={t("floating.larger")}
        >
          A+
        </button>
        <button onClick={() => change({ opacityStep: (prefs.opacityStep + 1) % OPACITIES.length })} title={t("floating.opacity")}>
          ◐
        </button>
        <button
          className={prefs.showLive ? styles.isOn : ""}
          onClick={() => change({ showLive: !prefs.showLive })}
          aria-pressed={prefs.showLive}
          title={prefs.showLive ? t("floating.hideLive") : t("floating.showLive")}
        >
          {t("floating.live")}
        </button>
        <span className={styles.floatingSpacer} />
        <button onClick={showMain} title={t("floating.openApp")}>
          Lingora
        </button>
        <button onClick={close} title={t("floating.close")}>
          ✕
        </button>
      </div>
      {data ? (
        <Captions state={data.state} showSource={data.showSource} floating />
      ) : (
        <p className={styles.floatingConnecting}>{t("floating.connecting")}</p>
      )}
      {/* Separately, what is being heard now, exactly as the listener understands it.
          It stays during silences so the window does not change shape. */}
      {running && prefs.showLive && (
        <div className={live ? styles.floatingLive : `${styles.floatingLive} ${styles.isIdle}`}>
          <span className="live-dot" />
          <span className={styles.floatingLiveText} dir="auto">
            {!live ? "…" : live.length > LIVE_CHARS ? `…${live.slice(-LIVE_CHARS)}` : live}
          </span>
        </div>
      )}
      <span className={styles.floatingResize} onMouseDown={(e) => (e.stopPropagation(), win.startResizeDragging("SouthEast"))} />
    </div>
  );
}
