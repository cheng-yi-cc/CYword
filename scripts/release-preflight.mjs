const origin = "https://cyword.chengyi.me";

/** Check the deployed reader before publishing a pointer it might not understand. */
export async function assertReleaseSchemaSupport(android = false, request = fetch) {
  const endpoint = `${origin}/downloads/${android ? "android/" : ""}latest.json`;
  let response;
  try {
    response = await request(endpoint, {
      method: "HEAD", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new Error(`无法确认官网发布清单兼容性，未写入 R2。请先部署官网函数（npm run deploy:site）并重试：${error instanceof Error ? error.message : "连接失败"}`);
  }
  // This header is present even when a brand-new site has no current pointer yet.
  const supported = response.headers.get("X-CYword-Release-Schemas")?.split(",").map((value) => value.trim()) ?? [];
  if (!supported.includes("2")) {
    throw new Error("官网函数尚未确认支持发布清单 v2，未写入 R2。请先部署官网函数（npm run deploy:site），再发布安装包。");
  }
}
