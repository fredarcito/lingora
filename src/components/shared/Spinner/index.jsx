/** Loading wheel. `small`, for inside a button or a line of text. @param {{ small?: boolean }} props */
export default function Spinner({ small = false }) {
  return <span className={small ? "spinner small" : "spinner"} aria-hidden />;
}
