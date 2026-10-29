// Copia de src/Segmented.jsx de antes del refactor (ya movido a src/ui/Segmented).
export default function Segmented({ value, onChange, options, small }) {
  return (
    <div className={small ? "segmented small" : "segmented"}>
      {options.map((o) => (
        <button className={value === o.value ? "is-selected" : ""}>
          {value === o.value && <span className="seg-check" aria-hidden>✓</span>}
        </button>
      ))}
    </div>
  );
}
