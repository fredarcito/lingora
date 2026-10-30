import { Component, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../utils/api";
import { WaveIcon } from "../../components/shared/icons";
import { t, useLang, useT } from "../../i18n";
import styles from "./styles.module.css";

const WELCOMED_KEY = "lingora.welcomed";

/**
 * Lo que se descarga en la bienvenida, en este orden. Se nombra por lo que
 * hace, no por el modelo. El de chino, japonés y coreano no está: se ofrece
 * en el diagnóstico solo a quien lo necesita. «Personas» (quién habla en las
 * notas) es pequeño y va con el resto.
 */
const STEPS = [{ id: "listener" }, { id: "translator" }, { id: "voice_model" }, { id: "speakers" }];

/** Claves (`welcome.how.<id>.title|text`) de los pasos de «Cómo funciona». */
const HOW_IT_WORKS = ["listen", "translate", "read", "local"];

/** Si hay que pasar por la bienvenida: falta lo imprescindible, o la voz y aún no se vio. */
export async function needsWelcome() {
  const status = await api.setupStatus();
  const missing = (id) => status.some((m) => m.id === id && !m.installed);
  let welcomed = false;
  try {
    welcomed = localStorage.getItem(WELCOMED_KEY) === "1";
  } catch {
    // Sin almacenamiento se decide solo por los modelos.
  }
  return missing("listener") || missing("translator") || (!welcomed && missing("voice_model"));
}

/** @param {number} bytes @param {string} lang */
const mb = (bytes, lang) => `${Math.round(bytes / 1_000_000).toLocaleString(lang)} MB`;
/** @param {number} bytes @param {string} lang */
const size = (bytes, lang) =>
  bytes >= 1_000_000_000
    ? `${(bytes / 1_000_000_000).toLocaleString(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB`
    : mb(bytes, lang);

/** @param {number} secs */
function remaining(secs) {
  if (!Number.isFinite(secs) || secs <= 0) return "";
  if (secs < 60) return t("welcome.remainingLessThanMinute");
  return t("welcome.remaining", { count: Math.round(secs / 60) });
}

/**
 * Primera vez: explica cómo funciona Lingora mientras descarga lo que
 * necesita. Siempre se puede saltar; lo que falte se descarga luego desde el
 * diagnóstico, como antes.
 * @param {{ onDone: () => void }} props
 */
export default function Welcome({ onDone }) {
  const t = useT();
  const { lang } = useLang();
  /** @type {[Record<string, { installed: boolean, partial: boolean, total: number, downloaded: number }>, Function]} */
  const [models, setModels] = useState({});
  /** @type {["idle" | "downloading" | "done" | "error", Function]} */
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState("");
  const [active, setActive] = useState("");
  const [etaSecs, setEtaSecs] = useState(0);
  const eta = remaining(etaSecs);
  const speed = useRef({ at: 0, bytes: 0, rate: 0 });

  useEffect(() => {
    api
      .setupStatus()
      .then((status) => {
        const next = {};
        for (const m of status) next[m.id] = { installed: m.installed, partial: m.partial, total: m.approx_bytes, downloaded: m.installed ? m.approx_bytes : 0 };
        setModels(next);
        if (STEPS.every((s) => next[s.id]?.installed)) setPhase("done");
      })
      .catch(() => onDone());
  }, []);

  const pending = STEPS.filter((s) => models[s.id] && !models[s.id].installed);
  const total = STEPS.reduce((n, s) => n + (models[s.id]?.total ?? 0), 0);
  const downloaded = STEPS.reduce((n, s) => n + (models[s.id]?.downloaded ?? 0), 0);
  const left = pending.reduce((n, s) => n + models[s.id].total, 0);
  const resuming = pending.some((s) => models[s.id].partial);
  const ready = models.listener?.installed && models.translator?.installed;

  /** @param {string} id @param {object} patch */
  const patch = (id, patch) => setModels((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const download = async () => {
    setPhase("downloading");
    setError("");
    // Copia local: el progreso llega por callback y el estado de React iría con retraso.
    const local = structuredClone(models);
    const left = () => STEPS.reduce((n, s) => n + (local[s.id].installed ? 0 : local[s.id].total - local[s.id].downloaded), 0);
    speed.current = { at: performance.now(), bytes: left(), rate: 0 };
    for (const step of STEPS) {
      if (local[step.id].installed) continue;
      setActive(step.id);
      try {
        await api.downloadModel(step.id, ({ downloaded, total }) => {
          Object.assign(local[step.id], { downloaded, total: total || local[step.id].total });
          patch(step.id, { downloaded: local[step.id].downloaded, total: local[step.id].total });
          // Velocidad suavizada para que el tiempo restante no salte.
          const s = speed.current;
          const now = performance.now();
          if (now - s.at < 1000) return;
          const rate = ((s.bytes - left()) * 1000) / (now - s.at);
          s.rate = s.rate ? s.rate * 0.7 + rate * 0.3 : rate;
          s.at = now;
          s.bytes = left();
          setEtaSecs(left() / s.rate);
        });
        local[step.id].installed = true;
        patch(step.id, { installed: true, partial: false });
      } catch (e) {
        setError(errorMessage(e));
        setPhase("error");
        setActive("");
        return;
      }
    }
    setActive("");
    setPhase("done");
  };

  const finish = () => {
    try {
      localStorage.setItem(WELCOMED_KEY, "1");
    } catch {
      // Sin almacenamiento se volverá a ver si falta la voz.
    }
    onDone();
  };

  const percent = total ? Math.min(100, (downloaded / total) * 100) : 0;
  // Las barras solo aparecen con progreso real: antes de empezar parecerían una descarga parada.
  const started = phase !== "idle";

  return (
    <main className={styles.welcome}>
      <header className={styles.welcomeHeader}>
        <span className="logo" aria-hidden>
          <WaveIcon />
        </span>
        <div>
          <h1>Lingora</h1>
          <p>{t("welcome.tagline")}</p>
        </div>
      </header>

      <div className={styles.welcomeBody}>
        <section className="welcome-how" aria-labelledby="welcome-how-title">
          <h2 id="welcome-how-title">{t("welcome.howTitle")}</h2>
          <ol className={styles.welcomeSteps}>
            {HOW_IT_WORKS.map((id, i) => (
              <li key={id}>
                <span className={styles.welcomeStepN} aria-hidden>
                  {i + 1}
                </span>
                <div>
                  <h3>{t(`welcome.how.${id}.title`)}</h3>
                  <p>{t(`welcome.how.${id}.text`)}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className={styles.welcomeNote}>
            <strong>{t("welcome.permissionTitle")}</strong> {t("welcome.permissionText")}
          </p>
        </section>

        <section className={styles.welcomePanel} aria-labelledby="welcome-setup-title">
          <h2 id="welcome-setup-title">{phase === "done" ? t("welcome.allReady") : t("welcome.beforeStart")}</h2>
          <p className={styles.welcomeLead}>
            {phase === "done"
              ? t("welcome.leadDone")
              : t("welcome.leadDownload", { size: size(left || total, lang) })}
          </p>

          <ul className={styles.welcomeModels}>
            {STEPS.map((step) => {
              const m = models[step.id];
              const p = m ? (m.installed ? 100 : m.total ? (m.downloaded / m.total) * 100 : 0) : 0;
              const state = !m
                ? ""
                : m.installed
                  ? t("welcome.ready")
                  : active === step.id
                    ? t("welcome.progressOf", { done: mb(m.downloaded, lang), total: mb(m.total, lang) })
                    : m.partial
                      ? t("welcome.partial", { size: size(m.total, lang) })
                      : size(m.total, lang);
              return (
                <li key={step.id} className={m?.installed ? styles.isDone : active === step.id ? "is-active" : ""}>
                  <div className={styles.welcomeModelRow}>
                    <span className={styles.welcomeModelName}>{t(`welcome.step.${step.id}`)}</span>
                    <span className={styles.welcomeModelState}>
                      {m?.installed && <CheckIcon />}
                      {state}
                    </span>
                  </div>
                  {started && (m?.installed || active === step.id || m?.downloaded > 0) && (
                    <div
                      className={styles.welcomeBar}
                      role="progressbar"
                      aria-label={t("welcome.downloadOf", { name: t(`welcome.step.${step.id}`).toLowerCase() })}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(p)}
                    >
                      <span style={{ width: `${p}%` }} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className={styles.welcomeLive} aria-live="polite">
            {phase === "downloading" && (
              <p className={styles.welcomeStatus}>
                {t("welcome.status", { percent: Math.round(percent), eta: eta ? ` · ${eta}` : "" })}
              </p>
            )}
            {phase === "error" && (
              <p className={styles.welcomeError} role="alert">
                {error}
              </p>
            )}
          </div>

          <div className={styles.welcomeActions}>
            {phase === "done" ? (
              <button className={styles.welcomePrimary} onClick={finish}>
                {t("welcome.start")}
              </button>
            ) : (
              <>
                <button className={styles.welcomePrimary} onClick={download} disabled={phase === "downloading" || !models.listener}>
                  {phase === "downloading" ? (
                    <>
                      <span className="spinner small" aria-hidden /> {t("welcome.downloading")}
                    </>
                  ) : phase === "error" ? (
                    t("welcome.retry")
                  ) : resuming ? (
                    t("welcome.continue")
                  ) : (
                    t("welcome.downloadSize", { size: size(left || total, lang) })
                  )}
                </button>
                {/* Plan B: entrar sin esperar. Lo que falte se descarga desde el diagnóstico. */}
                <button className={styles.welcomeSecondary} onClick={finish}>
                  {ready ? t("welcome.startNoVoice") : t("welcome.skip")}
                </button>
              </>
            )}
          </div>

          {phase !== "done" && (
            <dl className={styles.welcomeExplain}>
              <div>
                <dt>{phase === "error" ? t("welcome.retry") : resuming ? t("welcome.continue") : t("welcome.download")}</dt>
                <dd>{t("welcome.explainDownload")}</dd>
              </div>
              <div>
                <dt>{ready ? t("welcome.startNoVoice") : t("welcome.skip")}</dt>
                <dd>
                  {ready ? t("welcome.explainNoVoice") : t("welcome.explainSkip")}
                </dd>
              </div>
            </dl>
          )}
        </section>
      </div>
    </main>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/**
 * Si la bienvenida falla al dibujarse, se entra a la app: lo que falte se
 * descarga desde el diagnóstico.
 */
export class WelcomeBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error("[lingora] la bienvenida falló:", error);
    this.props.onDone();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
