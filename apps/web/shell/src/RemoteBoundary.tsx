import { Component, type ReactNode } from 'react';

interface Props {
  name: string;
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
        <div role="alert" data-testid="remote-error" style={{ padding: 16, border: '1px solid #e5a3a3', borderRadius: 8, background: '#fdf2f2' }}>
          <strong>{this.props.name} is unavailable.</strong>
          <p style={{ margin: '4px 0 0' }}>The rest of the app keeps working. Details: {this.state.error.message}</p>
          <button type="button" onClick={() => this.setState({ error: null })}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}
