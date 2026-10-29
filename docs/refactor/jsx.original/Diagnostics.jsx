import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "./api";
import { t, useT } from "./i18n";

/** Cada cuánto se revisa el audio: detecta auriculares conectados a mitad de uso. */
const AUDIO_POLL_MS = 5000;

/**
 * Las comprobaciones agrupadas por lo que hace la app, no por pieza técnica:
 * quien la usa piensa en "no oye la llamada", no en "BlackHole".
 */
const GROUPS = [
  { key: "call", title: "diagnostics.group.call", ids: ["blackhole", "routing", "sample_rate", "capture_volume"] },
  { key: "mic", title: "diagnostics.group.mic", ids: ["microphone"] },
  { key: "translate", title: "diagnostics.group.translate", ids: ["listener", "sense_voice", "translator"] },
  { key: "voice", title: "diagnostics.group.voice", ids: ["espeak", "voice_model"] },
  { key: "notes", title: "diagnostics.group.notes", ids: ["speakers"] },
];

/**
 * Lo que solo hace falta para oír la llamada por BlackHole. Con el audio del
 * Mac (Core Audio taps) no aplica.
 */
const BLACKHOLE_CAPTURE = new Set(["blackhole", "routing", "sample_rate", "capture_volume"]);

/** Lo que solo hace falta para algunos idiomas o para las notas: no cuenta como problema. */
const OPTIONAL = new Set(["sense_voice", "speakers"]);

/**
 * Qué nota quien usa la app cuando falla cada comprobación. El título del
 * backend (qué está mal) queda debajo, como detalle.
 */
const EFFECT = {
  blackhole: "diagnostics.effect.blackhole",
  routing: "diagnostics.effect.routing",
  sample_rate: "diagnostics.effect.sample_rate",
  capture_volume: "diagnostics.effect.capture_volume",
  microphone: "diagnostics.effect.microphone",
  espeak: "diagnostics.effect.espeak",
  voice_model: "diagnostics.effect.voice_model",
  listener: "diagnostics.effect.listener",
  sense_voice: "diagnostics.effect.sense_voice",
  speakers: "diagnostics.effect.speakers",
  translator: "diagnostics.effect.translator",
};

/** Texto del botón: el verbo de lo que pasa al pulsarlo. */
const FIX_LABEL = {
  routing: "diagnostics.fix.routing",
  sample_rate: "diagnostics.fix.sample_rate",
  capture_volume: "diagnostics.fix.capture_volume",
  listener: "diagnostics.fix.listener",
  sense_voice: "diagnostics.fix.sense_voice",
  voice_model: "diagnostics.fix.voice_model",
  speakers: "diagnostics.fix.speakers",
  translator: "diagnostics.fix.translator",
};

/** @param {import("./api").Check} c */
const isProblem = (c) => c.status !== "ok" && !OPTIONAL.has(c.id);

/** @param {import("./api").Check[]} checks */
function groupStatus(checks) {
  if (checks.some((c) => isProblem(c) && c.status === "error")) return "error";
  if (checks.some(isProblem)) return "warning";
  if (checks.some((c) => c.status !== "ok")) return "optional";
  return "ok";
}

/** @param {import("./api").Check[]} checks */
function groupSummary(checks) {
  const problems = checks.filter(isProblem).length;
  if (problems) return t("diagnostics.problems", { count: problems });
  if (checks.some((c) => c.status !== "ok")) return t("diagnostics.readyOptional");
  return t("diagnostics.ready");
}

/**
 * Panel de diagnóstico. Revisa dependencias al abrir y el enrutado de audio
 * cada pocos segundos. Lo que impide traducir sale primero, dicho por su
 * efecto y con su arreglo; el resto, plegado por grupos.
 * @param {{ mode: "video" | "call", systemAudio?: boolean, onFixed?: () => void, onlyProblems?: boolean, expanded?: boolean }} props
 *   `systemAudio`: Escuchar oye el audio del Mac, sin BlackHole. `onFixed` se
 *   llama tras un arreglo, para que la app vuelva a leer dispositivos y ajustes.
 *   `onlyProblems`: en la pantalla de traducir solo aparece si algo falla (el
 *   detalle está en Ajustes). `expanded`: los grupos se ven desde el principio.
 */
export default function Diagnostics({ mode, systemAudio = false, onFixed, onlyProblems = false, expanded = false }) {
  const t = useT();
  /** @type {[import("./api").Check[], Function]} */
  const [allChecks, setChecks] = useState([]);
  // En modo vídeo el micrófono no se usa: no es un problema ni hace falta verlo.
  const checks = allChecks.filter(
    (c) => !(mode === "video" && c.id === "microphone") && !(systemAudio && BLACKHOLE_CAPTURE.has(c.id)),
  );
  const [fixing, setFixing] = useState(null);
  const [error, setError] = useState(null);
  const [showDetails, setShowDetails] = useState(expanded);
  const [open, setOpen] = useState(/** @type {string | null} */ (null));

  /** Sustituye las comprobaciones recibidas y conserva las demás. */
  const merge = useCallback((fresh) => {
    setChecks((prev) => {
      const ids = new Set(fresh.map((c) => c.id));
      return [...prev.filter((c) => !ids.has(c.id)), ...fresh];
    });
  }, []);

  const refresh = useCallback(
    (full) =>
      api
        .runDiagnostics(full)
        // En una revisión completa también desaparecen las que ya no aplican.
        .then((fresh) => (full ? setChecks(fresh) : merge(fresh)))
        .catch((e) => setError(errorMessage(e))),
    [merge],
  );

  useEffect(() => {
    refresh(true);
    const timer = window.setInterval(() => refresh(false), AUDIO_POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const fix = async (id) => {
    setFixing(id);
    setError(null);
    try {
      merge(await api.fixDiagnostic(id));
      onFixed?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setFixing(null);
    }
  };

  const problems = checks
    .filter(isProblem)
    .sort((a, b) => (a.status === "error" ? 0 : 1) - (b.status === "error" ? 0 : 1));
  const groups = GROUPS.map((g) => ({ ...g, checks: checks.filter((c) => g.ids.includes(c.id)) })).filter(
    (g) => g.checks.length > 0,
  );

  /** @param {import("./api").Check} c */
  const fixButton = (c) =>
    c.fix &&
    c.status !== "ok" && (
      <button className="primary small" onClick={() => fix(c.id)} disabled={fixing !== null}>
        {fixing === c.id ? (c.fix === "Descargar" ? t("diagnostics.downloading") : t("diagnostics.fixing")) : FIX_LABEL[c.id] ? t(FIX_LABEL[c.id]) : c.fix}
      </button>
    );

  if (checks.length === 0) {
    if (onlyProblems) return null;
    return (
      <section className="diagnostics">
        <div className="diag-bar">
          <span className="spinner small" />
          <strong>{t("diagnostics.checking")}</strong>
        </div>
      </section>
    );
  }

  const worst = problems.some((c) => c.status === "error") ? "error" : problems.length ? "warning" : "ok";
  if (onlyProblems && problems.length === 0) return null;

  return (
    <section className={`diagnostics is-${worst}`}>
      {problems.length === 0 ? (
        <div className="diag-bar">
          <StatusIcon status="ok" />
          <strong>{t("diagnostics.allReady")}</strong>
          <button className="link" onClick={() => setShowDetails((v) => !v)} aria-expanded={showDetails}>
            {showDetails ? t("diagnostics.hideDetails") : t("diagnostics.showDetails")}
          </button>
        </div>
      ) : (
        <ul className="diag-problems">
          {problems.map((c) => (
            <li key={c.id} className={`diag-problem ${c.status}`}>
              <StatusIcon status={c.status} />
              <div className="diag-problem-text">
                <p className="diag-effect">{EFFECT[c.id] ? t(EFFECT[c.id]) : c.title}</p>
                <p className="diag-why">{c.detail}</p>
                {EFFECT[c.id] && <p className="diag-cause">{t("diagnostics.cause", { title: c.title })}</p>}
              </div>
              {fixButton(c)}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="error">{error}</p>}

      {(showDetails || problems.length > 0) && (
        <div className="diag-groups">
          {groups.map((g) => {
            const status = groupStatus(g.checks);
            const expanded = open === g.key;
            return (
              <div key={g.key} className={expanded ? "diag-group is-open" : "diag-group"}>
                <button className="diag-group-head" onClick={() => setOpen(expanded ? null : g.key)} aria-expanded={expanded}>
                  <StatusIcon status={status} />
                  <span className="diag-group-title">{t(g.title)}</span>
                  <span className={`diag-group-summary ${status}`}>{groupSummary(g.checks)}</span>
                  <Chevron />
                </button>
                {expanded && (
                  <ul className="diag-items">
                    {g.checks.map((c) => (
                      <li key={c.id} className="diag-item">
                        <StatusIcon status={c.status === "ok" ? "ok" : OPTIONAL.has(c.id) ? "optional" : c.status} />
                        <div>
                          <p className="diag-item-title">
                            {c.title}
                            {OPTIONAL.has(c.id) && <span className="diag-badge">{t("diagnostics.optional")}</span>}
                          </p>
                          <p className="diag-why">{c.detail}</p>
                        </div>
                        {OPTIONAL.has(c.id) && fixButton(c)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          <button className="link diag-recheck" onClick={() => refresh(true)}>
            {t("diagnostics.recheck")}
          </button>
        </div>
      )}
    </section>
  );
}

const icon = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" };

/** @param {{ status: "ok" | "warning" | "error" | "optional" }} props */
function StatusIcon({ status }) {
  return (
    <span className={`diag-icon ${status}`} aria-hidden>
      {status === "ok" ? (
        <svg {...icon}>
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      ) : status === "error" ? (
        <svg {...icon}>
          <path d="M7 7l10 10M17 7L7 17" />
        </svg>
      ) : status === "warning" ? (
        <svg {...icon}>
          <path d="M12 7v6M12 17h.01" />
        </svg>
      ) : (
        <svg {...icon}>
          <path d="M8 12h8" />
        </svg>
      )}
    </span>
  );
}

function Chevron() {
  return (
    <svg {...icon} width={14} height={14} className="diag-chevron" aria-hidden>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
