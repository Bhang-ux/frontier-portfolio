import { Component, type ErrorInfo, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Frontier page error', error, info.componentStack);
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card card-pad mx-auto mt-10 max-w-xl text-center">
        <div className="text-lg font-semibold">Something went wrong on this page</div>
        <p className="mt-2 text-sm text-ink-3">{this.state.error.message}</p>
        <button className="btn-ghost mt-4" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
