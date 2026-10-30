import styles from "./styles.module.css";

/**
 * The large title of a page (Notes, Settings), inside its column and
 * aligned with the content. `subtitle` goes below in gray; `children`, on the
 * right (filters, actions).
 * @param {{ title: import("react").ReactNode, subtitle?: import("react").ReactNode, children?: import("react").ReactNode }} props
 */
export default function PageHeader({ title, subtitle, children }) {
  return (
    <div className={styles.notesHead}>
      <div className={styles.notesHeadTitle}>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
