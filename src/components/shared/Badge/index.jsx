import styles from "./styles.module.css";

/** Small label next to a title ("Notes", "Summary"). @param {{ children: import("react").ReactNode }} props */
export default function Badge({ children }) {
  return <span className={styles.badge}>{children}</span>;
}
