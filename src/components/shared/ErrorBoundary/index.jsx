import { Component } from "react";
import Button from "../Button";
import styles from "./styles.module.css";

/**
 * Catches a render error below it and shows a short notice with a reload
 * button instead of a blank window. The error goes to `console.error`, which
 * `captureErrors` also sends to the app's log.
 * @extends {Component<{ title: string, body: string, reloadLabel: string, children?: import("react").ReactNode }, { failed: boolean }>}
 */
export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  /** @param {Error} error @param {import("react").ErrorInfo} info */
  componentDidCatch(error, info) {
    console.error("[lingora] interface error:", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { title, body, reloadLabel } = this.props;
    return (
      <div className={styles.errorBoundary} role="alert">
        <h2>{title}</h2>
        <p>{body}</p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          {reloadLabel}
        </Button>
      </div>
    );
  }
}
