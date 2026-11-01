import { useVirtualMic } from "@hooks/useVirtualMic";
import { VIRTUAL_MIC } from "@utils/lanes";
import { useT } from "@i18n";
import { Button, cx } from "@components/shared";
import styles from "./styles.module.css";

/**
 * On the Speak card: warns when the other person will not hear the translated
 * voice, with the fix at hand. Either Lingora Mic is not installed, or it is
 * but the voice goes to another output (the speakers). Nothing when all is
 * well or outside the Mac. `className` gives the card's notice look.
 * @param {{ outputDevice: string, running: boolean, className?: string,
 *   onUse: () => void }} props
 */
export default function VirtualMicNotice({ outputDevice, running, className, onUse }) {
  const t = useT();
  const { status, busy, error, install } = useVirtualMic();

  if (!status?.available || (status.active && outputDevice === VIRTUAL_MIC)) return null;
  // Installed but macOS does not show it: installing again restarts the audio service.
  const missing = !status.installed || !status.active;
  return (
    <div className={cx(className, styles.micNotice)}>
      <p>
        {!status.installed
          ? t("app.lane.mic.missing")
          : status.active
            ? t("app.lane.mic.elsewhere", { name: outputDevice || t("app.lane.output.default") })
            : t("app.devices.mic.pending")}
        {error && (
          <span className={styles.micError} title={error}>
            {t("app.devices.mic.failed")}
          </span>
        )}
      </p>
      {missing ? (
        <Button
          onClick={async () => {
            if ((await install())?.active) onUse();
          }}
          busy={busy === "install"}
          disabled={running || Boolean(busy)}
        >
          {busy === "install"
            ? t("app.devices.mic.installing")
            : status.installed
              ? t("app.devices.mic.reinstall")
              : t("app.devices.mic.install")}
        </Button>
      ) : (
        <Button onClick={onUse} disabled={running}>
          {t("app.lane.mic.use")}
        </Button>
      )}
    </div>
  );
}
