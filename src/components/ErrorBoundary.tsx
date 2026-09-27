import { Component, type ErrorInfo, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode; onBack?: () => void; root?: boolean }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Do not log learning content, account details or arbitrary failed props.
    console.error("CYword: content rendering failed");
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="content-error" role="alert">
      <h2>{this.props.root ? "界面暂时无法显示" : "这部分内容暂时无法显示"}</h2>
      <p>已保存的学习记录仍保留。请重试，未评级的单词不会计为完成。</p>
      <button onClick={() => this.props.root ? location.reload() : this.setState({ failed: false })}>重试</button>
      {this.props.onBack && <button onClick={this.props.onBack}>返回首页</button>}
    </section>;
  }
}
