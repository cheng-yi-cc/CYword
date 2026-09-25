// 这里只判断已到期的时间，不代替服务端验证签名。开发预览的非 JWT 令牌没有到期时间。
export function sessionExpiresAt(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch { return null; }
}
