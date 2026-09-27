// One gate for window close, app quit and update installation. No action is
// allowed until renderer saves AND the main process disk queue have settled.
function createExitGuard({ prepare, drain, warn, confirmPending, release, perform }) {
  let active = null;
  return {
    request(action) {
      if (active) return active;
      active = (async () => {
        let leaving = false;
        try {
          const result = await prepare();
          await drain();
          if (!result.localSaved) throw new Error(result.message || "本机保存尚未完成，请重试后退出。");
          if (!result.cloudSynced && !await confirmPending()) return false;
          await perform(action);
          leaving = true;
          return true;
        } catch (error) {
          await warn(error instanceof Error ? error.message : "保存检查失败，请重试。");
          return false;
        } finally {
          if (!leaving) release();
          active = null;
        }
      })();
      return active;
    },
  };
}
module.exports = { createExitGuard };
