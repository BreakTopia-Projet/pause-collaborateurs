import { Component } from 'react';

/**
 * React Error Boundary — catches render errors and shows a fallback UI
 * instead of a white screen.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60vh',
          padding: '2rem',
          fontFamily: 'Inter, system-ui, sans-serif',
          color: '#333',
        }}>
          <div style={{
            background: '#fff',
            border: '1px solid #e0e0e0',
            borderRadius: '12px',
            padding: '2rem 3rem',
            textAlign: 'center',
            maxWidth: '480px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          }}>
            <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.3rem', color: '#001155' }}>
              Une erreur est survenue
            </h2>
            <p style={{ margin: '0 0 1.5rem', fontSize: '0.95rem', color: '#666' }}>
              L'application a rencontré un problème inattendu. Veuillez recharger la page.
            </p>
            {this.state.error && (
              <pre style={{
                background: '#f8f8f8',
                padding: '0.75rem',
                borderRadius: '6px',
                fontSize: '0.75rem',
                color: '#c00',
                textAlign: 'left',
                overflow: 'auto',
                maxHeight: '120px',
                marginBottom: '1rem',
              }}>
                {this.state.error.message || String(this.state.error)}
              </pre>
            )}
            <button
              onClick={this.handleReload}
              style={{
                background: '#001155',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '0.6rem 1.5rem',
                fontSize: '0.95rem',
                cursor: 'pointer',
              }}
            >
              Recharger la page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
