import { useT } from "@i18n";
import { IconButton, MoonIcon, SunIcon } from "@components/shared";
import { effectiveTheme, useTheme } from "@hooks/useTheme.js";

/**
 * Quick light/dark switch, at the end of every screen's header. It shows the
 * theme you would switch to; with «Like the Mac» it sets the opposite of what
 * is showing now (Settings → Appearance can go back to following the Mac).
 */
export default function ThemeToggle() {
  const t = useT();
  const [theme, setTheme] = useTheme();
  const light = effectiveTheme(theme) === "light";
  return (
    <IconButton label={light ? t("home.theme.dark") : t("home.theme.light")} onClick={() => setTheme(light ? "dark" : "light")}>
      {light ? <MoonIcon /> : <SunIcon />}
    </IconButton>
  );
}
