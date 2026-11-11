import { useRef, useState } from "react";
import Diagnostics from "@components/Diagnostics";
import LaneCard from "@components/LaneCard";
import SaveNotesBar from "@components/SaveNotesBar";
import LaneSettings from "@components/LaneSettings";
import TopBar from "@components/TopBar";
import Home from "@pages/Home";
import NoteTaking from "@pages/NoteTaking";
import Notes from "@pages/Notes";
import { cx } from "@components/shared";
import Settings from "@pages/Settings";
import Sidebar from "@components/Sidebar";
import { loadNotesCaptions, loadNotesConsent, loadNotesInput, loadNotesListen, storeNotesCaptions, storeNotesInput, storeNotesListen } from "@utils/notePrefs.js";
import { t, useT } from "@i18n";
import { useAudioRoute } from "@hooks/useAudioRoute.js";
import { useDevices } from "@hooks/useDevices.js";
import { useFloatingCaptions } from "@hooks/useFloatingCaptions.js";
import { useLaneSettings } from "@hooks/useLaneSettings.js";
import { useLanguages } from "@hooks/useLanguages.js";
import { useMeetingNotes } from "@hooks/useMeetingNotes.js";
import { useModelRelease } from "@hooks/useModelRelease.js";
import { useNavigation } from "@hooks/useNavigation.js";
import { useNoteRecorder } from "@hooks/useNoteRecorder.js";
import { useStoredPref } from "@hooks/useStoredPref.js";
import { useTranslationPipeline } from "@hooks/useTranslationPipeline.js";
import { useWidth } from "@hooks/useWidth.js";
import { NO_SIGNAL_SECS, needsSenseVoice, resolveLanes } from "@utils/lanes";
import { CALL_MODE, loadMode, loadNoTranslate, loadPair, storeMode, storeNoTranslate, storePair } from "@utils/prefs.js";
import styles from "./styles.module.css";

/**
 * @typedef {import("./types").Lane} Lane
 * @typedef {import("./types").Mode} Mode
 */

/** En llamada con un solo carril en marcha, cuál ocupa casi todo el ancho. */
const FOCUS_CLASS = { local_to_remote: styles.focusLocalToRemote, remote_to_local: styles.focusRemoteToLocal };

/**
 * The frame of the app and the Translate screen. It only joins the pieces:
 * the live translation is in `useTranslationPipeline`, the note being written
 * in `useNoteRecorder` and the lanes as they run in `resolveLanes`.
 */
export default function App() {
  // Repinta al cambiar de idioma; los textos se piden con `t` del módulo.
  useT();
  const [pair, changePair] = useStoredPref(loadPair, storePair);
  const [mode, changeMode] = useStoredPref(loadMode, storeMode);
  // Solo en Traducir audio: en una llamada la otra persona necesita oírte traducido.
  const [noTranslate, changeNoTranslate] = useStoredPref(loadNoTranslate, storeNoTranslate);
  // Tomar notas: qué se escucha y la familia de idiomas; no tocan los ajustes de Escuchar.
  const [notesInput, changeNotesInput] = useStoredPref(loadNotesInput, storeNotesInput);
  const [notesListen, changeNotesListen] = useStoredPref(loadNotesListen, storeNotesListen);
  const [notesCaptions, changeNotesCaptions] = useStoredPref(loadNotesCaptions, storeNotesCaptions);
  // The floating captions window; here because Take notes only translates while it is open.
  const [floating, setFloating] = useState(false);
  const { laneSettings, setLanes, updateLane } = useLaneSettings();
  const { languagesRef, langInfo, shownLanguages } = useLanguages();
  // Antes de los dispositivos: al conectar algo no se releen mientras traduce.
  const anyRunningRef = useRef(false);
  const { devices, systemAudio, loadDevices } = useDevices({ setLanes, anyRunningRef });

  // Reunión en línea: el audio del Mac y tu micrófono a la vez.
  const meeting = mode === "notes" && notesInput === "meeting" && systemAudio;
  const lanes = resolveLanes(laneSettings, { pair, mode, meeting, notesInput, notesListen, notesCaptions, floating, noTranslate, systemAudio, langInfo });
  // El modo rápido se lee en cada trozo: se puede comparar sin detener el carril.
  const lanesRef = useRef(lanes);
  lanesRef.current = lanes;
  // La conversación que se está guardando (ver noteRecorder.js).
  const recorderRef = useRef(/** @type {ReturnType<typeof import("@utils/noteRecorder.js").createRecorder> | null} */ (null));
  const [modeRef, modeWidth] = useWidth();
  const { view, setView, home, goTo, openRequest, openNote, menuOpen, openMenu, closeMenu } = useNavigation();
  // Al terminar Tomar notas se abre la nota; `stopping` es la parada en curso.
  const stopping = useRef(/** @type {Promise<void> | null} */ (null));

  // A mode picked on Home or in the menu: Translate in that mode (with a lane running, it only goes back to it).
  /** @param {Mode} next */
  const pickMode = (next) => {
    if (!anyRunningRef.current) changeMode(next);
    goTo("translate");
  };

  const { state, runtime, meters, volumes, changeVolume, multiVoice, start, stop } = useTranslationPipeline({ lanesRef, languagesRef, recorderRef });

  const remoteLane = /** @type {Lane} */ (lanes.find((l) => l.direction === "remote_to_local"));
  const remoteState = state.remote_to_local;

  const { inputs, outputs } = devices;
  // En modo vídeo solo se traduce lo que se oye.
  const visible = mode !== "call" ? lanes.filter((l) => l.direction === "remote_to_local") : lanes;
  const running = lanes.filter((l) => state[l.direction].running || state[l.direction].starting);
  const anyRunning = running.length > 0;
  anyRunningRef.current = anyRunning;
  // Tomar notas en una reunión en línea: los dos carriles a la vez.
  const localState = state.local_to_remote;
  const meetingNotes = useMeetingNotes({
    mode,
    meeting,
    remoteLane,
    localLane: /** @type {Lane} */ (lanes.find((l) => l.direction === "local_to_remote")),
    state,
    lanesRef,
    runtime,
    start,
    stop,
    stopping,
  });
  const { inMeeting } = meetingNotes;
  // In Take notes the floating ▶ / ❚❚ starts and stops the whole note (both lanes in a meeting).
  const { toggleFloating } = useFloatingCaptions(
    mode === "notes"
      ? {
          floating,
          setFloating,
          remoteLane,
          remoteState,
          // The privacy notice is only shown on the Take notes screen.
          start: async () => void (loadNotesConsent() && meetingNotes.startNotes()),
          stop: async () => meetingNotes.stopNotes(),
        }
      : { floating, setFloating, remoteLane, remoteState, start, stop },
  );

  const { notesActions, saveNotes, changeSaveNotes, closing } = useNoteRecorder({
    recorderRef,
    mode,
    anyRunning,
    anyRunningRef,
    view,
    runtime,
    stopping,
    wrapRecorder: meetingNotes.wrapRecorder,
    onSaved: openNote,
  });
  useModelRelease(anyRunning);
  // Con un solo carril en marcha, ese ocupa casi todo el ancho y el otro se
  // queda en su control: los subtítulos necesitan el espacio.
  const focused = mode === "call" && running.length === 1 ? running[0].direction : null;
  // Antes de empezar, lo que hay conectado, para la pista de Reunión en línea.
  const shownRoute = useAudioRoute(mode === "notes" && !anyRunning && view === "translate");
  // Las comprobaciones de BlackHole solo valen si Escuchar lo usa: con el audio
  // del Mac o con un micrófono no hace falta.
  const listenFrom = laneSettings.find((l) => l.direction === "remote_to_local")?.inputDeviceId;
  const noBlackHole = !/blackhole 2ch/i.test(inputs.find((d) => d.webId === listenFrom)?.name ?? "");

  return (
    <>
    <Home
      visible={view === "home"}
      mode={mode}
      running={anyRunning}
      callMode={CALL_MODE}
      pair={pair}
      languages={shownLanguages}
      onPair={changePair}
      noTranslate={noTranslate}
      onPick={pickMode}
      onMenu={openMenu}
      onOpenNote={openNote}
      onSeeAll={() => goTo("notes")}
    />
    <main className="app" hidden={view !== "translate"}>
      <TopBar
        modeRef={modeRef}
        mode={mode}
        onMode={changeMode}
        callMode={CALL_MODE}
        running={anyRunning}
        onMenu={openMenu}
        pair={pair}
        languages={shownLanguages}
        onPair={changePair}
        noTranslate={noTranslate}
      />

      {/* Aquí solo si algo falla; el detalle está en Ajustes. */}
      <Diagnostics
        mode={mode === "call" ? "call" : "video"}
        systemAudio={noBlackHole}
        onFixed={loadDevices}
        onlyProblems
        // The add-on for Chinese, Japanese and Korean is optional, but not when a lane hears one of them.
        required={needsSenseVoice(mode === "notes" ? lanes : visible, shownLanguages) ? ["sense_voice"] : []}
      />

      {/* In Take notes, My notes is as wide as the mode selector above it. */}
      <div key={mode} className={styles.modeBody} style={modeWidth ? { "--mode-w": `${modeWidth}px` } : undefined}>
        {mode === "notes" ? (
          <NoteTaking
            running={remoteState.running}
            starting={remoteState.starting || localState.starting}
            closing={closing}
            error={remoteState.error}
            micError={meetingNotes.micError}
            heard={[...remoteState.heard, ...(inMeeting ? localState.heard : [])]}
            partial={remoteState.partial || (inMeeting ? localState.partial : "")}
            noSignal={Boolean(remoteState.running && meters.remote_to_local && meters.remote_to_local.silentSecs > NO_SIGNAL_SECS)}
            input={notesInput}
            onInput={changeNotesInput}
            listen={notesListen}
            onListen={changeNotesListen}
            systemAudio={systemAudio}
            languages={shownLanguages}
            route={shownRoute}
            onOpenSettings={() => setView("settings")}
            captions={notesCaptions}
            onCaptions={changeNotesCaptions}
            floating={floating}
            onFloating={toggleFloating}
            onStart={meetingNotes.startNotes}
            onStop={meetingNotes.stopNotes}
            notesActions={notesActions}
          />
        ) : (
          <>
            {/* In a call the note is written by both lanes: the switch goes above them. */}
            {mode === "call" && <SaveNotesBar checked={saveNotes} onChange={changeSaveNotes} />}
            <div className={cx("lanes", mode === "video" && "single", focused && FOCUS_CLASS[focused])}>
              {visible.map((lane) => (
                <LaneCard
                  key={lane.direction}
                  lane={lane}
                  compact={Boolean(focused) && focused !== lane.direction}
                  original={mode === "video" && lane.direction === "remote_to_local" ? noTranslate : undefined}
                  onOriginal={changeNoTranslate}
                  state={state[lane.direction]}
                  meter={meters[lane.direction]}
                  volume={volumes[lane.direction]}
                  inputs={inputs}
                  onOpenSettings={() => setView("settings")}
                  onToggle={() => (state[lane.direction].running ? stop(lane) : start(lane))}
                  onChange={(patch) => updateLane(lane.direction, patch)}
                  onVolume={(v) => changeVolume(lane.direction, v)}
                  saveNotes={mode === "video" && lane.direction === "remote_to_local" ? saveNotes : undefined}
                  onSaveNotes={changeSaveNotes}
                  floating={lane.direction === "remote_to_local" ? floating : undefined}
                  onFloating={toggleFloating}
                  multiVoice={lane.direction === "remote_to_local" ? multiVoice : undefined}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </main>
    <Notes visible={view === "notes"} recording={anyRunning} languages={shownLanguages} onMenu={openMenu} openRequest={openRequest} home={home} />
    {view === "settings" && (
      <Settings
        key={home}
        mode={mode === "call" ? "call" : "video"}
        systemAudio={noBlackHole}
        recording={anyRunning}
        languages={shownLanguages}
        onFixed={loadDevices}
        onMenu={openMenu}
        // En Tomar notas la entrada del carril es la que se eligió allí: aquí van
        // los dispositivos guardados de Escuchar, para que no desaparezcan.
        lanes={(mode === "notes"
          ? laneSettings.filter((l) => l.direction === "remote_to_local").map((l) => ({ ...l, title: t(`lanes.${l.direction}.title`) }))
          : visible
        ).map((lane) => ({
          key: lane.direction,
          title: lane.title,
          subtitle: t(`lanes.${lane.direction}.settingsSubtitle`),
          content: (
            <LaneSettings
              lane={lane}
              running={state[lane.direction].running}
              inputs={inputs}
              outputs={outputs}
              systemAudio={systemAudio}
              onChange={(patch) => updateLane(lane.direction, patch)}
            />
          ),
        }))}
      />
    )}
    <Sidebar open={menuOpen} view={view} mode={mode} callMode={CALL_MODE} recording={anyRunning} onSelect={goTo} onPickMode={pickMode} onClose={closeMenu} />
    </>
  );
}
