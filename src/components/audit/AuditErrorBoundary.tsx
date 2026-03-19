import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class AuditErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorMessage: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error?.message || "Erro desconhecido" };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("App render error", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--background))] p-6">
          <div className="max-w-md rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 text-center shadow-sm">
            <h1 className="text-[24px] font-bold text-[hsl(var(--foreground))]">Algo deu errado</h1>
            <p className="mt-3 text-[15px] text-[hsl(var(--muted-foreground))]">
              Recarregue a tela para continuar. Se o problema persistir, entre em contato com o suporte.
            </p>
            <p className="mt-2 text-[12px] text-[hsl(var(--muted-foreground))]/60 font-mono break-all">
              {this.state.errorMessage}
            </p>
            <Button onClick={this.handleReload} className="mt-6">
              Recarregar
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
