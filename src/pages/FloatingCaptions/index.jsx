import { useEffect, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { PhysicalPosition, PhysicalSize, Window, getCurrentWindow } from "@tauri-apps/api/window";
import Captions from "../../components/Captions";
import { useT } from "../../i18n";
import styles from "./styles.module.css";

const PREFS_KEY = "lingora.floating";
/** Tamaños de letra entre los que se mueven A− y A+. */
const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 34, 40, 48];
/** Opacidades del fondo; el botón pasa a la siguiente. La última, negro del todo. */
const OPACITIES = [0.3, 0.55, 0.8, 1];
/** Caracteres de lo que se oye ahora; se recorta por el principio. */
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
    // Sin almacenamiento los ajustes solo duran mientras esté abierta.
  }
}

/**
 * Subtítulos flotantes: una ventana aparte, por encima de todo, que solo
 * muestra las últimas frases de Escuchar. La ventana principal le manda el
 * texto (`captions`) y recibe la pausa (`captions-control`) y el cierre
 * (`captions-closed`). Los controles salen al pasar el ratón.
 */
export default function FloatingCaptions() {
  const t = useT();
  /** @type {[{ state: import("../../App/types").LaneState, showSource: boolean, live?: string } | null, Function]} */
  const [data, setData] = useState(null);
  const [prefs, setPrefs] = useState(loadPrefs);
  const win = getCurrentWindow();

  useEffect(() => {
    const off = listen("captions", (e) => setData(/** @type {any} */ (e.payload)));
    // Pide el estado actual: lo que ya se dijo antes de abrirla.
    off.then(() => emitTo("main", "captions-ready"));
    return () => void off.then((f) => f());
  }, []);

  // Vuelve a donde la dejó quien la usa y recuerda dónde la deja.
  useEffect(() => {
    const saved = loadPrefs();
    if (saved.x !== undefined && saved.y !== undefined) win.setPosition(new PhysicalPosition(saved.x, saved.y));
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

  /** Arrastra la ventana desde cualquier sitio que no sea un botón. @param {React.MouseEvent} e */
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
        <p className="captions-empty">{t("floating.connecting")}</p>
      )}
      {/* Aparte, lo que se está oyendo ahora, tal cual lo entiende la escucha.
          Se queda en los silencios para que la ventana no cambie de forma. */}
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
