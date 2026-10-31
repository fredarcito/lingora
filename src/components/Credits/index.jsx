import { useCallback, useState } from "react";
import { Dialog, LinkButton, Spinner } from "@components/shared";
import { CREDITS } from "@utils/credits.js";
import { useT } from "@i18n";
import styles from "./styles.module.css";

/** @typedef {import("@utils/credits.js").Credit} Credit */

/**
 * Third-party licenses: the models and libraries Lingora uses, each with its license text
 * (`public/licenses/`) in a dialog. The only place where model names are shown.
 */
export default function Credits() {
  const t = useT();
  const [open, setOpen] = useState(/** @type {{ credit: Credit, text: string | null } | null} */ (null));
  const close = useCallback(() => setOpen(null), []);

  /** @param {Credit} credit */
  const show = (credit) => {
    setOpen({ credit, text: null });
    fetch(`/licenses/${credit.licenseFile}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((text) => setOpen((cur) => (cur?.credit === credit ? { credit, text } : cur)))
      .catch(() => setOpen((cur) => (cur?.credit === credit ? { credit, text: t("credits.loadError") } : cur)));
  };

  return (
    <div className={styles.credits}>
      <p className="muted">{t("credits.hint")}</p>
      {(/** @type {const} */ (["model", "library"])).map((kind) => (
        <div key={kind} className={styles.group}>
          <h3>{t(kind === "model" ? "credits.models" : "credits.libraries")}</h3>
          <ul>
            {CREDITS.filter((c) => c.kind === kind).map((c) => (
              <li key={c.id} className={styles.row}>
                <div className={styles.info}>
                  <strong>{c.name}</strong>
                  <span className={styles.author}> · {c.author}</span>
                  <small>{t(`credits.purpose.${c.id}`)}</small>
                  <small className={styles.url}>
                    {t("credits.source")}: {c.url}
                  </small>
                </div>
                <LinkButton onClick={() => show(c)}>{c.license}</LinkButton>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {open && (
        <Dialog title={`${open.credit.name} · ${open.credit.license}`} closeLabel={t("credits.close")} onClose={close}>
          {open.text === null ? <Spinner /> : <pre className={styles.text}>{open.text}</pre>}
        </Dialog>
      )}
    </div>
  );
}
