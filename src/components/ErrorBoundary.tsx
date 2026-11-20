import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
  detail?: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    let message = error.message || 'An unexpected error occurred.';
    let detail: string | undefined;
    try {
      const parsed = JSON.parse(error.message);
      if (parsed && parsed.error && parsed.operationType) {
        message = `Permission or network error during ${parsed.operationType} on ${parsed.path || 'Firestore'}.`;
        detail = parsed.error;
      }
    } catch {
      // Plain error message
    }
    return { hasError: true, message, detail };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('FikaBoda ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F7F8F5] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-[#E3E7E2] rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-[#123C32]">
              <div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-display font-semibold text-base text-[#17231F]">
                  Application Error
                </h2>
                <p className="text-xs text-[#77827B]">FikaBoda caught a runtime exception</p>
              </div>
            </div>
            <p className="text-sm text-[#17231F] leading-relaxed">{this.state.message}</p>
            {this.state.detail && (
              <pre className="text-xs font-mono bg-[#F7F8F5] border border-[#E3E7E2] rounded-lg p-3 overflow-x-auto text-[#77827B]">
                {this.state.detail}
              </pre>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#123C32] text-white text-sm font-medium hover:bg-[#0D2E26] transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              Reload FikaBoda
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
