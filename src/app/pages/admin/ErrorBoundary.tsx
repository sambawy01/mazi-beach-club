import React from 'react';
import { Button } from '@/app/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';

type Props = { children: React.ReactNode };
type State = { error: Error | null };

// Keeps a single crashing tab from blanking the whole admin. Shows a friendly
// panel with a reload, and logs the error for debugging.
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[admin] render error:', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-2xl border bg-white p-8 text-center max-w-md mx-auto my-10">
          <AlertTriangle className="size-8 text-amber-500 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-[#1b2350]">Something went wrong</h2>
          <p className="text-sm text-muted-foreground mt-1">This section hit an error and couldn't render. Your data is safe.</p>
          <p className="text-xs text-gray-400 mt-2 font-mono break-words">{this.state.error.message}</p>
          <div className="flex gap-2 justify-center mt-5">
            <Button variant="outline" size="sm" onClick={this.reset}><RefreshCw className="size-3 mr-1" /> Try again</Button>
            <Button size="sm" className="bg-[#12207e] hover:bg-[#0e1533] text-white" onClick={() => window.location.reload()}>Reload page</Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
