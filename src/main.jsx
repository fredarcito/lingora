import "./styles.css";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import FloatingCaptions from "./pages/FloatingCaptions";
import LangOffer from "./components/LangOffer";
import Welcome, { WelcomeBoundary, needsWelcome } from "./pages/Welcome";
import { I18nProvider } from "./i18n";
import { captureErrors } from "./utils/log";
import { ensureSpeakers } from "./utils/notes";

// Interface errors also go to the app's log.
captureErrors();

// The floating subtitles window loads this same page; Rust marks which one it is.
const floating = /** @type {any} */ (window).__LINGORA_VIEW === "captions";
if (floating) document.documentElement.classList.add("view-captions");

/** Welcome screen the first time; if something fails while checking, go straight to the app. */
function Main() {
  const [welcome, setWelcome] = useState(/** @type {boolean | null} */ (null));
  useEffect(() => {
    needsWelcome()
      .then(setWelcome)
      .catch(() => setWelcome(false));
  }, []);
  // Past the welcome, what it may have skipped: telling people apart in notes.
  useEffect(() => {
    if (welcome === false) ensureSpeakers();
  }, [welcome]);
  if (welcome === null) return null;
  if (!welcome)
    return (
      <>
        <App />
        <LangOffer />
      </>
    );
  return (
    <WelcomeBoundary onDone={() => setWelcome(false)}>
      <Welcome onDone={() => setWelcome(false)} />
    </WelcomeBoundary>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <I18nProvider>{floating ? <FloatingCaptions /> : <Main />}</I18nProvider>
  </StrictMode>,
);
