import { useVirtualMic } from "@hooks/useVirtualMic";
import { useT } from "@i18n";
import { Button } from "@components/shared";
import styles from "./styles.module.css";

/**
 * Settings → Speak: installs or removes "Lingora Mic", the virtual microphone
 * the call uses to hear the translated voice (see `useVirtualMic`).
 * Installing restarts the Mac's audio for a second, so it waits while
 * translating. Shows nothing where the app does not carry the driver (outside the Mac).
 * @param {{ running: boolean, onChange: (active: boolean) => void }} props
 */
export default function VirtualMic({ running, onChange }) {
  const t = useT();
  const { status, busy, error, install, uninstall } = useVirtualMic();

  /** @param {() => Promise<import("@utils/api").VirtualMicStatus | null>} action */
  const run = async (action) => {
    const next = await action();
    if (next) onChange(next.active);
  };

  if (!status?.available) return null;
  const hint = status.active ? t("app.devices.mic.active") : status.installed ? t("app.devices.mic.pending") : t("app.devices.mic.hint");
  return (
    <div className={styles.virtualMic}>
      <div className="prefs-row prefs-row-static">
        <span>
          <strong>{t("app.devices.mic.title")}</strong>
          <small>{hint}</small>
        </span>
        {status.active ? (
          <Button onClick={() => run(uninstall)} busy={busy === "remove"} disabled={running || Boolean(busy)}>
            {busy === "remove" ? t("app.devices.mic.removing") : t("app.devices.mic.remove")}
          </Button>
        ) : (
          <Button variant="primary" onClick={() => run(install)} busy={busy === "install"} disabled={running || Boolean(busy)}>
            {busy === "install"
              ? t("app.devices.mic.installing")
              : status.installed
                ? t("app.devices.mic.reinstall")
                : t("app.devices.mic.install")}
          </Button>
        )}
      </div>
      {error && (
        <p className="notes-error" title={error}>
          {t("app.devices.mic.failed")}
        </p>
      )}
    </div>
  );
}
