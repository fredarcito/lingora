/** Rueda de espera. `small`, para dentro de un botón o una línea de texto. @param {{ small?: boolean }} props */
export default function Spinner({ small = false }) {
  return <span className={small ? "spinner small" : "spinner"} aria-hidden />;
}
