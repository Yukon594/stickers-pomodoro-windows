import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[贴纸番茄钟] 捕获到未处理的错误:", error.message, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-card">
            <strong>贴纸番茄钟遇到了一点问题</strong>
            <p>不好意思，出了点小差错。试试重启？</p>
            {this.state.error ? <code>{this.state.error.message}</code> : null}
            <button type="button" onClick={this.handleRetry}>
              再试一次
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
