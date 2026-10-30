import styles from "./styles.module.css";

/**
 * El título grande de una página (Notas, Ajustes), dentro de su columna y
 * alineado con el contenido. `subtitle` va debajo en gris; `children`, a la
 * derecha (filtros, acciones).
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
