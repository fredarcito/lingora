import { SYSTEM_AUDIO } from "@utils/audio";
import { feedsCapture } from "@utils/lanes";
import { useT } from "@i18n";

/**
 * The devices of a lane, on the Settings page: where it listens from and
 * where it speaks. They are chosen once; same rules the card had.
 * @param {{ lane: import("@app/types").Lane, running: boolean, inputs: any[], outputs: any[], systemAudio: boolean,
 *   onChange: (patch: Partial<import("@app/types").Lane>) => void }} props
 */
export default function LaneSettings({ lane, running, inputs, outputs, systemAudio, onChange }) {
  const t = useT();
  const speaks = lane.speak && lane.sourceLang !== lane.targetLang;
  const tapsMac = lane.inputDeviceId === SYSTEM_AUDIO;
  return (
    <div className="prefs-fields">
      <label className="field">
        <span>{lane.direction === "remote_to_local" ? t("app.devices.listenFrom") : t("app.devices.mic")}</span>
        <select value={lane.inputDeviceId} onChange={(e) => onChange({ inputDeviceId: e.target.value })} disabled={running}>
          {systemAudio && lane.direction === "remote_to_local" && <option value={SYSTEM_AUDIO}>{t("app.devices.macRecommended")}</option>}
          <option value="">{t("app.lane.input.default")}</option>
          {inputs.map((d) => (
            <option key={d.uid} value={d.webId} disabled={!d.webId}>
              {d.webId ? d.name : t("app.devices.unavailable", { name: d.name })}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t("app.devices.outputTo")}</span>
        <select value={lane.outputDevice} onChange={(e) => onChange({ outputDevice: e.target.value })} disabled={running}>
          <option value="">
            {tapsMac && lane.direction === "remote_to_local" ? t("app.devices.outputRecommended") : t("app.lane.output.default")}
          </option>
          {outputs.map((d) => (
            // With Mac audio, Lingora's own voice never enters the capture.
            <option key={d.uid} value={d.name} disabled={!tapsMac && feedsCapture(d.name)}>
              {!tapsMac && feedsCapture(d.name) ? t("app.devices.loop", { name: d.name }) : d.name}
            </option>
          ))}
        </select>
        {!speaks && <span className="field-hint">{t("app.devices.outputHint")}</span>}
      </label>
      {running && <p className="settings-note">{t("app.devices.stopToChange")}</p>}
    </div>
  );
}
