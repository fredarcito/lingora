import { cx } from "../cx";

/**
 * Botón con aspecto de enlace («Volver», «Ver detalles»).
 * @param {{ className?: string } & import("react").ComponentProps<"button">} props
 */
export default function LinkButton({ className, ...rest }) {
  return <button className={cx("link", className)} {...rest} />;
}
