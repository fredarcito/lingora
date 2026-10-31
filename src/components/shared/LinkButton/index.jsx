import { cx } from "@components/shared/cx";

/**
 * Button that looks like a link ("Back", "View details").
 * @param {{ className?: string } & import("react").ComponentProps<"button">} props
 */
export default function LinkButton({ className, ...rest }) {
  return <button className={cx("link", className)} {...rest} />;
}
