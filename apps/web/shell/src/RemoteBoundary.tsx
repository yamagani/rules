import { Component, type ReactNode } from 'react';

interface Props {
  name: string;
  onRetry?: () => void;
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Isolates a remote: if it fails to load or throws, only its slot shows an error. */
export class RemoteBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error(JSON.stringify({ level: 'error', msg: 'remote_failed', remote: this.props.name, error: error.message }));
  }

  override render() {
    if (this.state.error) {
      return (
        <div role="alert" data-testid="remote-error" className="rr-error">
          <strong>{this.props.name} is unavailable.</strong>
          <p style={{ margin: '4px 0 8px' }}>The rest of the app keeps working. Details: {this.state.error.message}</p>
          <button
            type="button"
            className="rr-btn"
            onClick={() => {
              this.setState({ error: null });
              this.props.onRetry?.();
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
