import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@utils/api";
import { ensureSpeakers, loadSpeakers } from "@utils/notes";
import { t, useT } from "@i18n";
import { LinkButton, Spinner, cx } from "@components/shared";
import styles from "./styles.module.css";

/** How often the audio is checked: detects headphones connected in the middle of use. */
const AUDIO_POLL_MS = 5000;

/**
 * The checks are grouped by what the app does, not by technical part:
 * the user thinks "it can't hear the call", not "BlackHole".
 */
const GROUPS = [
  { key: "call", title: "diagnostics.group.call", ids: ["blackhole", "routing", "sample_rate", "capture_volume"] },
  { key: "mic", title: "diagnostics.group.mic", ids: ["microphone"] },
  { key: "translate", title: "diagnostics.group.translate", ids: ["listener", "sense_voice", "translator"] },
  { key: "voice", title: "diagnostics.group.voice", ids: ["espeak", "voice_model", "old_voice"] },
  { key: "notes", title: "diagnostics.group.notes", ids: ["speakers"] },
];

/**
 * What is only needed to hear the call through BlackHole. With Mac audio
 * (Core Audio taps) it does not apply.
 */
const BLACKHOLE_CAPTURE = new Set(["blackhole", "routing", "sample_rate", "capture_volume"]);

/**
 * What is only needed for some languages or for notes, or only frees disk space: it does not count as a problem.
 * Telling people apart in notes does count while it is turned on.
 * @param {string} id
 */
const isOptional = (id) => id === "sense_voice" || id === "old_voice" || (id === "speakers" && !loadSpeakers());

/**
 * What the user is told when each check fails. The backend's title
 * (what is wrong) stays below, as a detail.
 */
const EFFECT = {
  blackhole: "diagnostics.effect.blackhole",
  routing: "diagnostics.effect.routing",
  sample_rate: "diagnostics.effect.sample_rate",
  capture_volume: "diagnostics.effect.capture_volume",
  microphone: "diagnostics.effect.microphone",
  espeak: "diagnostics.effect.espeak",
  voice_model: "diagnostics.effect.voice_model",
  old_voice: "diagnostics.effect.old_voice",
  listener: "diagnostics.effect.listener",
  sense_voice: "diagnostics.effect.sense_voice",
  speakers: "diagnostics.effect.speakers",
  translator: "diagnostics.effect.translator",
};

/** Button text: the verb for what happens when it is pressed. */
const FIX_LABEL = {
  routing: "diagnostics.fix.routing",
  sample_rate: "diagnostics.fix.sample_rate",
  capture_volume: "diagnostics.fix.capture_volume",
  listener: "diagnostics.fix.listener",
  sense_voice: "diagnostics.fix.sense_voice",
  voice_model: "diagnostics.fix.voice_model",
  old_voice: "diagnostics.fix.old_voice",
  speakers: "diagnostics.fix.speakers",
  translator: "diagnostics.fix.translator",
};

/** @param {import("@utils/api").Check} c */
const isProblem = (c) => c.status !== "ok" && !isOptional(c.id);

/** @param {import("@utils/api").Check[]} checks */
function groupStatus(checks) {
  if (checks.some((c) => isProblem(c) && c.status === "error")) return "error";
  if (checks.some(isProblem)) return "warning";
  if (checks.some((c) => c.status !== "ok")) return "optional";
  return "ok";
}

/** @param {import("@utils/api").Check[]} checks */
function groupSummary(checks) {
  const problems = checks.filter(isProblem).length;
  if (problems) return t("diagnostics.problems", { count: problems });
  if (checks.some((c) => c.status !== "ok")) return t("diagnostics.readyOptional");
  return t("diagnostics.ready");
}

/**
 * Diagnostics panel. Checks dependencies when opened and the audio routing
 * every few seconds. What prevents translating comes first, described by its
 * effect and with its fix; the rest is collapsed by groups.
 * @param {{ mode: "video" | "call", systemAudio?: boolean, onFixed?: () => void, onlyProblems?: boolean, expanded?: boolean,
 *   className?: string }} props
 *   `systemAudio`: Listen hears the Mac audio, without BlackHole. `onFixed` is
 *   called after a fix, so the app reads devices and settings again.
 *   `onlyProblems`: on the translate screen it only appears if something fails (the
 *   details are in Settings). `expanded`: the groups are visible from the start.
 *   `className`: one more class to place it where it goes.
 */
export default function Diagnostics({ mode, systemAudio = false, onFixed, onlyProblems = false, expanded = false, className }) {
  const t = useT();
  /** @type {[import("@utils/api").Check[], Function]} */
  const [allChecks, setChecks] = useState([]);
  // In video mode the microphone is not used: it is not a problem and does not need to be shown.
  const checks = allChecks.filter(
    (c) => !(mode === "video" && c.id === "microphone") && !(systemAudio && BLACKHOLE_CAPTURE.has(c.id)),
  );
  const [fixing, setFixing] = useState(null);
  const [error, setError] = useState(null);
  const [showDetails, setShowDetails] = useState(expanded);
  const [open, setOpen] = useState(/** @type {string | null} */ (null));

  /** Replaces the checks received and keeps the others. */
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
        // A full check also removes the ones that no longer apply.
        .then((fresh) => (full ? setChecks(fresh) : merge(fresh)))
        .catch((e) => setError(errorMessage(e))),
    [merge],
  );

  useEffect(() => {
    refresh(true);
    const timer = window.setInterval(() => refresh(false), AUDIO_POLL_MS);
    // The speakers add-on may be downloading in the background: check again when it ends.
    ensureSpeakers().then(() => refresh(true));
    return () => window.clearInterval(timer);
  }, [refresh]);

  const fix = async (id) => {
    setFixing(id);
    setError(null);
    try {
      // The speakers add-on joins the background download instead of starting a second one.
      if (id === "speakers") await ensureSpeakers().then(() => refresh(true));
      else merge(await api.fixDiagnostic(id));
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

  /** @param {import("@utils/api").Check} c */
  const fixButton = (c) =>
    c.fix &&
    c.status !== "ok" && (
      <button className={cx(styles.primary, styles.small)} onClick={() => fix(c.id)} disabled={fixing !== null}>
        {fixing === c.id ? (c.fix === "Descargar" ? t("diagnostics.downloading") : t("diagnostics.fixing")) : FIX_LABEL[c.id] ? t(FIX_LABEL[c.id]) : c.fix}
      </button>
    );

  if (checks.length === 0) {
    if (onlyProblems) return null;
    return (
      <section className={cx(styles.diagnostics, className)}>
        <div className={styles.diagBar}>
          <Spinner small />
          <strong>{t("diagnostics.checking")}</strong>
        </div>
      </section>
    );
  }

  const worst = problems.some((c) => c.status === "error") ? "error" : problems.length ? "warning" : "ok";
  if (onlyProblems && problems.length === 0) return null;

  return (
    <section className={cx(styles.diagnostics, worst === "error" && styles.isError, worst === "warning" && styles.isWarning, className)}>
      {problems.length === 0 ? (
        <div className={styles.diagBar}>
          <StatusIcon status="ok" />
          <strong>{t("diagnostics.allReady")}</strong>
          <LinkButton onClick={() => setShowDetails((v) => !v)} aria-expanded={showDetails}>
            {showDetails ? t("diagnostics.hideDetails") : t("diagnostics.showDetails")}
          </LinkButton>
        </div>
      ) : (
        <ul className={styles.diagProblems}>
          {problems.map((c) => (
            <li key={c.id} className={cx(styles.diagProblem, styles[c.status])}>
              <StatusIcon status={c.status} />
              <div className={styles.diagProblemText}>
                <p className={styles.diagEffect}>{EFFECT[c.id] ? t(EFFECT[c.id]) : c.title}</p>
                <p className={styles.diagWhy}>{c.detail}</p>
                {EFFECT[c.id] && <p className={styles.diagCause}>{t("diagnostics.cause", { title: c.title })}</p>}
              </div>
              {fixButton(c)}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="error">{error}</p>}

      {(showDetails || problems.length > 0) && (
        <div className={styles.diagGroups}>
          {groups.map((g) => {
            const status = groupStatus(g.checks);
            const expanded = open === g.key;
            return (
              <div key={g.key} className={cx(styles.diagGroup, expanded && styles.isOpen)}>
                <button className={styles.diagGroupHead} onClick={() => setOpen(expanded ? null : g.key)} aria-expanded={expanded}>
                  <StatusIcon status={status} />
                  <span className={styles.diagGroupTitle}>{t(g.title)}</span>
                  <span className={cx(styles.diagGroupSummary, styles[status])}>{groupSummary(g.checks)}</span>
                  <Chevron />
                </button>
                {expanded && (
                  <ul className={styles.diagItems}>
                    {g.checks.map((c) => (
                      <li key={c.id} className={styles.diagItem}>
                        <StatusIcon status={c.status === "ok" ? "ok" : isOptional(c.id) ? "optional" : c.status} />
                        <div>
                          <p className={styles.diagItemTitle}>
                            {c.title}
                            {isOptional(c.id) && <span className={styles.diagBadge}>{t("diagnostics.optional")}</span>}
                          </p>
                          <p className={styles.diagWhy}>{c.detail}</p>
                        </div>
                        {isOptional(c.id) && fixButton(c)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          <LinkButton className={styles.diagRecheck} onClick={() => refresh(true)}>
            {t("diagnostics.recheck")}
          </LinkButton>
        </div>
      )}
    </section>
  );
}

const icon = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" };

/** @param {{ status: "ok" | "warning" | "error" | "optional" }} props */
function StatusIcon({ status }) {
  return (
    <span className={cx(styles.diagIcon, styles[status])} aria-hidden>
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
    <svg {...icon} width={14} height={14} className={styles.diagChevron} aria-hidden>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
