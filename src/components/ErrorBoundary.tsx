import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

// Red de seguridad de último recurso: sin esto, una excepción de render en CUALQUIER parte del
// árbol deja el #root completamente vacío (pantalla en blanco), como pasó con un selector de
// zustand roto en TriggersModal. No intenta recuperar el estado roto — solo evita la pantalla en
// blanco y ofrece recargar, que sí limpia cualquier estado de React corrupto.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-box">
            <div className="error-boundary-title">Algo se rompió</div>
            <div className="error-boundary-message">{this.state.error.message}</div>
            <button className="error-boundary-btn" onClick={() => location.reload()}>Recargar</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
