import styles from "./styles.module.css";

/** Etiqueta pequeña junto a un título («Notas», «Resumen»). @param {{ children: import("react").ReactNode }} props */
export default function Badge({ children }) {
  return <span className={styles.badge}>{children}</span>;
}
