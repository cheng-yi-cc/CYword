import { useState, useEffect, useRef } from "react";
import type { UserSession } from "../types";

const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/u;

function formatAuthError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/^Error invoking remote method '[^']+': (?:Error: )?/i, "")
    .trim();
}

interface AuthModalProps {
  onSuccess: (session: UserSession) => void;
}

export function AuthModal({ onSuccess }: AuthModalProps) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState<{ type: "info" | "error" | "success"; text: string } | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  const startCountdown = (seconds = 60) => {
    setCountdown(seconds);
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) window.clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleSendCode = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !EMAIL_PATTERN.test(trimmedEmail)) {
      setMessage({ type: "error", text: "请输入有效的邮箱地址" });
      return;
    }

    setSendingCode(true);
    setMessage(null);

    try {
      let result: { success: boolean; message?: string; simulated?: boolean; debugCode?: string; error?: string };
      if (window.cyword?.sendAuthCode) {
        result = await window.cyword.sendAuthCode(trimmedEmail);
      } else {
        // 浏览器环境直接请求
        const res = await fetch("/api/auth/send-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmedEmail }),
        });
        result = await res.json();
      }

      if (!result.success) {
        throw new Error(result.error || "发送验证码失败");
      }

      if (result.simulated || result.debugCode) {
        if (!import.meta.env.DEV || !result.debugCode) {
          throw new Error("认证服务配置异常，请稍后再试");
        }
        setCode(result.debugCode);
        setMessage({
          type: "info",
          text: `【开发模式】验证码已自动填入：${result.debugCode}`,
        });
      } else {
        setMessage({
          type: "success",
          text: "验证码已发送，请检查收件箱（若未收到请查看垃圾箱）",
        });
      }
      startCountdown(60);
    } catch (err) {
      setMessage({
        type: "error",
        text: formatAuthError(err),
      });
    } finally {
      setSendingCode(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedCode = code.trim();

    if (!trimmedEmail || !EMAIL_PATTERN.test(trimmedEmail)) {
      setMessage({ type: "error", text: "请输入有效的邮箱地址" });
      return;
    }

    if (!trimmedCode || !/^\d{6}$/.test(trimmedCode)) {
      setMessage({ type: "error", text: "请输入 6 位数字验证码" });
      return;
    }

    setVerifying(true);
    setMessage(null);

    try {
      let result: { success: boolean; token?: string; user?: any; error?: string };
      if (window.cyword?.verifyAuthCode) {
        result = await window.cyword.verifyAuthCode(trimmedEmail, trimmedCode);
      } else {
        const res = await fetch("/api/auth/verify-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmedEmail, code: trimmedCode }),
        });
        result = await res.json();
      }

      if (!result.success || !result.token || !result.user) {
        throw new Error(result.error || "验证失败，请重试");
      }

      const session: UserSession = {
        token: result.token,
        user: result.user,
      };

      if (window.cyword?.writeSession) {
        await window.cyword.writeSession(session);
      } else {
        localStorage.setItem("cyword_session", JSON.stringify(session));
      }

      onSuccess(session);
    } catch (err) {
      setMessage({
        type: "error",
        text: formatAuthError(err),
      });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="auth-overlay">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo">Cy</div>
          <h2>欢迎使用 CYword</h2>
          <p>输入邮箱获取验证码，新用户将自动完成注册</p>
        </div>

        <form className="auth-form" onSubmit={handleVerify}>
          <div className="form-group">
            <label htmlFor="auth-email">电子邮箱</label>
            <div className="input-with-action">
              <input
                id="auth-email"
                type="email"
                placeholder="your-name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={sendingCode || verifying}
                autoFocus
                required
              />
              <button
                type="button"
                className="btn-send-code"
                onClick={handleSendCode}
                disabled={countdown > 0 || sendingCode || !email.trim()}
              >
                {sendingCode ? "发送中…" : countdown > 0 ? `${countdown}s 后重试` : "获取验证码"}
              </button>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="auth-code">6 位验证码</label>
            <input
              id="auth-code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="请输入 6 位数字验证码"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              disabled={verifying}
              required
            />
          </div>

          {message && (
            <div className={`auth-message ${message.type}`}>
              {message.text}
            </div>
          )}

          <button
            type="submit"
            className="auth-submit-btn"
            disabled={verifying || code.trim().length !== 6 || !email.trim()}
          >
            {verifying ? "正在登录…" : "登 录 / 注 册"}
          </button>
        </form>

        <div className="auth-footer">
          <small>背单词学习进度保存在本机，登录用于识别用户身份与提供云端服务</small>
        </div>
      </div>
    </div>
  );
}
